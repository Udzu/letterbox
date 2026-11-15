// The Guesses page: find a hidden word from coloured clues, with the answers and valid
// guesses taken from the word list and @ list shared with the Patterns page.

import { parseWords } from "../patterns/wordlist.js";
import { entryInfo, letters, lockError, possible, puzzleWords, score } from "./game.js";

const SETTINGS_KEY = "guesses-settings";
const HISTORY_KEY = "guesses-history";
const DEFAULTS = { length: 5, phrases: false, duplicates: true, capitals: false, limited: true, limit: 6, lockGreens: false, lockYellows: false, showPossible: false };
const MIN_LENGTH = 2, MAX_LENGTH = 20, MAX_LIMIT = 30;
const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "+ZXCVBNM-"]; // + is Enter, - is Backspace
const RANK = { x: 1, y: 2, g: 3 };
const POSSIBLE_SHOWN = 1000;

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
const count = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : noun.endsWith("s") ? "es" : "s"}`;
const entries = (n) => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---- the lists, kept in IndexedDB under the same keys as the Patterns page's

const DB = { name: "patterns", store: "wordlist" };
const SLOTS = {
  words: { key: "list", load: "load-words", clear: "clear-words", info: "words-info", file: "words-file", none: "None loaded", list: null },
  at: { key: "at-list", load: "load-at", clear: "clear-at", info: "at-info", file: "at-file", none: "None loaded, so answers come from the word list", list: null },
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

// The answers and valid guesses for the current lists and the given settings.
function currentWords(s) {
  const key = JSON.stringify([s.length, s.phrases, s.duplicates, s.capitals]);
  if (wordsCache?.key !== key) {
    const words = SLOTS.words.list, at = SLOTS.at.list;
    wordsCache = {
      key,
      words: words ? puzzleWords(words.infos, at?.infos ?? null, s) : null,
    };
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
  const int = (id, min, max, fallback) => {
    const n = Number($(id).value);
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    length: int("length", MIN_LENGTH, MAX_LENGTH, null),
    phrases: $("phrases").checked,
    duplicates: $("duplicates").checked,
    capitals: $("capitals").checked,
    limited: $("limited").checked,
    limit: int("limit", 1, MAX_LIMIT, null),
    lockGreens: $("lock-greens").checked,
    lockYellows: $("lock-yellows").checked,
    showPossible: $("show-possible").checked,
  };
}

function applySettings(s) {
  $("length").value = s.length;
  $("phrases").checked = s.phrases;
  $("duplicates").checked = s.duplicates;
  $("capitals").checked = s.capitals;
  $("limited").checked = s.limited;
  $("limit").value = s.limit;
  $("lock-greens").checked = s.lockGreens;
  $("lock-yellows").checked = s.lockYellows;
  $("show-possible").checked = s.showPossible;
}

function loadSettings() {
  const s = { ...DEFAULTS, ...storage.get(SETTINGS_KEY) };
  if (!Number.isInteger(s.length) || s.length < MIN_LENGTH || s.length > MAX_LENGTH) s.length = DEFAULTS.length;
  if (!Number.isInteger(s.limit) || s.limit < 1 || s.limit > MAX_LIMIT) s.limit = DEFAULTS.limit;
  return s;
}

function settingsChanged() {
  const s = readSettings();
  $("limit").disabled = !s.limited;
  const saved = { ...s, length: s.length ?? loadSettings().length, limit: s.limit ?? loadSettings().limit };
  storage.set(SETTINGS_KEY, saved);
  showCounts();
  if (!game) drawBoard();
  showPossible();
}

// How many answers and guesses the settings give.
function showCounts() {
  const s = readSettings();
  const valid = s.length !== null && (s.limit !== null || !s.limited);
  $("new-game").disabled = !valid;
  if (!valid) {
    $("counts").textContent = "";
    return;
  }
  const words = currentWords(s);
  $("counts").textContent = !words
    ? "Load a word list to play."
    : `${count(words.answers.size, "answer")} and ${count(words.guesses.size, "allowed guess")} with these rules.`;
  $("new-game").disabled = !words?.answers.size;
}

// ---- the game

// { answer, forms, words, settings, rows: [{ guess, colours }], typed, start, over }
let game = null;

function newGame() {
  const s = readSettings();
  const words = currentWords(s);
  if (!words?.answers.size) return;
  const keys = [...words.answers.keys()];
  const answer = keys[randInt(keys.length)];
  game = { answer, forms: words.answers.get(answer), words, settings: s, rows: [], typed: "", start: Date.now(), over: false };
  setMessage("");
  lockSettings(true);
  drawBoard();
  drawKeyboard();
  showPossible();
  // on narrow screens the game is below the settings
  if (matchMedia("(max-width: 899px)").matches) $("game-section").scrollIntoView({ behavior: "smooth" });
  document.activeElement?.blur();
}

function lockSettings(locked) {
  for (const id of ["lists-set", "rules-set"]) $(id).disabled = locked;
  $("give-up").disabled = !locked;
}

const playing = () => game !== null && !game.over;

function type(c) {
  if (!playing() || game.typed.length >= game.settings.length) return;
  game.typed += c;
  setMessage("");
  drawBoard();
}

function backspace() {
  if (!playing() || !game.typed) return;
  game.typed = game.typed.slice(0, -1);
  setMessage("");
  drawBoard();
}

function submit() {
  if (!playing()) return;
  const guess = game.typed;
  let error = null;
  if (guess.length < game.settings.length) error = "Not enough letters";
  else if (!game.words.guesses.has(guess)) error = "Not in the lists";
  else error = lockError(guess, game.rows, game.settings);
  if (error) {
    setMessage(error, "error");
    const row = board.children[game.rows.length];
    row.classList.remove("shake");
    void row.offsetWidth; // restart the animation
    row.classList.add("shake");
    return;
  }
  game.rows.push({ guess, colours: score(guess, game.answer) });
  game.typed = "";
  drawBoard();
  drawKeyboard();
  showPossible();
  if (guess === game.answer) endGame("win");
  else if (game.settings.limited && game.rows.length >= game.settings.limit) endGame("lose");
}

function endGame(how) {
  game.over = true;
  lockSettings(false);
  const g = game;
  const seconds = Math.round((Date.now() - g.start) / 1000);
  addHistory({
    id: `${Date.now()}-${randInt(1e9)}`,
    answer: g.answer,
    forms: g.forms,
    won: how === "win",
    guesses: g.rows.length,
    gaveUp: how === "give-up",
    seconds,
    settings: g.settings,
    lists: [SLOTS.words.list?.name ?? null, SLOTS.at.list?.name ?? null],
  });
  const forms = `<span class="answer">${g.forms.map(escapeHtml).join(" / ")}</span>`;
  if (how === "win") setMessage(`Solved in ${count(g.rows.length, "guess")}: ${forms}`, "win", true);
  else setMessage(`${how === "give-up" ? "Given up" : "Out of guesses"}. The answer was ${forms}`, "", true);
  drawBoard();
  showPossible();
  $("new-game").focus();
}

function setMessage(text, cls = "", html = false) {
  message.className = cls;
  if (html) message.innerHTML = text;
  else message.textContent = text;
}

function drawBoard() {
  const s = game?.settings ?? readSettings();
  const n = s.length ?? DEFAULTS.length;
  board.style.setProperty("--n", n);
  const rows = game?.rows ?? [];
  // with a limit, every row is shown; without one, the guesses so far and the next
  const total = s.limited && s.limit ? Math.max(s.limit, rows.length) : rows.length + (playing() || !game ? 1 : 0);
  board.replaceChildren();
  for (let r = 0; r < total; r++) {
    const row = document.createElement("div");
    row.className = "board-row";
    const done = rows[r];
    const text = done ? done.guess : playing() && r === rows.length ? game.typed : "";
    for (let i = 0; i < n; i++) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.textContent = text[i] ?? "";
      if (done) tile.classList.add(done.colours[i] === "." ? "x" : done.colours[i]);
      else if (text[i]) tile.classList.add("filled");
      row.appendChild(tile);
    }
    board.appendChild(row);
  }
}

function drawKeyboard() {
  const best = new Map();
  for (const { guess, colours } of game?.rows ?? []) {
    for (let i = 0; i < guess.length; i++) {
      const c = colours[i] === "." ? "x" : colours[i];
      if ((RANK[c] ?? 0) > (RANK[best.get(guess[i])] ?? 0)) best.set(guess[i], c);
    }
  }
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
        if (best.has(k)) key.classList.add(best.get(k));
      }
      row.appendChild(key);
    }
    keyboard.appendChild(row);
  }
}

function showPossible() {
  const line = $("possible-line");
  const shown = readSettings().showPossible && playing();
  line.hidden = !shown;
  if (!shown) return;
  const left = possible(game.words.answers.keys(), game.rows);
  $("possible-count").textContent = `${count(left.length, "possible answer")}`;
  const list = $("possible-list");
  if (!list.hidden) {
    list.innerHTML = left.slice(0, POSSIBLE_SHOWN).map((w) => `<div>${w}</div>`).join("") + (left.length > POSSIBLE_SHOWN ? "<div>…</div>" : "");
  }
}

// ---- history

function rulesSummary({ settings: s, lists }) {
  const parts = [`${s.length} letters`];
  if (s.duplicates === false) parts.push("no repeated letters");
  if (s.capitals) parts.push("capitals");
  if (s.phrases) parts.push("phrases");
  parts.push(s.limited ? `limit ${s.limit}` : "no limit");
  if (s.lockGreens) parts.push("greens locked");
  if (s.lockYellows) parts.push("yellows locked");
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
    cells[0].textContent = h.forms.join(" / ");
    cells[1].textContent = h.won ? `✓ in ${h.guesses}` : h.gaveUp ? `gave up after ${h.guesses}` : `✗ (${h.guesses})`;
    cells[2].textContent = h.seconds >= 60 ? `${Math.floor(h.seconds / 60)}m ${h.seconds % 60}s` : `${h.seconds}s`;
    cells[3].textContent = rulesSummary(h);
    body.appendChild(tr);
  }
  $("history-empty").hidden = history.length > 0;
  $("clear-history").disabled = !history.length;
}

// ---- wiring

applySettings(loadSettings());
$("limit").disabled = !$("limited").checked;
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
$("give-up").addEventListener("click", () => playing() && endGame("give-up"));
$("possible-toggle").addEventListener("click", () => {
  const list = $("possible-list");
  list.hidden = !list.hidden;
  $("possible-toggle").textContent = list.hidden ? "List them" : "Hide list";
  showPossible();
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
  if (e.key === "Enter") submit();
  else if (e.key === "Backspace") backspace();
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
