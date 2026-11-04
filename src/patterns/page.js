// UI for patterns.html.

import { instance } from "@viz-js/viz";
import { examples } from "./examples.js";
import { describeLengths, matchLengths } from "./lengths.js";
import { LIMITS, UNLIMITED, toRegex } from "./regex.js";
import { matcher, parseWords, wordsAutomaton } from "./wordlist.js";
import {
  compile, determinize, limitFor, minimize, removeEpsilons, run, toDot, trim, withStateLimit, PatternError,
  TooManyStatesError,
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
// the DFA views of automata larger than this can take seconds, so they wait to be asked for
const MAX_QUICK_DFA_SOURCE = 5000;
const SLOW_VIEWS = new Set(["dfa", "min"]);
const REGEX_DELAY = 300; // ms without typing before converting the pattern to a regex
const STORAGE_KEY = "patterns";
const MATCH_CHUNK = 5000; // words checked between pauses that keep the page responsive
const SHOWN_MATCHES = 1000;
const LARGE_WORD_LIST = 20000; // above this, patterns using @ take a second or more
const DEFAULTS = { pattern: "their|her|his|xyr", tests: "their\nher\nhis\nxyr\nhim", view: "epsfree" };

const $ = (id) => document.getElementById(id);
const patternInput = $("pattern");
const testsInput = $("tests");
const viewSelect = $("view");

const vizReady = instance();
let nfa = null; // the NFA currently drawn, if any
let compiled = null; // the compiled pattern, if it's valid
let drawLarge = false;
let buildLarge = false;

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
  let askToBuild = false;
  try {
    compiled = compile(pattern, { words: wordList?.automaton });
    withStateLimit(limitFor(compiled), () => {
      $("lengths").textContent = describeLengths(matchLengths(compiled));
      if (SLOW_VIEWS.has(viewSelect.value) && compiled.size > MAX_QUICK_DFA_SOURCE && !buildLarge) askToBuild = true;
      else nfa = VIEWS[viewSelect.value](compiled);
    });
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
  scheduleMatches();
  updateTests();
  // while the pattern is invalid, keep showing the last diagram, dimmed
  $("diagram").classList.toggle("stale", nfa === null && message === null && !askToBuild);
  if (nfa === null) {
    $("stats").textContent = "";
    if (askToBuild) {
      $("diagram").innerHTML = `<p class="note">This automaton is large, so this view may take a while to build. <button id="build-anyway">Build anyway</button></p>`;
      $("build-anyway").addEventListener("click", () => {
        $("diagram").innerHTML = `<p class="note">Building…</p>`;
        buildLarge = true;
        // let the note appear before the page is busy
        setTimeout(update, 20);
      });
    } else if (message) $("diagram").innerHTML = `<p class="note">${escapeHtml(message)}</p>`;
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
  const result = withStateLimit(limitFor(compiled), () => examples(compiled, { exclude: new Set(lines) }));
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

// The word list is kept in IndexedDB, since lists are too large for localStorage. If storage
// is unavailable, the list just lasts until the page is closed.
const DB = { name: "patterns", store: "wordlist", key: "list" };
let wordList = null; // { name, words }

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB.store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeWordList(value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB.store, "readwrite");
      if (value === null) tx.objectStore(DB.store).delete(DB.key);
      else tx.objectStore(DB.store).put(value, DB.key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // storage unavailable
  }
}

async function fetchWordList() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(DB.store).objectStore(DB.store).get(DB.key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

function setWordList(list) {
  wordList = list;
  showAllMatches = false;
  $("clear-words").disabled = list === null;
  $("words-info").textContent = list === null ? "None loaded" : `${list.name}: ${count(list.words.length, "word")}`;
  if (list !== null && list.words.length > LARGE_WORD_LIST) {
    $("words-info").textContent += `. Patterns using @ may be slow with this many.`;
  }
  if (list === null) {
    $("matches-info").replaceChildren();
    $("matches").replaceChildren();
  }
  // @ means something different now
  schedule();
}

// a list from its words, including the automaton that @ uses
function makeWordList(name, words) {
  return { name, words, automaton: wordsAutomaton(words) };
}

async function loadWordFile() {
  const file = $("words-file").files[0];
  if (!file) return;
  $("words-info").textContent = "Loading…";
  const text = await file.text();
  $("words-file").value = "";
  setWordList(makeWordList(file.name, parseWords(text)));
  storeWordList({ name: file.name, text });
}

function clearWordList() {
  setWordList(null);
  storeWordList(null);
}

const count = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;

// Like the regex, matches wait for a pause in typing and are dimmed while out of date. The
// search works through the list in chunks, giving up if the pattern or list changes.
let matchTimer = null;
let firstMatches = true;
let showAllMatches = false;
function scheduleMatches() {
  clearTimeout(matchTimer);
  markMatchesStale();
  if (compiled === null || wordList === null) return;
  const [target, list] = [compiled, wordList];
  matchTimer = setTimeout(() => findMatches(target, list), firstMatches ? 0 : REGEX_DELAY);
  firstMatches = false;
}

function markMatchesStale() {
  for (const id of ["matches", "matches-info"]) $(id).classList.add("stale");
  // so a download always matches the pattern shown
  if ($("download-matches")) $("download-matches").disabled = true;
}

async function findMatches(target, list) {
  const test = matcher(target);
  const found = [];
  for (let i = 0; i < list.words.length; i += MATCH_CHUNK) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve));
    if (target !== compiled || list !== wordList) return; // superseded
    for (let j = i; j < Math.min(i + MATCH_CHUNK, list.words.length); j++) if (test(list.words[j])) found.push(list.words[j]);
  }
  showMatches(found);
}

