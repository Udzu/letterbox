// UI for patterns.html.

import { instance } from "@viz-js/viz";
import { examples } from "./examples.js";
import { describeLengths, matchLengths } from "./lengths.js";
import { LIMITS, UNLIMITED, toRegex } from "./regex.js";
import {
  compile, determinize, minimize, removeEpsilons, run, toDot, trim, PatternError, TooManyStatesError,
} from "./index.js";

const VIEWS = {
  raw: (nfa) => nfa,
  trimmed: trim,
  epsfree: removeEpsilons,
  dfa: (nfa) => trim(determinize(nfa)),
  min: minimize,
};
const VIEW_HELP = {
  raw: "The automaton built directly from the pattern, with ε-moves (dashed) that consume no characters.",
  trimmed: "The Thompson NFA without the states that can't lead to a match.",
  epsfree: "The trimmed NFA with its ε-moves replaced by the character moves they lead to.",
  dfa: "A deterministic automaton: each character has at most one move from each state, and a missing move means no match.",
  min: "The DFA with the fewest states that matches the same strings.",
};
const MAX_DRAWN_STATES = 300;
const REGEX_DELAY = 300; // ms without typing before converting the pattern to a regex
const STORAGE_KEY = "patterns";
const DEFAULTS = { pattern: "their|her|his|xyr", tests: "their\nher\nhis\nxyr\nhim", view: "epsfree" };

const $ = (id) => document.getElementById(id);
const patternInput = $("pattern");
const testsInput = $("tests");
const viewSelect = $("view");

