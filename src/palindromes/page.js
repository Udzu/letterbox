// The Palindromes page: forwards and backwards boxes kept in sync, word suggestions for the
// ends of the boxes from the shared word list, and a list of attempts.

import { parseWords } from "../patterns/wordlist.js";
import { ENDS, endModes, entryInfo, extend, extensions, reversibles } from "./ends.js";

const STORAGE_KEY = "palindrome-attempts";
const BOXES_KEY = "palindrome-boxes";
const left = document.getElementById("left");
const middle = document.getElementById("middle");
const right = document.getElementById("right");
const addButton = document.getElementById("add");
const attemptsList = document.getElementById("attempts");

// letters are handled as arrays of code points, so letters outside the BMP work
const isLetter = ch => /[\p{L}0-9]/u.test(ch);
const letters = s => [...s].filter(isLetter);
const reverse = arr => [...arr].reverse();

// Replace the letters with indices [start, end) in text with ins, leaving any
// non-letters (spaces, punctuation) where they are.
function spliceLetters(text, start, end, ins) {
  const positions = [];
  [...text].forEach((ch, i) => { if (isLetter(ch)) positions.push(i); });
  let insPos;
  if (start < end) insPos = positions[start];
  else if (start > 0) insPos = positions[start - 1] + 1;
  else if (positions.length > 0) insPos = positions[0];
  else insPos = text.length;
  const deleted = new Set(positions.slice(start, end));
  let out = "";
  [...text].forEach((ch, i) => {
    if (i === insPos) out += ins;
    if (!deleted.has(i)) out += ch;
  });
  if (insPos === text.length) out += ins;
  return out;
}

// Propagate an edit in source to target, which holds the same letters reversed.
function sync(source, target) {
  const newLetters = letters(source.value);
  const oldLetters = reverse(letters(target.value));
  // compare case-insensitively, so each side can have its own capitalisation
  const newLower = newLetters.map(ch => ch.toLowerCase());
  const oldLower = oldLetters.map(ch => ch.toLowerCase());
  if (newLower.join("") === oldLower.join("")) return;
  // find the changed region via common prefix and suffix
  let p = 0;
  while (p < newLower.length && p < oldLower.length && newLower[p] === oldLower[p]) p++;
  let s = 0;
  while (s < newLower.length - p && s < oldLower.length - p &&
         newLower[newLower.length - 1 - s] === oldLower[oldLower.length - 1 - s]) s++;
  const inserted = newLetters.slice(p, newLetters.length - s);
  // in the reversed text, the region [p, len - s) becomes [s, len - p)
  target.value = spliceLetters(target.value, s, oldLetters.length - p, reverse(inserted).join(""));
}

// the boxes are kept in local storage, where available, so a reload doesn't lose them
function saveBoxes() {
  try {
    localStorage.setItem(BOXES_KEY, JSON.stringify({ left: left.value, middle: middle.value, right: right.value }));
  } catch (e) {}
}
try {
  const saved = JSON.parse(localStorage.getItem(BOXES_KEY));
  if (saved) for (const box of [left, middle, right]) if (typeof saved[box.id] === "string") box.value = saved[box.id];
} catch (e) {}

left.addEventListener("input", () => { sync(left, right); saveBoxes(); showEnds(); });
right.addEventListener("input", () => { sync(right, left); saveBoxes(); showEnds(); });
middle.addEventListener("input", saveBoxes);

// attempts list, saved in the browser's local storage where available;
// each attempt keeps its three parts so it can be loaded back into the boxes
let attempts = [];
try {
  attempts = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
} catch (e) {}

const joined = a => a.left + a.middle + a.right;

function saveAttempts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts));
  } catch (e) {}
}

const letterCount = a => (joined(a).match(/\p{L}/gu) || []).length;

function renderAttempts() {
  attemptsList.innerHTML = "";
  attempts.sort((a, b) => letterCount(a) - letterCount(b) || joined(a).localeCompare(joined(b)));
  attempts.forEach((attempt, i) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "text";
    span.textContent = `[${letterCount(attempt)}] ${joined(attempt)}`;
    span.title = "Load into boxes";
    span.addEventListener("click", () => {
      left.value = attempt.left;
      middle.value = attempt.middle;
      right.value = attempt.right;
      saveBoxes();
      showEnds();
      left.focus();
    });
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.title = "Remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      attempts.splice(i, 1);
      saveAttempts();
      renderAttempts();
    });
    li.append(span, remove);
    attemptsList.appendChild(li);
  });
}

addButton.addEventListener("click", () => {
  const attempt = { left: left.value, middle: middle.value, right: right.value };
  if (joined(attempt).trim() === "") return;
  attempts.push(attempt);
  saveAttempts();
  renderAttempts();
});

document.getElementById("export").addEventListener("click", () => {
  if (attempts.length === 0) return;
  const blob = new Blob([attempts.map(joined).join("\n") + "\n"], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "palindromes.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

document.getElementById("clear").addEventListener("click", () => {
  if (attempts.length === 0 || !confirm("Clear all attempts?")) return;
  attempts = [];
  saveAttempts();
  renderAttempts();
});

for (const box of [left, middle, right]) {
  box.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addButton.click();
    }
  });
}

renderAttempts();

// ---- word suggestions for the four ends, from the word list stored in IndexedDB under the
// same entry as the other pages use, so a list loaded on any page is available on all of them

const DB = { name: "patterns", store: "wordlist", key: "list" };
const SHOWN = 50;
const endsBox = document.getElementById("ends");
const listInfo = document.getElementById("list-info");
const clearWordsButton = document.getElementById("clear-words");
const boxes = { left, right };
let wordList = null; // { name, size, infos }, in the list's order
// for each end: the letters its suggestions were found for, the suggestions, how many are
// shown and whether they're hidden (until the word at the end changes)
const found = ENDS.map(() => ({ key: null, extensions: [], shown: SHOWN, hidden: false }));

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
  } catch (e) {}
}

