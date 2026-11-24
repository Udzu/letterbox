// The Lipograms page: write while avoiding some letters, check the word lengths against a
// sequence (Pilish), show acrostics, and list words from the shared word list that fit.

import { parseWords } from "../patterns/wordlist.js";
import { resetButton, setBox } from "../shared/reset.js";
import { acrostic, avoidedLetters, check, checkable, DIGITS, entryFilter, entryInfo, findWords, fold, nextLengths, plainLetters, restOf, sequenceFor, upcoming, wordAt } from "./text.js";

const TEXT_KEY = "lipogram-text";
const AVOID_KEY = "lipogram-avoid";
const SEQUENCE_KEY = "lipogram-sequence";
const CUSTOM_KEY = "lipogram-custom";
const ACROSTIC_KEY = "lipogram-acrostics";
const LETTERS_KEY = "lipogram-word-letters";
const $ = (id) => document.getElementById(id);
const text = $("text");
const avoid = $("avoid");
const backdrop = $("backdrop");
const summary = $("summary");
const copyButton = $("copy");
const copyNote = $("copy-note");
const sequenceSelect = $("sequence");
const customInput = $("custom");
const customHelp = $("custom-help");
const lengthsBox = $("lengths");
const checkNote = $("check-note");
const firstBox = $("acrostic-first");
const lastBox = $("acrostic-last");
const unitButtons = [...document.querySelectorAll("#acrostic-unit button")];
const acrosticBoxes = $("acrostic-boxes");
let acrosticUnit = "words";

// Reset clears the text and goes back to avoiding e, and then becomes Undo until they change again
const reset = resetButton($("reset"), {
  snapshot: () => ({ text: text.value, avoid: avoid.value }),
  clear: () => {
    setBox(avoid, "e");
    setBox(text, "");
    update();
  },
  restore: (state) => {
    setBox(avoid, state.avoid);
    setBox(text, state.text);
    update();
  },
});

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(text.value);
  } catch (e) {
    // fallback for browsers that block the clipboard API on local files
    text.select();
    document.execCommand("copy");
  }
  copyButton.textContent = "Copied!";
  setTimeout(() => { copyButton.textContent = "Copy"; }, 1500);
});

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch (e) {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {}
}

function showAcrostics(words) {
  for (const button of unitButtons) button.setAttribute("aria-pressed", String(button.dataset.unit === acrosticUnit));
  const boxes = [];
  for (const [which, box, caption] of [["first", firstBox, "First letters"], ["last", lastBox, "Last letters"]]) {
    if (!box.checked) continue;
    const div = document.createElement("div");
    div.className = "acrostic";
    const label = document.createElement("div");
    label.className = "caption";
    label.textContent = `${caption} of ${acrosticUnit}`;
    const letters = document.createElement("div");
    letters.className = "letters";
    for (const rowText of acrostic(text.value, words, which, acrosticUnit)) {
      const row = document.createElement("div");
      row.className = "row";
      row.textContent = rowText;
      letters.append(row);
    }
    div.append(label, letters);
    boxes.push(div);
  }
  acrosticBoxes.replaceChildren(...boxes);
}

const entries = (n) => `${n.toLocaleString()} ${n === 1 ? "entry" : "entries"}`;
const plural = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;