const vizReady = instance();
let nfa = null; // the NFA currently drawn, if any
let compiled = null; // the compiled pattern, if it's valid
let drawLarge = false;

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return DEFAULTS;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      pattern: patternInput.value, tests: testsInput.value, view: viewSelect.value,
    }));
  } catch {
    // storage may be unavailable, e.g. in private windows
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// keep a textarea as tall as its content
function autosize(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

async function update() {
  save();
  const pattern = patternInput.value;
  autosize(patternInput);
  $("error").textContent = "";
  $("pattern-backdrop").innerHTML = escapeHtml(pattern) + "\n";

  nfa = null;
  compiled = null;
  $("examples-note").textContent = "";
  $("lengths").textContent = "";
  let message = null;
  try {
    compiled = compile(pattern);
    $("lengths").textContent = describeLengths(matchLengths(compiled));
    nfa = VIEWS[viewSelect.value](compiled);
  } catch (e) {
    if (e instanceof PatternError) {
      const [start, end] = e.span;
      $("error").textContent = e.message;
      $("pattern-backdrop").innerHTML =
        escapeHtml(pattern.slice(0, start)) +
        `<span class="error-span">${escapeHtml(pattern.slice(start, end))}</span>` +
        escapeHtml(pattern.slice(end)) + "\n";
    } else if (e instanceof TooManyStatesError) {
      message = `This view is too large to build: ${e.message}.`;
    } else {
      throw e;
    }
  }

  $("add-examples").disabled = compiled === null;
  scheduleRegex();
  updateTests();
  // while the pattern is invalid, keep showing the last diagram, dimmed
  $("diagram").classList.toggle("stale", nfa === null && message === null);
  if (nfa === null) {
    $("stats").textContent = "";
    if (message) $("diagram").innerHTML = `<p class="note">${escapeHtml(message)}</p>`;
    else if (!$("diagram").querySelector("svg")) $("diagram").replaceChildren();
    highlightCurrent();
    return;
  }
  const edges = nfa.edges.reduce((n, es) => n + es.length, 0);
  $("stats").textContent = `${nfa.size} state${nfa.size === 1 ? "" : "s"}, ${edges} edge${edges === 1 ? "" : "s"}`;
  await draw(nfa);
}

async function draw(drawn) {
  if (drawn.size > MAX_DRAWN_STATES && !drawLarge) {
    $("diagram").innerHTML =
      `<p class="note">Too many states to draw quickly. <button id="draw-anyway">Draw anyway</button></p>`;
    $("draw-anyway").addEventListener("click", () => {
      drawLarge = true;
      draw(drawn);
    });
    return;
  }
  const viz = await vizReady;
  if (drawn !== nfa) return; // superseded while Viz.js was loading
  const svg = viz.renderSVGElement(toDot(drawn));
  // Graphviz gives each node a <title> holding its name, which is the state number
  for (const g of svg.querySelectorAll("g.node")) {
    const state = Number(g.querySelector("title")?.textContent);
    if (Number.isInteger(state)) {
      g.dataset.state = state;
      if (drawn.accepting.has(state)) g.classList.add("accepting");
    }
  }
  $("diagram").replaceChildren(svg);
  highlightCurrent();
}

function updateTests() {
  const lines = testsInput.value.split("\n");
  const current = currentLine();
  $("tests-backdrop").innerHTML = lines.map((line, i) => {
    const cls = nfa === null ? "" : isMatch(line) ? "match" : "nomatch";
    return `<span class="${cls}${i === current ? " current" : ""}">${escapeHtml(line)}</span>`;
  }).join("\n") + "\n";
  autosize(testsInput);
}

function isMatch(line) {
  for (const s of run(nfa, line)) if (nfa.accepting.has(s)) return true;
  return false;
}

function currentLine() {
  if (document.activeElement !== testsInput) return -1;
  return testsInput.value.slice(0, testsInput.selectionStart).split("\n").length - 1;
}

// highlight the states reached by the test string on the cursor's line
function highlightCurrent() {
  const line = currentLine();
  const states = nfa && line >= 0 ? run(nfa, testsInput.value.split("\n")[line]) : new Set();
  for (const g of $("diagram").querySelectorAll("g.node[data-state]")) {
    g.classList.toggle("active", states.has(Number(g.dataset.state)));
  }
}

// The equivalent regex can be slow to find, so it waits for a pause in typing, and is
// dimmed while it's out of date. While the pattern is invalid, the last one stays dimmed.
let regexTimer = null;
let firstRegex = true;
function scheduleRegex() {
  clearTimeout(regexTimer);
  $("regex-line").classList.add("stale");
  if (compiled === null) return;
  const target = compiled;
  regexTimer = setTimeout(() => showRegex(target, LIMITS), firstRegex ? 0 : REGEX_DELAY);
  firstRegex = false;
}

function showRegex(target, limits) {
  if (target !== compiled) return; // superseded
  const result = toRegex(target, limits);
  $("regex-line").classList.remove("stale");
  $("regex").textContent = result.regex ?? "";
  $("copy-regex").textContent = "Copy";
  if (result.regex) {
    $("regex-note").textContent = "";
    return;
  }
  $("regex-note").innerHTML = `Too complex to convert quickly: ${escapeHtml(result.tooComplex)}. <button id="convert-anyway">Convert anyway</button>`;
  $("convert-anyway").addEventListener("click", () => {
    $("regex-note").textContent = "Converting…";
    // let the note appear before the page is busy
    setTimeout(() => showRegex(target, UNLIMITED), 20);
  });
}

// Copying by selecting the text works synchronously during a click, even for local files;
// the clipboard API is the fallback, since it can wait indefinitely for a permission.
function copyRegex() {
  const button = $("copy-regex");
  const done = (label) => {
    button.textContent = label;
    setTimeout(() => (button.textContent = "Copy"), 1500);
  };
  const range = document.createRange();
  range.selectNodeContents($("regex"));
  getSelection().removeAllRanges();
  getSelection().addRange(range);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // not supported
  }
  getSelection().removeAllRanges();
  if (copied) done("Copied");
  else if (navigator.clipboard) navigator.clipboard.writeText($("regex").textContent).then(() => done("Copied"), () => done("Couldn't copy"));
  else done("Couldn't copy");
}

// replace a textarea's selection via editing commands where possible, so Ctrl+Z can undo it
function edit(box, text) {
  const value = box.value.slice(0, box.selectionStart) + text + box.value.slice(box.selectionEnd);
  if (!document.execCommand(text ? "insertText" : "delete", false, text) || box.value !== value) box.value = value;
}

function clearTests() {
  testsInput.focus();
  testsInput.select();
  edit(testsInput, "");
  $("examples-note").textContent = "";
  save();
  onCursor();
}

// append a few new matching strings to the test strings
function addExamples() {
  if (compiled === null) return;
  const lines = testsInput.value.split("\n");
  const result = examples(compiled, { exclude: new Set(lines) });
  const existing = testsInput.value.replace(/\n+$/, "");
  if (result.examples.length) {
    // insert at the end, after any trailing blank lines are removed
    testsInput.focus();
    testsInput.setSelectionRange(existing.length, testsInput.value.length);
    edit(testsInput, (existing ? "\n" : "") + result.examples.join("\n"));
  }
  const notes = [];
  if (result.examples.length === 0) {
    notes.push(lines.some((line) => line !== "" && isMatch(line)) ? "No more examples found." : "No strings can be shown that match.");
  }
  if (result.matchesEmpty) notes.push("The empty string also matches.");
  $("examples-note").textContent = notes.join(" ");
  save();
  onCursor();
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    update();
  });
}

function onCursor() {
  updateTests();
  highlightCurrent();
}

const saved = load();
patternInput.value = saved.pattern;
testsInput.value = saved.tests;
viewSelect.value = saved.view in VIEWS ? saved.view : DEFAULTS.view;

patternInput.addEventListener("input", () => {
  if (patternInput.value.includes("\n")) patternInput.value = patternInput.value.replace(/\n/g, "");
  drawLarge = false;
  schedule();
});
// the pattern is a single line, even though it wraps
patternInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.preventDefault();
});
function showViewHelp() {
  $("view-help").textContent = VIEW_HELP[viewSelect.value];
}
showViewHelp();
viewSelect.addEventListener("change", () => {
  showViewHelp();
  schedule();
});
$("add-examples").addEventListener("click", addExamples);
$("clear-tests").addEventListener("click", clearTests);
$("copy-regex").addEventListener("click", copyRegex);
testsInput.addEventListener("input", () => {
  save();
  onCursor();
});
for (const event of ["focus", "blur", "keyup", "click", "select"]) testsInput.addEventListener(event, onCursor);
document.addEventListener("selectionchange", () => {
  if (document.activeElement === testsInput) onCursor();
});
window.addEventListener("resize", () => {
  autosize(patternInput);
  autosize(testsInput);
});
update();