async function fetchWordList() {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(DB.store).objectStore(DB.store).get(DB.key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    return null;
  }
}

const entries = n => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;

function setWordList(list) {
  wordList = list;
  clearWordsButton.disabled = list === null;
  listInfo.textContent = list === null ? "None loaded" : `${list.name}: ${entries(list.size)}`;
  for (const f of found) f.key = null;
  showEnds();
}

const makeWordList = (name, words) => ({ name, size: words.length, infos: words.map(entryInfo).filter(i => i !== null) });

const span = (className, text) => {
  const s = document.createElement("span");
  s.className = className;
  s.textContent = text;
  return s;
};

// The entry with its added part in bold, as it reads in its box.
function wordSpan(ext, at) {
  const word = span("word", "");
  const added = document.createElement("b");
  added.textContent = ext.added;
  if (at === "start") word.append(added, ext.matched);
  else word.append(ext.matched, added);
  return word;
}

// A column under each end of the boxes, listing the word list's entries that extend the word
// there, in the list's order. Each shows, in palindrome order, the new word and the letters
// added at the other side: "…" between them for the outer ends and "·" for the middle.
function showEnds() {
  const modes = endModes(left.value, right.value);
  endsBox.replaceChildren(...ENDS.map(({ box, at }, i) => {
    const div = document.createElement("div");
    div.className = "end";
    const mode = modes[i];
    if (wordList === null || mode === null) {
      div.hidden = true;
      return div;
    }
    const f = found[i];
    // a closed end's words are the same wherever it is, so they stay hidden until it opens
    const key = mode.reversible ? "" : mode.fragment.letters;
    if (f.key !== key) {
      f.key = key;
      if (!mode.reversible) f.extensions = extensions(wordList.infos, mode.fragment.letters, at);
      else {
        wordList.reversibles ??= reversibles(wordList.infos);
        f.extensions = wordList.reversibles;
      }
      f.shown = SHOWN;
      f.hidden = false;
    }
    const caption = document.createElement("div");
    caption.className = "caption";
    if (mode.reversible) {
      caption.append("Palindromes and reversals");
      caption.title = "Entries whose letters reversed are also an entry, to add as whole words here and, reversed, at the other side";
    } else {
      const name = document.createElement("b");
      name.textContent = mode.fragment.text;
      if (at === "start") caption.append("…", name);
      else caption.append(name, "…");
    }
    caption.append(f.extensions.length === 0 ? ": no entries" : `: ${entries(f.extensions.length)}`);
    div.append(caption);
    if (f.extensions.length === 0) return div;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toggle";
    toggle.textContent = f.hidden ? "Show" : "Hide";
    toggle.title = f.hidden ? "Show these suggestions" : mode.reversible ? "Hide these suggestions until the end here is open" : "Hide these suggestions until the word here changes";
    toggle.addEventListener("click", () => {
      f.hidden = !f.hidden;
      showEnds();
    });
    caption.append(" ", toggle);
    if (f.hidden) return div;

    const outer = (box === "left") === (at === "start");
    const sep = span("sep", outer ? " … " : " · ");
    const ul = document.createElement("ul");
    for (const ext of f.extensions.slice(0, f.shown)) {
      const li = document.createElement("li");
      const mirror = span("mirror", ext.mirror);
      if (box === "left") li.append(wordSpan(ext, at), sep.cloneNode(true), mirror);
      else li.append(mirror, sep.cloneNode(true), wordSpan(ext, at));
      li.title = `Add “${ext.added}” here and “${ext.mirror}” at the other side`;
      // keep the focus where it is
      li.addEventListener("mousedown", e => e.preventDefault());
      li.addEventListener("click", () => choose(i, ext));
      ul.append(li);
    }
    div.append(ul);
    if (f.extensions.length > f.shown) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "more";
      more.textContent = "Show more";
      more.addEventListener("click", () => {
        f.shown += SHOWN;
        showEnds();
      });
      // the count, as the box scrolls and the button could be taken to show more than it holds
      const line = document.createElement("div");
      line.className = "more-line";
      line.append(`${f.shown.toLocaleString()} of ${f.extensions.length.toLocaleString()} listed `, more);
      div.append(line);
    }
    return div;
  }));
}

// Add an extension at an end: typed into its box (so Ctrl+Z can undo it there), with its mirror
// at the other side, spaced as extend() says.
function choose(end, ext) {
  const { box, at } = ENDS[end];
  const target = extend(left.value, right.value, end, ext);
  const own = boxes[box];
  const other = box === "left" ? right : left;
  const pos = at === "start" ? 0 : own.value.length;
  own.focus();
  own.setSelectionRange(pos, pos);
  // the input event this fires mirrors the letters, which are then spaced
  if (!document.execCommand("insertText", false, target.inserted) || own.value !== target[box]) own.value = target[box];
  other.value = target[box === "left" ? "right" : "left"];
  saveBoxes();
  showEnds();
}

document.getElementById("load-words").addEventListener("click", () => document.getElementById("words-file").click());
document.getElementById("words-file").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  listInfo.textContent = "Loading…";
  const contents = await file.text();
  e.target.value = "";
  setWordList(makeWordList(file.name, parseWords(contents)));
  storeWordList({ name: file.name, text: contents });
});
clearWordsButton.addEventListener("click", () => {
  setWordList(null);
  storeWordList(null);
});
setWordList(null);
fetchWordList().then(stored => {
  if (stored && wordList === null) setWordList(makeWordList(stored.name, parseWords(stored.text)));
});
