// The Ladders page: change one word into another a letter at a time, with the puzzles taken
// from the word list and @ list shared with the Patterns and Words pages.

import { parseWords } from "../patterns/wordlist.js";
import { buildGraph, changedPositions, entryInfo, isStep, ladderWords, lengthRange, letters, makePuzzle, stepError, stepKind } from "./game.js";

const SETTINGS_KEY = "ladders-settings";
const HISTORY_KEY = "ladders-history";
const DEFAULTS = { length: 4, steps: 4, fewer: true, shortest: false, capitals: false, phrases: false, swaps: false, addRemove: false };
const MIN_LENGTH = 2, MAX_LENGTH = 15, MIN_STEPS = 2, MAX_STEPS = 30;
const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "+ZXCVBNM-"]; // + is Enter, - is Backspace
const DRAG_DISTANCE = 8; // how far (in pixels) a tile must be dragged to swap it, rather than select it

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
  const key = JSON.stringify([s.length, s.phrases, s.capitals, s.swaps, s.addRemove]);
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
    swaps: $("swaps").checked,
    addRemove: $("add-remove").checked,
  };
}

function applySettings(s) {
  $("length").value = s.length;
  $("steps").value = s.steps;
  $("fewer").checked = s.fewer;
  $("shortest").checked = s.shortest;
  $("capitals").checked = s.capitals;
  $("phrases").checked = s.phrases;
  $("swaps").checked = s.swaps;
  $("add-remove").checked = s.addRemove;
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
  showMoveHelp();
  if (!game) {
    drawBoard();
    drawKeyboard();
  }
}

// The help for the moves the settings (or the game's) allow.
function showMoveHelp() {
  const s = game?.settings ?? readSettings();
  $("help-swaps").hidden = !s.swaps;
  $("help-add-remove").hidden = !s.addRemove;
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
  const ends = words ? [...words.pool.keys()].filter((w) => w.length === s.length).length : 0;
  const extra = words ? words.allowed.size - ends : 0;
  $("counts").textContent = !words
    ? "Load a word list to play."
    : `${count(ends, "word")} to start and end with${extra ? `, and ${extra.toLocaleString()} more for steps` : ""}, with these rules.`;
  $("new-game").disabled = ends < 2;
}

// ---- the game

// { start, end, best (a shortest ladder), forms, words, settings, rows (the words played),
//   current (the letters of the word being made, with "" for an added letter not yet typed),
//   selected (a letter's index, or just past the last letter, for adding one there), began, over }
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
  if (!words || $("new-game").disabled) return;
  words.graph ??= buildGraph(words.pool.keys(), s);
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
  showMoveHelp();
  drawBoard();
  drawKeyboard();
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

// Whether a letter can be added at the end of the word being made.
const canAppend = () => game.settings.addRemove && game.current.length < lengthRange(game.settings)[1];

function select(i) {
  if (!playing()) return;
  game.selected = Math.max(0, Math.min(game.current.length - (canAppend() ? 0 : 1), i));
  drawBoard();
}

function type(c) {
  if (!playing()) return;
  if (game.selected === game.current.length) game.current.push(c);
  else game.current[game.selected] = c;
  game.selected = Math.min(game.selected + 1, game.current.length - 1);
  setMessage("");
  drawBoard();
}

// Add a blank letter before the selected one (or at the end), to be typed.
function insert() {
  if (!playing() || !game.settings.addRemove || game.current.length >= lengthRange(game.settings)[1]) return;
  game.current.splice(game.selected, 0, "");
  setMessage("");
  drawBoard();
}

// Remove the selected letter.
function remove() {
  if (!playing() || !game.settings.addRemove || game.current.length <= lengthRange(game.settings)[0]) return;
  if (game.selected >= game.current.length) return;
  game.current.splice(game.selected, 1);
  game.selected = Math.min(game.selected, game.current.length - (canAppend() ? 0 : 1));
  setMessage("");
  drawBoard();
}

// Swap two letters.
function swap(i, j) {
  const n = game.current.length;
  if (!playing() || !game.settings.swaps || i === j || i < 0 || j < 0 || i >= n || j >= n) return;
  [game.current[i], game.current[j]] = [game.current[j], game.current[i]];
  game.selected = j;
  setMessage("");
  drawBoard();
}

