// The Ladders page: change one word into another a letter at a time, with the puzzles taken
// from the word list and @ list shared with the Patterns and Words pages.

import { parseWords } from "../patterns/wordlist.js";
import { buildGraph, entryInfo, isStep, ladderWords, letters, makePuzzle, stepError } from "./game.js";

const SETTINGS_KEY = "ladders-settings";
const HISTORY_KEY = "ladders-history";
const DEFAULTS = { length: 4, steps: 4, fewer: true, shortest: false, capitals: false, phrases: false };
const MIN_LENGTH = 2, MAX_LENGTH = 15, MIN_STEPS = 2, MAX_STEPS = 30;
const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "+ZXCVBNM-"]; // + is Enter, - is Backspace

const $ = (id) => document.getElementById(id);
const board = $("board");
const message = $("message");

const storage = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (e) {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  },
};

const randInt = (n) => Math.floor(Math.random() * n);
const count = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;
const entries = (n) => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ladderText = (words) => words.join(" → ");

// ---- the lists, kept in IndexedDB under the same keys as the Patterns page's

const DB = { name: "patterns", store: "wordlist" };
const SLOTS = {
  words: { key: "list", load: "load-words", clear: "clear-words", info: "words-info", file: "words-file", none: "None loaded", list: null },
  at: { key: "at-list", load: "load-at", clear: "clear-at", info: "at-info", file: "at-file", none: "None loaded, so puzzles come from the word list", list: null },
};

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
    // storage unavailable: the list lasts until the page is closed
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

// A list: its name, its entries and what the game needs to know about each.
const makeList = (name, text) => {
  const words = parseWords(text);
  return { name, size: words.length, infos: words.map(entryInfo) };
};

function setList(slot, list) {
  slot.list = list;
  listsChanged();
}

async function loadListFile(slot) {
  const file = $(slot.file).files[0];
  if (!file) return;
  $(slot.info).textContent = "Loading…";
  const text = await file.text();
  $(slot.file).value = "";
  setList(slot, makeList(file.name, text));
  storeList(slot, { name: file.name, text });
}

function clearList(slot) {
  setList(slot, null);
  storeList(slot, null);
}

let wordsCache = null; // { key, words } for the current lists and settings

// The puzzle words, allowed words and the graph of steps for the current lists and the
// given settings (null without a word list).
function currentWords(s) {
  const key = JSON.stringify([s.length, s.phrases, s.capitals]);
  if (wordsCache?.key !== key) {
    const words = SLOTS.words.list, at = SLOTS.at.list;
    let value = null;
    if (words) {
      value = ladderWords(words.infos, at?.infos ?? null, s);
      value.graph = null; // built when first needed
    }
    wordsCache = { key, words: value };
  }
  return wordsCache.words;
}

function listsChanged() {
  wordsCache = null;
  for (const slot of Object.values(SLOTS)) {
    $(slot.clear).disabled = slot.list === null;
    $(slot.info).textContent = slot.list === null ? slot.none : `${slot.list.name}: ${entries(slot.list.size)}`;
  }
  showCounts();
}

// ---- settings

