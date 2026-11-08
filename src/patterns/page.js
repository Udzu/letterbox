// UI for patterns.html.

import { instance } from "@viz-js/viz";
import { examples } from "./examples.js";
import { describeLengths, matchLengths } from "./lengths.js";
import { LIMITS, UNLIMITED, toRegex } from "./regex.js";
import { readShared, shareQuery } from "./share.js";
import { matcher, parseWords, wordsAutomaton } from "./wordlist.js";
import {
  compile, determinize, explainer, limitFor, minimize, removeEpsilons, run, toDot, trim, withStateLimit, PatternError,
  TooComplexToExplain, TooManyStatesError,
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
const MATCH_CHUNK = 5000; // words checked between pauses that keep the page responsive
const SHOWN_MATCHES = 1000;
const MAX_MATCH_COLUMN = 32; // characters, before a long match wraps
const LARGE_WORD_LIST = 20000; // above this, patterns using @ take a second or more
const DEFAULTS = { pattern: "cow^ox", tests: "cowox\ncoxow\nocxow\ncwoox", view: "epsfree", caseless: false, accentless: false };

const $ = (id) => document.getElementById(id);
const patternInput = $("pattern");
const testsInput = $("tests");
const viewSelect = $("view");
const caselessBox = $("ignore-case"); // ignore case throughout, as if in (?i:...)
const accentlessBox = $("ignore-accents"); // ignore accents throughout, as if in (?d:...)

const vizReady = instance();
let nfa = null; // the NFA currently drawn, if any
let compiled = null; // the compiled pattern, if it's valid
let drawLarge = false;
let diagramHidden = false; // hidden diagrams are built (for their stats) but not drawn
let buildLarge = false;

// The pattern, test strings and diagram settings are kept between visits, like the other
// pages' text (and the word lists, below), unless the address is a shared link. Reset goes
// back to the defaults.
const STORAGE_KEY = "patterns";

function load() {
  try {
    const saved = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    return { ...saved, view: saved.view in VIEWS ? saved.view : DEFAULTS.view };
  } catch {
    return DEFAULTS;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      // a pattern that wasn't restored stays saved until another is typed (see guarded)
      pattern: unrestored ?? patternInput.value, tests: testsInput.value, view: viewSelect.value, hidden: diagramHidden,
      caseless: caselessBox.checked, accentless: accentlessBox.checked,
    }));
  } catch {
    // storage may be unavailable, e.g. in private windows
  }
}

// Slow work is marked in storage while it runs. If the page freezes or crashes during it,
// the mark is still there when the page is next loaded, which then starts with the default
// pattern instead of the saved one, and offers to restore it. (Building the automaton for @
// has its own mark, below, so a list that stopped the page doesn't count against the pattern.)
const BUSY_KEY = "patterns-busy";
let busy = 0;
let unrestored = null; // the saved pattern, if it wasn't restored

function guarded(f) {
  if (busy++ === 0) setBusy(true);
  try {
    return f();
  } finally {
    if (--busy === 0) setBusy(false);
  }
}

function setBusy(value) {
  try {
    if (value) localStorage.setItem(BUSY_KEY, "1");
    else localStorage.removeItem(BUSY_KEY);
  } catch {
    // storage may be unavailable
  }
}

// whether the page stopped during slow work last time
function stoppedLastTime() {
  try {
    return localStorage.getItem(BUSY_KEY) !== null;
  } catch {
    return false;
  }
}

function offerRestore(pattern) {
  unrestored = pattern;
  $("restore").hidden = false;
  $("restore").innerHTML = "The last pattern wasn't restored, because the page stopped responding while working on it. <button id=\"restore-anyway\">Restore anyway</button>";
  $("restore-anyway").addEventListener("click", () => {
    patternInput.value = pattern;
    dismissRestore();
    schedule();
  });
}