function showLengths(words, seq, result) {
  const rows = [];
  let row = null, rowLine = -1;
  // the lengths are only shown while checking them against something
  (seq ? words : []).forEach((word, i) => {
    if (row === null || word.line !== rowLine) {
      row = document.createElement("div");
      row.className = "row";
      rowLine = word.line;
      rows.push(row);
    }
    const span = document.createElement("span");
    span.className = "count";
    span.textContent = word.length;
    if (result) {
      if (i < result.matched) span.classList.add("ok");
      else if (i === result.matched && result.wrong) {
        span.classList.add("bad");
        const expected = document.createElement("span");
        expected.className = "expected";
        const lengths = upcoming(seq, result.used);
        expected.textContent = lengths.length === 0 ? " (expected no more words)" : ` (expected: ${lengths.join(" ")})`;
        span.append(expected);
      } else span.classList.add("after");
    }
    row.append(span);
  });
  // before there are any words, the box shows how to start
  if (result && row === null) {
    row = document.createElement("div");
    row.className = "row";
    const first = document.createElement("span");
    first.className = "expected";
    first.textContent = `Expected word lengths: ${upcoming(seq, 0).join(" ")}`;
    row.append(first);
    rows.push(row);
  }
  // while everything matches, the end of the counts shows what comes next
  else if (result && !result.wrong && !result.beyond) {
    const next = document.createElement("span");
    next.className = "expected";
    const lengths = upcoming(seq, result.used);
    next.textContent = lengths.length === 0 ? "(end)" : `(next: ${lengths.join(" ")})`;
    row.append(next);
  }
  lengthsBox.replaceChildren(...rows);

  if (!seq || seq.unchecked) {
    checkNote.textContent = "";
  } else if (seq.error) {
    checkNote.textContent = seq.error;
  } else if (result.beyond) {
    checkNote.textContent = `The text goes beyond the first ${DIGITS.toLocaleString()} digits of ${seq.name}, which is as far as this checks.`;
  } else {
    const total = seq.lengths ? seq.lengths.length : seq.digits.length;
    const unit = seq.lengths ? "length" : "digit";
    const matched = seq.lengths ? `${result.used.toLocaleString()} of ${plural(total, unit)}` : `${plural(result.used, unit)} of ${seq.name}`;
    if (result.wrong) {
      const word = words[result.matched];
      const where = text.value.includes("\n") ? ` (line ${word.line + 1})` : "";
      const quoted = `“${text.value.slice(word.start, word.end)}”${where}`;
      const [expected] = upcoming(seq, result.used, 1);
      checkNote.textContent = expected === undefined
        ? `${matched}, then ${quoted} goes past the end.`
        : `${matched}, then ${quoted} has ${plural(word.length, "letter")}, expected ${expected}.`;
    }
    else if (seq.finite && result.used === total) checkNote.innerHTML = `<span class="ok">✓ all ${plural(total, unit)} used</span>`;
    else if (result.used === 0) checkNote.textContent = "";
    else checkNote.innerHTML = `<span class="ok">✓ ${matched}</span>`;
  }
}

// ---- the word list, stored in IndexedDB under the same entry as the other pages use, so a
// list loaded on any page is available on all of them

const DB = { name: "patterns", store: "wordlist", key: "list" };
const SHOWN_WORDS = 100;
const collator = new Intl.Collator(undefined, { sensitivity: "base" }); // ignoring case and accents
const wordsBox = $("words");
const wordsInfo = $("words-info");
const listInfo = $("list-info");
const clearWordsButton = $("clear-words");
const firstInput = $("first-letter");
const lastInput = $("last-letter");
const completeBox = $("complete");
let wordList = null; // { name, size, infos }, in the list's order
let shownFor = null; // the filters and count the words were last listed for
let filtersFor = null; // the filters alone, to list from the start again when they change
let shownCount = SHOWN_WORDS;

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

function makeWordList(name, entries) {
  return { name, size: entries.length, infos: entries.map(entryInfo).filter((info) => info !== null) };
}

function setWordList(list) {
  wordList = list;
  clearWordsButton.disabled = $("words-filters").hidden = list === null;
  listInfo.textContent = list === null ? "None loaded" : `${list.name}: ${entries(list.size)}`;
  shownFor = null;
  update();
}