function readSettings() {
  const int = (id, min, max) => {
    const n = Number($(id).value);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  return {
    length: int("length", MIN_LENGTH, MAX_LENGTH),
    steps: int("steps", MIN_STEPS, MAX_STEPS),
    fewer: $("fewer").checked,
    shortest: $("shortest").checked,
    capitals: $("capitals").checked,
    phrases: $("phrases").checked,
  };
}

function applySettings(s) {
  $("length").value = s.length;
  $("steps").value = s.steps;
  $("fewer").checked = s.fewer;
  $("shortest").checked = s.shortest;
  $("capitals").checked = s.capitals;
  $("phrases").checked = s.phrases;
}

function loadSettings() {
  const s = { ...DEFAULTS, ...storage.get(SETTINGS_KEY) };
  if (!Number.isInteger(s.length) || s.length < MIN_LENGTH || s.length > MAX_LENGTH) s.length = DEFAULTS.length;
  if (!Number.isInteger(s.steps) || s.steps < MIN_STEPS || s.steps > MAX_STEPS) s.steps = DEFAULTS.steps;
  return s;
}

function settingsChanged() {
  const s = readSettings();
  const saved = loadSettings();
  storage.set(SETTINGS_KEY, { ...s, length: s.length ?? saved.length, steps: s.steps ?? saved.steps });
  showCounts();
  if (!game) drawBoard();
}

// How many words the settings give.
function showCounts() {
  const s = readSettings();
  const valid = s.length !== null && s.steps !== null;
  $("new-game").disabled = !valid;
  if (!valid) {
    $("counts").textContent = "";
    return;
  }
  const words = currentWords(s);
  const extra = words ? words.allowed.size - words.pool.size : 0;
  $("counts").textContent = !words
    ? "Load a word list to play."
    : `${count(words.pool.size, "word")} for puzzles${extra ? `, and ${extra.toLocaleString()} more for steps` : ""}, with these rules.`;
  $("new-game").disabled = words === null || words.pool.size < 2;
}

// ---- the game

// { start, end, best (a shortest ladder), forms, words, settings, rows (the words played),
//   current (the letters of the word being made), selected, began, over }
let game = null;

const playing = () => game !== null && !game.over;
const previous = () => game.rows.at(-1) ?? game.start;
// Whether the number of rows is known from the start: the puzzle's length is fixed, or the
// ladder can't be longer than the shortest.
const lengthShown = (s) => !s.fewer || s.shortest;
// The most words the player can add, or Infinity.
const maxRows = () => (game.settings.shortest ? game.best.length - 2 : Infinity);

function newGame() {
  const s = readSettings();
  const words = currentWords(s);
  if (!words || words.pool.size < 2) return;
  words.graph ??= buildGraph(words.pool.keys());
  const puzzle = makePuzzle(words.graph, s);
  if (!puzzle) {
    setMessage(`No ladders of ${s.fewer ? "2 to " : ""}${count(s.steps, "step")} found with these words: try ${s.fewer ? "other" : "fewer"} steps.`, "error");
    return;
  }
  game = {
    start: puzzle.start,
    end: puzzle.end,
    best: puzzle.ladder,
    forms: [words.pool.get(puzzle.start), words.pool.get(puzzle.end)],
    words,
    settings: s,
    rows: [],
    current: [...puzzle.start],
    selected: 0,
    began: Date.now(),
    over: false,
  };
  setMessage("");
  lockSettings(true);
  showGoal();
  drawBoard();
  // on narrow screens the game is below the settings
  if (matchMedia("(max-width: 899px)").matches) $("game-section").scrollIntoView({ behavior: "smooth" });
  document.activeElement?.blur();
}

function lockSettings(locked) {
  for (const id of ["lists-set", "rules-set"]) $(id).disabled = locked;
  $("give-up").disabled = !locked;
  updateUndo();
}

function updateUndo() {
  $("undo").disabled = !playing() || game.rows.length === 0;
}

function showGoal() {
  const s = game?.settings;
  if (!s) {
    $("goal").textContent = "";
    return;
  }
  const par = game.best.length - 1;
  $("goal").textContent = s.shortest
    ? `Get there in ${count(par, "step")}.`
    : lengthShown(s)
      ? `The shortest ladder takes ${count(par, "step")}.`
      : `The shortest ladder takes at most ${count(s.steps, "step")}.`;
}

function select(i) {
  if (!playing()) return;
  game.selected = Math.max(0, Math.min(game.current.length - 1, i));
  drawBoard();
}

function type(c) {
  if (!playing()) return;
  game.current[game.selected] = c;
  game.selected = Math.min(game.selected + 1, game.current.length - 1);
  setMessage("");
  drawBoard();
}

// Put back the selected letter if it was changed, or else the nearest changed letter before
// it; with nothing changed, undo the last step.
function backspace() {
  if (!playing()) return;
  const prev = previous();
  let i = game.selected;
  while (i >= 0 && game.current[i] === prev[i]) i--;
  if (i < 0) i = game.current.findIndex((c, j) => c !== prev[j]);
  if (i < 0) {
    undo();
    return;
  }
  game.current[i] = prev[i];
  game.selected = i;
  setMessage("");
  drawBoard();
}

function undo() {
  if (!playing() || !game.rows.length) return;
  game.rows.pop();
  game.current = [...previous()];
  game.selected = 0;
  setMessage("");
  updateUndo();
  drawBoard();
}

function submit() {
  if (!playing()) return;
  const word = game.current.join("");
  const prev = previous();
  let error = stepError(prev, word);
  if (!error && !game.words.allowed.has(word)) error = "Not in the lists";
  if (!error && (word === game.start || word === game.end || game.rows.includes(word))) error = "Already in the ladder";
  if (!error && game.rows.length + 1 >= maxRows() && !isStep(word, game.end)) {
    error = `That isn't one step from ${game.end}, and the ladder can't be any longer`;
  }
  if (error) {
    setMessage(error, "error");
    const row = board.querySelector(".board-row.active");
    row.classList.remove("shake");
    void row.offsetWidth; // restart the animation
    row.classList.add("shake");
    return;
  }
  game.rows.push(word);
  game.current = [...word];
  game.selected = 0;
  setMessage("");
  updateUndo();
  if (isStep(word, game.end)) endGame("win");
  else drawBoard();
}

function endGame(how) {
  game.over = true;
  lockSettings(false);
  const g = game;
  const steps = g.rows.length + 1;
  const par = g.best.length - 1;
  addHistory({
    id: `${Date.now()}-${randInt(1e9)}`,
    start: g.start,
    end: g.end,
    forms: g.forms,
    won: how === "win",
    steps: how === "win" ? steps : g.rows.length,
    par,
    seconds: Math.round((Date.now() - g.began) / 1000),
    settings: g.settings,
    lists: [SLOTS.words.list?.name ?? null, SLOTS.at.list?.name ?? null],
  });
  const best = `<span class="ladder">${escapeHtml(ladderText(g.best))}</span>`;
  if (how === "win") {
    const note = steps < par ? `, even shorter than the ${par} expected!` : steps === par ? ", the shortest way!" : `. The shortest takes ${par}: ${best}`;
    setMessage(`Solved in ${count(steps, "step")}${note}`, "win", true);
  } else {
    g.gaveUp = true;
    setMessage("Given up. Here's a shortest ladder.");
  }
  showGoal();
  drawBoard();
  $("new-game").focus();
}

function setMessage(text, cls = "", html = false) {
  message.className = cls;
  if (html) message.innerHTML = text;
  else message.textContent = text;
}

// The rows to show: the start word, the words played (or after giving up, a shortest ladder), the word being made, blank rows (as
// many as the puzzle needs, if that's shown) and the end word. Before a game, blank rows.
function boardRows() {
  if (!game) {
    const s = readSettings();
    return Array((s.steps ?? DEFAULTS.steps) + 1).fill({ kind: "blank" });
  }
  const rows = [{ kind: "fixed", text: game.start }];
  let prev = game.start;
  // after giving up, a shortest ladder replaces the words played
  for (const word of game.gaveUp ? game.best.slice(1, -1) : game.rows) {
    rows.push({ kind: game.gaveUp ? "shown" : "done", text: word, prev });
    prev = word;
  }
  if (playing()) rows.push({ kind: "active", text: game.current.join(""), prev });
  if (playing() && lengthShown(game.settings)) {
    while (rows.length < game.best.length - 1) rows.push({ kind: "blank" });
  }
  rows.push({ kind: "fixed", text: game.end });
  return rows;
}

// The tiles are updated in place, and rows only added or removed as needed, since replacing
// them all on every key can make phone browsers scroll the page.
function drawBoard() {
  const n = game?.settings.length ?? readSettings().length ?? DEFAULTS.length;
  board.style.setProperty("--n", n);
  const rows = boardRows();
  if (board.firstElementChild && board.firstElementChild.children.length !== n) board.replaceChildren();
  while (board.children.length > rows.length) board.lastElementChild.remove();
  while (board.children.length < rows.length) {
    const row = document.createElement("div");
    for (let i = 0; i < n; i++) row.appendChild(document.createElement("div"));
    board.appendChild(row);
  }
  rows.forEach((row, r) => {
    const el = board.children[r];
    const rowClass = row.kind === "active" ? "board-row active" : "board-row";
    if (el.className !== rowClass) el.className = rowClass;
    [...el.children].forEach((tile, i) => {
      const letter = row.text?.[i] ?? "";
      let className = "tile";
      if (row.kind === "fixed") className += " fixed";
      else if (row.kind === "done" || row.kind === "shown") {
        className += row.text[i] === row.prev[i] ? " done" : row.kind === "shown" ? " shown" : " changed";
      }
      else if (row.kind === "active") {
        if (row.text[i] === row.prev[i]) className += " ghost";
        if (i === game.selected) className += " selected";
      }
      if (tile.textContent !== letter) tile.textContent = letter;
      if (tile.className !== className) tile.className = className;
      tile.dataset.index = i;
    });
  });
}

function drawKeyboard() {
  const keyboard = $("keyboard");
  keyboard.replaceChildren();
  for (const keys of KEY_ROWS) {
    const row = document.createElement("div");
    row.className = "key-row";
    for (const k of keys) {
      const key = document.createElement("button");
      key.type = "button";
      key.tabIndex = -1;
      key.className = "key";
      if (k === "+") {
        Object.assign(key, { textContent: "Enter", className: "key wide" });
        key.dataset.key = "Enter";
      } else if (k === "-") {
        Object.assign(key, { textContent: "⌫", className: "key wide", title: "Backspace" });
        key.setAttribute("aria-label", "Backspace");
        key.dataset.key = "Backspace";
      } else {
        key.textContent = k;
        key.dataset.key = k;
      }
      row.appendChild(key);
    }
    keyboard.appendChild(row);
  }
}

// ---- history

function rulesSummary({ settings: s, lists }) {
  const parts = [`${s.length} letters`, `${s.fewer ? "≤ " : ""}${s.steps} steps`];
  if (s.shortest) parts.push("shortest only");
  if (s.capitals) parts.push("capitals");
  if (s.phrases) parts.push("phrases");
  const [words, at] = lists ?? [];
  if (words) parts.push(words);
  if (at) parts.push(`@ ${at}`);
  return parts.join(" · ");
}

function addHistory(entry) {
  const history = storage.get(HISTORY_KEY) ?? [];
  history.unshift(entry);
  storage.set(HISTORY_KEY, history.slice(0, 500));
  renderHistory(history);
}

function renderHistory(history = storage.get(HISTORY_KEY) ?? []) {
  const body = $("history");
  body.replaceChildren();
  for (const h of history) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td></td><td class="${h.won ? "win" : "lose"}"></td><td class="num"></td><td class="rules"></td>`;
    const cells = tr.children;
    cells[0].textContent = `${h.forms[0].join(" / ")} → ${h.forms[1].join(" / ")}`;
    cells[1].textContent = h.won ? `✓ in ${h.steps} (shortest ${h.par})` : `gave up after ${count(h.steps, "word")}`;
    cells[2].textContent = h.seconds >= 60 ? `${Math.floor(h.seconds / 60)}m ${h.seconds % 60}s` : `${h.seconds}s`;
    cells[3].textContent = rulesSummary(h);
    body.appendChild(tr);
  }
  $("history-empty").hidden = history.length > 0;
  $("clear-history").disabled = !history.length;
}

// ---- wiring

applySettings(loadSettings());
listsChanged();
drawBoard();
drawKeyboard();
renderHistory();

for (const slot of Object.values(SLOTS)) {
  $(slot.load).addEventListener("click", () => $(slot.file).click());
  $(slot.file).addEventListener("change", () => loadListFile(slot));
  $(slot.clear).addEventListener("click", () => clearList(slot));
}
for (const el of document.querySelectorAll("#setup input:not([type=file])")) {
  el.addEventListener(el.type === "number" ? "input" : "change", settingsChanged);
}
$("new-game").addEventListener("click", newGame);
$("undo").addEventListener("click", undo);
$("give-up").addEventListener("click", () => playing() && endGame("give-up"));
board.addEventListener("click", (e) => {
  const tile = e.target.closest(".board-row.active .tile");
  if (tile) select(Number(tile.dataset.index));
});
$("keyboard").addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus off the keys
$("keyboard").addEventListener("click", (e) => {
  const key = e.target.closest(".key")?.dataset.key;
  if (key === "Enter") submit();
  else if (key === "Backspace") backspace();
  else if (key) type(key);
});
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
  if (e.target.closest?.("input, select, textarea")) return;
  if (!playing()) {
    // Enter starts a game, unless it's pressing a button
    if (e.key === "Enter" && e.target.tagName !== "BUTTON" && !$("new-game").disabled) {
      e.preventDefault();
      newGame();
    }
    return;
  }
  if (e.key === "Enter") {
    if (e.target.tagName === "BUTTON") return; // pressing a button, such as Undo
    submit();
  } else if (e.key === "Backspace") backspace();
  else if (e.key === "ArrowLeft") select(game.selected - 1);
  else if (e.key === "ArrowRight") select(game.selected + 1);
  else if (e.key === "Home") select(0);
  else if (e.key === "End") select(game.current.length - 1);
  else if (e.key.length === 1 || [...e.key].length === 1) {
    // accented letters count as their plain ones
    const c = letters(e.key);
    if (c.length !== 1 || !/[A-Z]/.test(c)) return;
    type(c);
  } else return;
  e.preventDefault();
});
$("clear-history").addEventListener("click", () => {
  if (!confirm("Clear the history?")) return;
  storage.set(HISTORY_KEY, []);
  renderHistory([]);
});

// The page works straight away, and again once any stored lists are loaded.
Promise.all([fetchList(SLOTS.words), fetchList(SLOTS.at)]).then(([words, at]) => {
  if (words && SLOTS.words.list === null) SLOTS.words.list = makeList(words.name, words.text);
  if (at && SLOTS.at.list === null) SLOTS.at.list = makeList(at.name, at.text);
  listsChanged();
});