// Put back the selected letter if it was changed, or else the nearest changed letter before
// it; with nothing changed, undo the last step. If letters were added, removed or swapped, put
// the whole word back.
function backspace() {
  if (!playing()) return;
  const prev = previous();
  if (game.current.length !== prev.length || stepKind(prev, game.current.join("")) === "swap") {
    game.current = [...prev];
    game.selected = 0;
    setMessage("");
    drawBoard();
    return;
  }
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
  const [min, max] = lengthRange(game.settings);
  let error = game.current.includes("") ? "Type the added letter" : null;
  if (!error && (word.length < min || word.length > max)) error = `Words can have ${min} to ${max} letters`;
  error ??= stepError(prev, word, game.settings);
  if (!error && !game.words.allowed.has(word)) error = "Not in the lists";
  if (!error && (word === game.start || word === game.end || game.rows.includes(word))) error = "Already in the ladder";
  if (!error && game.rows.length + 1 >= maxRows() && !isStep(word, game.end, game.settings)) {
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
  if (isStep(word, game.end, game.settings)) endGame("win");
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

// The tiles of a row: [letter, class] pairs.
function rowTiles(row, n) {
  if (row.kind === "blank") return Array.from({ length: n }, () => ["", "tile"]);
  if (row.kind === "fixed") return [...row.text].map((c) => [c, "tile fixed"]);
  if (row.kind === "active") {
    const word = game.current.join("");
    // which letters are new, once the word has no blanks (until then, the letters that moved)
    const changed = new Set(game.current.includes("") ? [] : changedPositions(row.prev, word));
    const tiles = game.current.map((c, i) => {
      let cls = "tile";
      if (c === "") cls += " added";
      else if (!changed.has(i) && (game.current.length !== row.prev.length || c === row.prev[i])) cls += " ghost";
      if (i === game.selected) cls += " selected";
      return [c, cls];
    });
    if (canAppend()) tiles.push(["", `tile slot${game.selected === game.current.length ? " selected" : ""}`]);
    return tiles;
  }
  const changed = new Set(changedPositions(row.prev, row.text));
  const mark = row.kind === "shown" ? " shown" : " changed";
  return [...row.text].map((c, i) => [c, `tile${changed.has(i) ? mark : " done"}`]);
}

// The tiles are updated in place, and rows only added or removed as needed, since replacing
// them all on every key can make phone browsers scroll the page. Rows are centred, and tiles
// are sized for the longest word allowed.
function drawBoard() {
  const s = game?.settings ?? readSettings();
  const length = s.length ?? DEFAULTS.length;
  board.style.setProperty("--n", lengthRange({ ...s, length })[1]);
  board.classList.toggle("swappable", playing() && game.settings.swaps);
  const rows = boardRows();
  while (board.children.length > rows.length) board.lastElementChild.remove();
  while (board.children.length < rows.length) board.appendChild(document.createElement("div"));
  rows.forEach((row, r) => {
    const el = board.children[r];
    const rowClass = row.kind === "active" ? "board-row active" : "board-row";
    if (el.className !== rowClass) el.className = rowClass;
    const tiles = rowTiles(row, length);
    while (el.children.length > tiles.length) el.lastElementChild.remove();
    while (el.children.length < tiles.length) el.appendChild(document.createElement("div"));
    tiles.forEach(([letter, className], i) => {
      const tile = el.children[i];
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
  if ((game?.settings ?? readSettings()).addRemove) {
    const row = document.createElement("div");
    row.className = "key-row";
    for (const [label, name, title] of [["Insert", "Insert", "Add a letter before the selected one"], ["Delete", "Delete", "Remove the selected letter"]]) {
      const key = document.createElement("button");
      Object.assign(key, { type: "button", tabIndex: -1, className: "key action", textContent: label, title });
      key.dataset.key = name;
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
  if (s.swaps) parts.push("swaps");
  if (s.addRemove) parts.push("add/remove");
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
showMoveHelp();
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
// Tapping a tile of the word being made selects it; with swaps, dragging one onto another
// swaps them.
let drag = null; // { from, x, y, moved, over }
const activeTileAt = (x, y) => document.elementFromPoint(x, y)?.closest(".board-row.active .tile:not(.slot)") ?? null;
function markDrop(tile) {
  if (drag.over === tile) return;
  drag.over?.classList.remove("drop");
  drag.over = tile;
  tile?.classList.add("drop");
}
board.addEventListener("pointerdown", (e) => {
  const tile = e.target.closest(".board-row.active .tile");
  if (!tile || !playing() || e.button > 0) return;
  e.preventDefault();
  drag = { from: Number(tile.dataset.index), slot: tile.classList.contains("slot"), x: e.clientX, y: e.clientY, moved: false, over: null };
  board.setPointerCapture(e.pointerId);
});
board.addEventListener("pointermove", (e) => {
  if (!drag || drag.slot || !game.settings.swaps) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_DISTANCE) return;
  if (!drag.moved) board.querySelector(`.board-row.active .tile[data-index="${drag.from}"]`)?.classList.add("dragging");
  drag.moved = true;
  const tile = activeTileAt(e.clientX, e.clientY);
  markDrop(tile && Number(tile.dataset.index) !== drag.from ? tile : null);
});
function endDrag(e, cancelled) {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.over?.classList.remove("drop");
  if (cancelled) return drawBoard();
  if (!d.moved) return select(d.from);
  const tile = activeTileAt(e.clientX, e.clientY);
  if (tile) swap(d.from, Number(tile.dataset.index));
  drawBoard();
}
board.addEventListener("pointerup", (e) => endDrag(e, false));
board.addEventListener("pointercancel", (e) => endDrag(e, true));
$("keyboard").addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus off the keys
$("keyboard").addEventListener("click", (e) => {
  const key = e.target.closest(".key")?.dataset.key;
  if (key === "Enter") submit();
  else if (key === "Backspace") backspace();
  else if (key === "Insert") insert();
  else if (key === "Delete") remove();
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
  else if (e.key === "Delete") remove();
  else if (e.key === "Insert") insert();
  else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && e.shiftKey && game.settings.swaps) {
    swap(game.selected, game.selected + (e.key === "ArrowLeft" ? -1 : 1));
  } else if (e.key === "ArrowLeft") select(game.selected - 1);
  else if (e.key === "ArrowRight") select(game.selected + 1);
  else if (e.key === "Home") select(0);
  else if (e.key === "End") select(game.current.length);
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