function showMatches(found) {
  for (const id of ["matches", "matches-info"]) $(id).classList.remove("stale");
  const shown = showAllMatches ? found : found.slice(0, SHOWN_MATCHES);
  $("matches").textContent = shown.join("\n");
  $("matches").scrollTop = 0;
  if (found.length === 0) {
    $("matches-info").textContent = "No words match.";
    return;
  }
  const download = `<button id="download-matches">Download</button>`;
  if (shown.length === found.length) {
    $("matches-info").innerHTML = `${count(found.length, "matching word")}: ${download}`;
  } else {
    $("matches-info").innerHTML = `${count(found.length, "matching word")}, showing the first ${shown.length.toLocaleString()}: <button id="show-all-matches">Show all</button> ${download}`;
    $("show-all-matches").addEventListener("click", () => {
      showAllMatches = true;
      showMatches(found);
    });
  }
  $("download-matches").addEventListener("click", () => downloadMatches(found));
}

// save the matches as a text file, one per line, named after the pattern where possible
function downloadMatches(found) {
  const safe = patternInput.value.replace(/[<>:"/\\|?*\p{Cc}]/gu, "_").slice(0, 50);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([found.join("\n") + "\n"], { type: "text/plain;charset=utf-8" }));
  link.download = safe.trim() ? `matches ${safe}.txt` : "matches.txt";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// Patterns using the word list can take a while to compile, so they wait for a pause in
// typing; others update on the next frame.
let pending = false;
let slowTimer = null;
function schedule() {
  clearTimeout(slowTimer);
  if (wordList !== null && patternInput.value.includes("@")) {
    $("diagram").classList.add("stale");
    markMatchesStale();
    slowTimer = setTimeout(update, REGEX_DELAY);
    return;
  }
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
  buildLarge = false;
  showAllMatches = false;
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
  buildLarge = false;
  schedule();
});
$("add-examples").addEventListener("click", addExamples);
$("clear-tests").addEventListener("click", clearTests);
$("copy-regex").addEventListener("click", copyRegex);
$("load-words").addEventListener("click", () => $("words-file").click());
$("words-file").addEventListener("change", loadWordFile);
$("clear-words").addEventListener("click", clearWordList);
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
// wait for any stored word list before the first update, since the pattern may use it
$("clear-words").disabled = true;
$("words-info").textContent = "None loaded";
fetchWordList().then((stored) => {
  if (stored && wordList === null) setWordList(makeWordList(stored.name, parseWords(stored.text)));
  else update();
});