// List the entries that fit: they avoid the letters, start and end with the chosen letters,
// and, while checking the lengths, have the length(s) for the cursor's place, where a click adds
// them (unless the text goes wrong before it). With "Complete the word", when the cursor is in
// or just after a word, they must start with its letters before the cursor, and the cursor's
// place is that word's.
function showWords(words, seq, result) {
  if (wordList === null) {
    wordsInfo.textContent = "";
    wordsBox.replaceChildren();
    shownFor = null;
    return;
  }
  const avoided = avoidedLetters(avoid.value);
  const first = plainLetters(firstInput.value), last = plainLetters(lastInput.value);
  // with "Complete the word", the word at the cursor is being completed
  const current = currentWord(words);
  const completing = current !== null && completeBox.checked;
  // the words before the cursor's place: those before the word at the cursor, or that start
  // before the cursor (or the selection, which a click replaces)
  let before = current ? current.index : words.findIndex((w) => w.start >= text.selectionStart);
  if (before < 0) before = words.length;
  let slot = null, anyLength = "";
  if (result) {
    slot = check(words.slice(0, before), seq);
    // if the text goes wrong before then, the place's length isn't known (and the length where
    // it goes wrong would be no use, as a click adds the word at the cursor), which the
    // summary says
    if (slot.wrong || slot.beyond) {
      anyLength = ` (any length, as the text ${slot.wrong ? "goes wrong earlier" : `goes past the digits of ${seq.name} checked`})`;
      slot = null;
    }
  }
  const typed = completing ? plainLetters(current.typed) : "";
  const rest = slot ? restOf(seq, slot.used) : null;
  const filters = JSON.stringify([avoided, first, last, typed, slot ? [sequenceSelect.value, customInput.value, slot.used] : null]);
  if (filters !== filtersFor) shownCount = SHOWN_WORDS;
  filtersFor = filters;
  const key = `${filters} ${shownCount}`;
  if (key === shownFor) return;
  shownFor = key;

  const fits = entryFilter({ avoided, first, last, typed, rest });
  const found = wordList.infos.filter(fits);
  const shown = found.slice(0, shownCount);
  // sorted alphabetically, and while checking lengths (where a 1 can stand for 1 letter or
  // for 10 to 19), by the first word's length first; after "Show more", the words it added
  // are in grey
  const order = (a, b) => (rest ? a.words[0].length - b.words[0].length : 0) || collator.compare(a.entry, b.entry);
  const added = new Set(shownCount > SHOWN_WORDS ? shown.slice(shownCount - SHOWN_WORDS) : []);
  wordsBox.replaceChildren(...[...shown].sort(order).map((info) => {
    const span = document.createElement("span");
    span.className = added.has(info) ? "word added" : "word";
    span.textContent = info.entry;
    span.title = "Add to the text";
    return span;
  }));

  const conditions = [];
  if (avoided.length) conditions.push(`avoid ${avoided.join("")}`);
  if (first) conditions.push(`start with ${first}`);
  if (last) conditions.push(`end with ${last}`);
  if (completing) conditions.push(`complete “${current.typed}”`);
  if (rest) {
    // longer words still fit, but lengths over 20 (like 40 for 4, 0) are too rare to mention
    const next = nextLengths(rest).filter((n, i) => i === 0 || n <= 20);
    conditions.push(next.length === 0 ? "fit after the end of the sequence" : `fit the ${completing ? "length" : before < words.length ? "length at the cursor" : "next length"} (${next.join(" or ")})`);
  }
  // each condition starts with a verb, which takes an s for a single entry ("avoids e")
  if (found.length === 1) conditions.forEach((c, i) => { conditions[i] = c.replace(/^\w+/, "$&s"); });
  const which = (conditions.length === 0 ? "" : ` that ${conditions.length === 1 ? conditions[0] : `${conditions.slice(0, -1).join(", ")} and ${conditions.at(-1)}`}`) + anyLength;
  if (found.length === 0) {
    wordsInfo.textContent = `No entries${which}.`;
  } else {
    const all = shown.length === found.length;
    wordsInfo.textContent = `${entries(found.length)}${which}${all ? "" : `, showing the first ${shown.length.toLocaleString()}`}:`;
    // with more than one batch to show, Show less is always there (disabled for the first batch),
    // and Show more until everything is shown
    const button = (label, change, enabled) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.disabled = !enabled;
      b.addEventListener("click", () => {
        shownCount += change;
        update();
      });
      wordsInfo.append(" ", b);
    };
    if (found.length > SHOWN_WORDS) button("Show less", -SHOWN_WORDS, shownCount > SHOWN_WORDS);
    if (!all) button("Show more", SHOWN_WORDS, true);
  }
}


// The word the cursor (with nothing selected) is in or just after, which a click replaces: its
// index in `words`, the word and the text typed before the cursor; or null. The cursor counts
// even while the text isn't focused, as it's where words are added.
function currentWord(words) {
  const { selectionStart: start, selectionEnd: end } = text;
  if (start !== end) return null;
  const index = wordAt(words, end);
  return index < 0 ? null : { index, word: words[index], typed: text.value.slice(words[index].start, end) };
}

// Add a word at the cursor, in place of the word it's in or just after if there is one, with spaces
// to separate it from neighbouring words and a space after it at the end of the text (or
// moving past the space after it), ready for the next word, in a way Ctrl+Z can undo.
function insertWord(entry) {
  const current = currentWord(findWords(text.value));
  const start = current ? current.word.start : text.selectionStart;
  const end = current ? current.word.end : text.selectionEnd;
  const value = text.value;
  const before = start > 0 && !/\s/.test(value[start - 1]) ? " " : "";
  const after = end === value.length || /[\p{L}\p{N}]/u.test(value[end]) ? " " : "";
  const inserted = before + entry + after;
  text.focus();
  text.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, inserted)) {
    text.setRangeText(inserted, start, end, "end");
    update();
  }
  if (after === "" && text.value[text.selectionEnd] === " ") {
    text.setSelectionRange(text.selectionEnd + 1, text.selectionEnd + 1);
    refreshWords();
  }
}