function dismissRestore() {
  unrestored = null;
  $("restore").hidden = true;
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
    const words = atAutomaton(); // outside the pattern's guard, since it has its own
    guarded(() => {
      compiled = compile(pattern, { words, caseless: caselessBox.checked, accentless: accentlessBox.checked });
      withStateLimit(limitFor(compiled), () => {
        $("lengths").textContent = describeLengths(matchLengths(compiled));
        if (SLOW_VIEWS.has(viewSelect.value) && compiled.size > MAX_QUICK_DFA_SOURCE && !buildLarge) askToBuild = true;
        else nfa = VIEWS[viewSelect.value](compiled);
      });
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
  showExplanation();
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
  if (diagramHidden) {
    $("diagram").replaceChildren(); // rather than leave an out-of-date diagram
    return;
  }
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
  if (drawn !== nfa || diagramHidden) return; // superseded while Viz.js was loading
  const svg = guarded(() => viz.renderSVGElement(toDot(drawn)));
  // Graphviz gives each node a <title> holding its name, which is the state number
  for (const g of svg.querySelectorAll("g.node")) {
    const state = Number(g.querySelector("title")?.textContent);
    if (Number.isInteger(state)) {
      g.dataset.state = state;
      if (drawn.accepting.has(state)) g.classList.add("accepting");
    }
  }
  // Graphviz puts the full text of shortened labels in xlink:title, which browsers don't all
  // show, so copy it into a <title>, which they do
  for (const a of svg.querySelectorAll("a")) {
    const text = a.getAttributeNS("http://www.w3.org/1999/xlink", "title");
    if (!text) continue;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = text;
    a.prepend(title);
  }
  $("diagram").replaceChildren(svg);
  highlightCurrent();
}

function updateTests() {
  const lines = testsInput.value.split("\n");
  const current = currentLine();
  const column = cursorColumn();
  $("tests-backdrop").innerHTML = lines.map((line, i) => {
    const cls = nfa === null ? "" : isMatch(line) ? "match" : "nomatch";
    if (i !== current) return `<span class="${cls}">${escapeHtml(line)}</span>`;
    // the diagram shows the text before the cursor, so the rest is faded
    const after = line.slice(column);
    const faded = after ? `<span class="after-cursor">${escapeHtml(after)}</span>` : "";
    return `<span class="${cls} current">${escapeHtml(line.slice(0, column))}${faded}</span>`;
  }).join("\n") + "\n";
  autosize(testsInput);
}

function isMatch(line) {
  for (const s of run(nfa, line)) if (nfa.accepting.has(s)) return true;
  return false;
}

// The cursor's offset in the test strings, or -1 if they don't have the focus. With a
// selection, it's the end the cursor is at.
function cursor() {
  if (document.activeElement !== testsInput) return -1;
  return testsInput.selectionDirection === "backward" ? testsInput.selectionStart : testsInput.selectionEnd;
}

function currentLine() {
  const at = cursor();
  return at < 0 ? -1 : testsInput.value.slice(0, at).split("\n").length - 1;
}

// the cursor's position in its line
function cursorColumn() {
  const at = cursor();
  return at < 0 ? -1 : at - (testsInput.value.lastIndexOf("\n", at - 1) + 1);
}

// The explanation is of the line the cursor was last on, kept while the cursor is elsewhere.
let explainedLine = -1;
let explainFor = null; // { compiled, explain } for the current pattern
let explained = null; // { compiled, line, html } last shown

function showExplanation() {
  const line = currentLine();
  if (line >= 0) explainedLine = line;
  const text = explainedLine >= 0 ? testsInput.value.split("\n")[explainedLine] : undefined;
  if (compiled === null) {
    $("explain").classList.toggle("stale", text !== undefined);
    return;
  }
  $("explain").classList.remove("stale");
  if (explained && explained.compiled === compiled && explained.line === text) return;
  explained = { compiled, line: text, html: explanationHtml(text) };
  $("explain").innerHTML = explained.html;
}

function explanationHtml(text) {
  const note = (message) => `<p class="note">${escapeHtml(message)}</p>`;
  if (text === undefined) return note("Put the cursor on a test string to see which part of the pattern matched each character.");
  if (explainFor?.compiled !== compiled) {
    explainFor = {
      compiled,
      explain: explainer(patternInput.value, {
        words: atAutomaton(), nfa: compiled, caseless: caselessBox.checked, accentless: accentlessBox.checked,
      }),
    };
  }
  let result;
  try {
    result = guarded(() => explainFor.explain(text));
  } catch (e) {
    if (e instanceof TooComplexToExplain || e instanceof TooManyStatesError) return note("Too complex to explain.");
    throw e;
  }
  if (result === null) return note(text === "" ? "The empty string doesn't match." : "This string doesn't match.");
  if (text === "") return note("The empty string matches.");
  const { columns, rows, truncated } = result;
  // the top row is coloured by the first row of the top level that has each character
  const groupOf = new Map();
  for (const row of rows) {
    if (row.depth === 1) for (const i of row.chars.keys()) if (!groupOf.has(i)) groupOf.set(i, row.group);
  }
  const groupClass = (group) => (group === null || group === undefined ? "" : `g${group % 6}`);
  const html = rows.map((row) => {
    const cells = columns.map((col, i) => {
      const ch = row.depth === 0 ? col.ch : row.chars.get(i) ?? "";
      const classes = [groupClass(row.depth === 0 ? groupOf.get(i) : row.group)];
      if (col.synthetic) {
        classes.push("synthetic");
        if (!columns[i - 1]?.synthetic) classes.push("first");
        if (!columns[i + 1]?.synthetic) classes.push("last");
      }
      return `<td class="${classes.join(" ").trim()}">${escapeHtml(ch)}</td>`;
    }).join("");
    const title = row.title === null ? "" : ` title="${escapeHtml(row.title)}"`;
    // an alternation's other alternatives are faded
    const text = row.highlight === null ? escapeHtml(row.label) : [
      `<span class="other">${escapeHtml(row.label.slice(0, row.highlight[0]))}</span>`,
      escapeHtml(row.label.slice(...row.highlight)),
      `<span class="other">${escapeHtml(row.label.slice(row.highlight[1]))}</span>`,
    ].join("");
    const label = `<td class="label" style="padding-left: ${1.5 + row.depth}em"${title}>${text}</td>`;
    return `<tr>${cells}${label}</tr>`;
  }).join("");
  const more = truncated ? note("Only the first rows are shown.") : "";
  return `<table>${html}</table>${more}`;
}

// add a string to the test strings if it isn't there already, and put the cursor on it
function showTestString(s) {
  testsInput.focus();
  let lines = testsInput.value.split("\n");
  if (!lines.includes(s)) {
    const existing = testsInput.value.replace(/\n+$/, "");
    testsInput.setSelectionRange(existing.length, testsInput.value.length);
    edit(testsInput, (existing ? "\n" : "") + s);
    lines = testsInput.value.split("\n");
  }
  const start = lines.slice(0, lines.indexOf(s)).reduce((n, line) => n + line.length + 1, 0);
  testsInput.setSelectionRange(start, start);
  onCursor();
  $("tests-row").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// highlight the states reached by the current line's text before the cursor
function highlightCurrent() {
  const line = currentLine();
  const states = nfa && line >= 0 ? run(nfa, testsInput.value.split("\n")[line].slice(0, cursorColumn())) : new Set();
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
  const result = guarded(() => toRegex(target, limits));
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

// Copying by selecting text works synchronously during a click, even for local files; the
// clipboard API is the fallback, since it can wait indefinitely for a permission.
function copyText(button, text) {
  const label = button.textContent;
  const done = (result) => {
    button.textContent = result;
    setTimeout(() => (button.textContent = label), 1500);
  };
  const box = document.createElement("textarea");
  box.value = text;
  box.readOnly = true;
  box.style.cssText = "position: fixed; top: 0; opacity: 0";
  document.body.append(box);
  box.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // not supported
  }
  box.remove();
  if (copied) done("Copied");
  else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => done("Copied"), () => done("Couldn't copy"));
  else done("Couldn't copy");
}

function toggleDiagram() {
  diagramHidden = !diagramHidden;
  const button = $("toggle-diagram");
  button.textContent = diagramHidden ? "Show diagram" : "Hide diagram";
  button.setAttribute("aria-expanded", String(!diagramHidden));
  $("diagram").hidden = diagramHidden;
  // diagrams skipped while hidden left it empty
  if (!diagramHidden && nfa !== null && !$("diagram").hasChildNodes()) draw(nfa);
  save();
}

function copyLink() {
  const state = {
    pattern: patternInput.value, tests: testsInput.value, view: viewSelect.value, hidden: diagramHidden,
    caseless: caselessBox.checked, accentless: accentlessBox.checked,
  };
  copyText($("copy-link"), location.href.replace(/[?#].*/s, "") + shareQuery(state, DEFAULTS.view));
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
  onCursor();
}

// append a few new matching strings to the test strings
function addExamples() {
  if (compiled === null) return;
  const lines = testsInput.value.split("\n");
  const result = guarded(() => withStateLimit(limitFor(compiled), () => examples(compiled, { exclude: new Set(lines) })));
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
  onCursor();
}

// Two lists are kept in IndexedDB, since lists are too large for localStorage: the word list,
// whose words are searched for matches, and the optional @ list, which @ stands for in place
// of the word list. If storage is unavailable, they last until the page is closed. The
// Anagrams and Pangrams pages read and write the word list's entry, so it's shared by all of
// them, while the @ list is only used here.
const DB = { name: "patterns", store: "wordlist" };
const SLOTS = {
  words: { key: "list", load: "load-words", clear: "clear-words", info: "words-info", file: "words-file", none: "None loaded", list: null },
  at: { key: "at-list", load: "load-at", clear: "clear-at", info: "at-info", file: "at-file", none: "None loaded, so @ uses the word list", list: null },
};
let wordList = null; // { name, words, automaton }, with automaton null until @ needs it
let atList = null; // the same, for the @ list

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB.store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeList(slot, value) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB.store, "readwrite");
      if (value === null) tx.objectStore(DB.store).delete(slot.key);
      else tx.objectStore(DB.store).put(value, slot.key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // storage unavailable
  }
}

async function fetchList(slot) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(DB.store).objectStore(DB.store).get(slot.key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

// the list @ stands for: the @ list if there is one, or else the word list
const atSource = () => atList ?? wordList;

// The automaton @ uses, built the first time it's needed. Building it is the slowest thing
// the page does, and a huge list could freeze or crash it. Since the lists are restored on
// every visit, that would happen again on every reload, so the key of the list being built
// is marked in storage while it runs, and a list whose building never finished isn't loaded
// again automatically.
const BUILDING_KEY = "patterns-building-words";
function atAutomaton() {
  const list = atSource();
  if (list === null) return undefined;
  if (list.automaton === null) {
    mark(BUILDING_KEY, list === atList ? SLOTS.at.key : SLOTS.words.key);
    list.automaton = wordsAutomaton(list.words);
    mark(BUILDING_KEY, null);
  }
  return list.automaton;
}

function setList(slot, list) {
  slot.list = list;
  slot.offered = false;
  listsChanged();
}

function listsChanged() {
  wordList = SLOTS.words.list;
  atList = SLOTS.at.list;
  showAllMatches = false;
  for (const s of Object.values(SLOTS)) showListInfo(s);
  if (wordList === null) {
    $("matches-info").replaceChildren();
    $("matches").replaceChildren();
  }
  // @ may mean something different now
  schedule();
}

function showListInfo(slot) {
  if (slot.offered) return; // leave the offer to load a stuck list in place
  const list = slot.list;
  $(slot.clear).disabled = list === null;
  $(slot.info).textContent = list === null ? slot.none : `${list.name}: ${count(list.words.length, "word")}`;
  if (list !== null && list === atSource() && list.words.length > LARGE_WORD_LIST) {
    $(slot.info).textContent += `. Patterns using @ may be slow with this many.`;
  }
}

function makeList(name, words) {
  return { name, words, automaton: null };
}

function mark(key, value) {
  try {
    if (value !== null) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage may be unavailable
  }
}

function marked(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// a stored list that stopped the page last time: offer to load it anyway, or clear it
function offerStoredList(slot, stored) {
  slot.offered = true;
  $(slot.clear).disabled = false;
  $(slot.info).innerHTML = `${escapeHtml(stored.name)} wasn't loaded, because the page stopped responding while loading it last time. <button id="${slot.key}-anyway">Load anyway</button>`;
  $(`${slot.key}-anyway`).addEventListener("click", () => {
    $(slot.info).textContent = "Loading…";
    setTimeout(() => setList(slot, makeList(stored.name, parseWords(stored.text))), 20);
  });
}

async function loadListFile(slot) {
  const file = $(slot.file).files[0];
  if (!file) return;
  $(slot.info).textContent = "Loading…";
  const text = await file.text();
  $(slot.file).value = "";
  setList(slot, makeList(file.name, parseWords(text)));
  storeList(slot, { name: file.name, text });
}

function clearList(slot) {
  if (marked(BUILDING_KEY) === slot.key) mark(BUILDING_KEY, null);
  setList(slot, null);
  storeList(slot, null);
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
    guarded(() => {
      for (let j = i; j < Math.min(i + MATCH_CHUNK, list.words.length); j++) if (test(list.words[j])) found.push(list.words[j]);
    });
  }
  showMatches(found);
}

function showMatches(found) {
  for (const id of ["matches", "matches-info"]) $(id).classList.remove("stale");
  const shown = showAllMatches ? found : found.slice(0, SHOWN_MATCHES);
  $("matches").replaceChildren(...shown.map((word) => {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = word;
    return span;
  }));
  // Columns as wide as the longest match (the font is monospaced), but at least 12em as before
  // and at most MAX_MATCH_COLUMN characters; longer matches wrap, indented.
  const longest = Math.max(0, ...shown.map((word) => [...word].length));
  $("matches").style.columnWidth = `max(12em, ${Math.min(longest, MAX_MATCH_COLUMN) + 3}ch)`;
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
  if (atSource() !== null && patternInput.value.includes("@")) {
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
  save();
  updateTests();
  highlightCurrent();
  showExplanation();
}

// A shared link wins over what was saved, and becomes what's saved. It's then removed from
// the address, so reloading keeps any later changes rather than going back to it.
const shared = readShared(location.search, VIEWS, DEFAULTS.view);
const initial = shared ?? load();
if (shared) history.replaceState(null, "", location.pathname + location.hash);
if (!shared && stoppedLastTime() && initial.pattern !== DEFAULTS.pattern) {
  patternInput.value = DEFAULTS.pattern;
  offerRestore(initial.pattern);
} else {
  patternInput.value = initial.pattern;
}
setBusy(false);
testsInput.value = initial.tests;
viewSelect.value = initial.view;
caselessBox.checked = initial.caseless === true;
accentlessBox.checked = initial.accentless === true;
if (initial.hidden) toggleDiagram(); // nothing is drawn yet, so this only hides it

// Back to the default pattern, test strings and view, with the diagram showing and case and
// accents mattering. The text is
// replaced as an edit, so undo brings it back.
function reset() {
  dismissRestore();
  for (const [box, text] of [[testsInput, DEFAULTS.tests], [patternInput, DEFAULTS.pattern]]) {
    box.focus();
    box.select();
    edit(box, text);
  }
  viewSelect.value = DEFAULTS.view;
  caselessBox.checked = DEFAULTS.caseless;
  accentlessBox.checked = DEFAULTS.accentless;
  showViewHelp();
  if (diagramHidden) toggleDiagram();
  $("examples-note").textContent = "";
  drawLarge = false;
  buildLarge = false;
  showAllMatches = false;
  schedule();
}

patternInput.addEventListener("input", () => {
  if (patternInput.value.includes("\n")) patternInput.value = patternInput.value.replace(/\n/g, "");
  dismissRestore();
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
for (const box of [caselessBox, accentlessBox]) {
  box.addEventListener("change", () => {
    buildLarge = false;
    showAllMatches = false;
    schedule();
  });
}
$("add-examples").addEventListener("click", addExamples);
$("clear-tests").addEventListener("click", clearTests);
$("copy-regex").addEventListener("click", () => copyText($("copy-regex"), $("regex").textContent));
$("copy-link").addEventListener("click", copyLink);
$("toggle-diagram").addEventListener("click", toggleDiagram);
$("reset").addEventListener("click", reset);
for (const slot of Object.values(SLOTS)) {
  $(slot.load).addEventListener("click", () => $(slot.file).click());
  $(slot.file).addEventListener("change", () => loadListFile(slot));
  $(slot.clear).addEventListener("click", () => clearList(slot));
}
$("matches").addEventListener("click", (e) => {
  if (e.target.classList.contains("word")) showTestString(e.target.textContent);
});
testsInput.addEventListener("input", onCursor);
for (const event of ["focus", "blur", "keyup", "click", "select"]) testsInput.addEventListener(event, onCursor);
document.addEventListener("selectionchange", () => {
  if (document.activeElement === testsInput) onCursor();
});
window.addEventListener("resize", () => {
  autosize(patternInput);
  autosize(testsInput);
});
// The page updates straight away, and again once any stored lists are loaded (a shared
// pattern using @ shows an error until then). Pages from before the @ list marked a stuck
// word list with "1".
for (const slot of Object.values(SLOTS)) showListInfo(slot);
update();
Promise.all([fetchList(SLOTS.words), fetchList(SLOTS.at)]).then((stored) => {
  const stuck = marked(BUILDING_KEY) === "1" ? SLOTS.words.key : marked(BUILDING_KEY);
  for (const [slot, list] of [[SLOTS.words, stored[0]], [SLOTS.at, stored[1]]]) {
    if (!list || slot.list !== null) continue;
    if (slot.key === stuck) offerStoredList(slot, list);
    else slot.list = makeList(list.name, parseWords(list.text));
  }
  // show both at once, so the word list's automaton isn't built when there's an @ list
  if (SLOTS.words.list !== null || SLOTS.at.list !== null) listsChanged();
});