// keep the cursor where it is in the text when clicking a word
wordsBox.addEventListener("mousedown", (e) => {
  if (e.target.classList.contains("word")) e.preventDefault();
});
wordsBox.addEventListener("click", (e) => {
  if (e.target.classList.contains("word")) insertWord(e.target.textContent);
});

$("load-words").addEventListener("click", () => $("words-file").click());
$("words-file").addEventListener("change", async (e) => {
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

// ----

function update() {
  reset.check();
  // avoided characters, ignoring whitespace; keep first-seen order for the breakdown
  const avoided = new Map(avoidedLetters(avoid.value).map((f) => [f, 0]));

  const words = findWords(text.value);
  customInput.hidden = customHelp.hidden = sequenceSelect.value !== "custom";
  const seq = sequenceFor(sequenceSelect.value, customInput.value);
  const result = checkable(seq) ? check(words, seq) : null;
  // the first word of the wrong length, if any, is underlined
  const bad = result && result.wrong ? words[result.matched] : null;

  let html = "", total = 0, index = 0;
  for (const ch of text.value) {
    if (bad && index === bad.start) html += `<span class="pilish-bad">`;
    if (bad && index === bad.end) html += `</span>`;
    index += ch.length;
    const hits = fold(ch).filter((f) => avoided.has(f));
    if (hits.length > 0) {
      for (const f of hits) avoided.set(f, avoided.get(f) + 1);
      total++;
      html += `<span class="bad">${escape(ch)}</span>`;
    } else {
      html += escape(ch);
    }
  }
  if (bad && index === bad.end) html += `</span>`;
  // a trailing newline needs something after it to take up a line
  backdrop.innerHTML = html + "​";

  text.style.height = "auto";
  text.style.height = text.scrollHeight + "px";

  let line = `Avoided letters used: ${total > 0 ? `<span class="bad">${total}</span>` : total}`;
  if (avoided.size > 1) {
    line += " (" + [...avoided].map(([ch, n]) => `${escape(ch)}: ${n}`).join(", ") + ")";
  }
  summary.innerHTML = line;
  copyButton.disabled = total > 0;
  copyNote.hidden = total === 0;

  showLengths(words, seq, result);
  showAcrostics(words);
  showWords(words, seq, result);

  save(TEXT_KEY, text.value);
  save(AVOID_KEY, avoid.value);
  save(SEQUENCE_KEY, sequenceSelect.value);
  save(CUSTOM_KEY, customInput.value);
  save(ACROSTIC_KEY, JSON.stringify({ first: firstBox.checked, last: lastBox.checked, unit: acrosticUnit }));
  save(LETTERS_KEY, JSON.stringify({ first: firstInput.value, last: lastInput.value, complete: completeBox.checked }));
}

// list the words again for where the cursor now is (cheap when nothing changed)
function refreshWords() {
  const words = findWords(text.value);
  const seq = sequenceFor(sequenceSelect.value, customInput.value);
  showWords(words, seq, checkable(seq) ? check(words, seq) : null);
}

text.value = load(TEXT_KEY, "");
avoid.value = load(AVOID_KEY, "e");
sequenceSelect.value = load(SEQUENCE_KEY, "");
if (sequenceSelect.selectedIndex < 0) sequenceSelect.selectedIndex = 0;
customInput.value = load(CUSTOM_KEY, "");
sequenceSelect.addEventListener("change", () => {
  update();
  if (sequenceSelect.value === "custom") customInput.focus();
});
customInput.addEventListener("input", update);
try {
  const saved = JSON.parse(load(ACROSTIC_KEY, "{}"));
  firstBox.checked = saved.first === true;
  lastBox.checked = saved.last === true;
  if (saved.unit === "lines") acrosticUnit = "lines";
} catch (e) {}
try {
  const saved = JSON.parse(load(LETTERS_KEY, "{}"));
  firstInput.value = typeof saved.first === "string" ? saved.first : "";
  lastInput.value = typeof saved.last === "string" ? saved.last : "";
  completeBox.checked = saved.complete !== false;
} catch (e) {}
firstBox.addEventListener("change", update);
lastBox.addEventListener("change", update);
for (const button of unitButtons) {
  button.addEventListener("click", () => {
    acrosticUnit = button.dataset.unit;
    update();
  });
}
text.addEventListener("input", update);
avoid.addEventListener("input", update);
firstInput.addEventListener("input", update);
lastInput.addEventListener("input", update);
completeBox.addEventListener("change", update);
document.addEventListener("selectionchange", () => wordList && refreshWords());
window.addEventListener("resize", update);
setWordList(null);
fetchWordList().then((stored) => {
  if (stored && wordList === null) setWordList(makeWordList(stored.name, parseWords(stored.text)));
});
