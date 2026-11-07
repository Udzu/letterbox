// The Wordlists page: the lists in wordlists/, each of which can be loaded as the word list
// shared by the Anagrams, Pangrams and Patterns pages, or as the @ list that @ stands for on the
// Patterns page, or downloaded. Whichever it is, the
// list is stripped of comments and blank lines (apart from a downloaded list's attribution, which
// the other pages skip), so a downloaded list loads with the same words.

import { downloadText, stripList, wordCount } from "./lists.js";

// [{ file, name, description, kind, attribution?, size }], general lists first and then by name,
// written into the page by the build
const LISTS = JSON.parse(document.getElementById("lists-data").textContent);

// the stored entries for the word list shared by the Anagrams, Pangrams and Patterns pages, and
// for the Patterns page's @ list
const DB = { name: "patterns", store: "wordlist" };
// Each slot's button on a list's row loads it there, or unloads it if it's already there,
// and shows as pressed while it is.
const SLOTS = {
  words: {
    key: "list",
    rowClass: "loaded",
    button: "load",
    label: () => "Load",
    title: (on) => on
      ? "Unload the word list from the Anagrams, Pangrams and Patterns pages"
      : "Load as the word list on the Anagrams, Pangrams and Patterns pages, replacing the one they use now",
    current: null,
  },
  at: {
    key: "at-list",
    rowClass: "at",
    button: "at",
    label: () => "@",
    title: (on) => on
      ? "Stop using this as the @ list on the Patterns page, so @ stands for the word list again"
      : "Load as the @ list on the Patterns page, so @ stands for these words (matches still come from the word list)",
    current: null,
  },
};

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB.store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// unlike on the other pages, failing to store a list is an error worth reporting
async function storeList(slot, value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB.store, "readwrite");
    if (value === null) tx.objectStore(DB.store).delete(slot.key);
    else tx.objectStore(DB.store).put(value, slot.key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
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

const count = (n, noun) => `${n.toLocaleString()} ${noun}${n === 1 ? "" : "s"}`;

const texts = new Map(); // file -> stripped text, fetched when first needed
async function listText(list) {
  if (!texts.has(list.file)) {
    const response = await fetch(`wordlists/${encodeURIComponent(list.file)}`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    texts.set(list.file, stripList(await response.text()));
  }
  return texts.get(list.file);
}

const rows = new Map(); // file -> { li, buttons: { load, at }, status }

// show which list (if any) is in a slot: name is null if none, or one not on this page
function markSlot(slot, name) {
  slot.current = name;
  for (const [file, row] of rows) {
    const on = file === name;
    const button = row.buttons[slot.button];
    row.li.classList.toggle(slot.rowClass, on);
    button.textContent = slot.label(on);
    button.title = slot.title(on);
    button.setAttribute("aria-pressed", on);
  }
}

// lists loaded or cleared elsewhere (on another page, or in another tab) show up on return
async function refreshLoaded() {
  for (const slot of Object.values(SLOTS)) markSlot(slot, (await fetchList(slot))?.name ?? null);
}

function setStatus(row, message, error = false) {
  row.status.textContent = message;
  row.status.classList.toggle("error", error);
}

// the slot's button: load the list there, or unload it if it's there already
function toggle(list, row, slot) {
  if (slot.current === list.file) unload(row, slot);
  else load(list, row, slot);
}

async function unload(row, slot) {
  try {
    await storeList(slot, null);
  } catch {
    setStatus(row, "This browser wouldn't unload the list.", true);
    return;
  }
  markSlot(slot, null);
  for (const other of rows.values()) setStatus(other, "");
  setStatus(row, slot === SLOTS.words
    ? "Unloaded. Reload any of the other pages that are already open to see it."
    : "No longer the @ list, so @ on the Patterns page stands for the word list again. Reload Patterns if it's already open.");
}

async function load(list, row, slot) {
  setStatus(row, "Loading…");
  let text;
  try {
    text = await listText(list);
  } catch (e) {
    setStatus(row, `Couldn't fetch the list (${e.message}).`, true);
    return;
  }
  try {
    await storeList(slot, { name: list.file, text });
  } catch {
    setStatus(row, "This browser won't store the list, but you can download it and load it on each page instead.", true);
    return;
  }
  markSlot(slot, list.file);
  for (const other of rows.values()) setStatus(other, "");
  const words = count(wordCount(text), "word");
  setStatus(row, slot === SLOTS.words
    ? `Loaded ${words}. Reload any of the other pages that are already open to see it.`
    : `Loaded ${words} as the @ list, so @ on the Patterns page stands for these words. Reload Patterns if it's already open.`);
}

async function download(list, row) {
  let text;
  try {
    text = await listText(list);
  } catch (e) {
    setStatus(row, `Couldn't fetch the list (${e.message}).`, true);
    return;
  }
  setStatus(row, "");
  const url = URL.createObjectURL(new Blob([downloadText(text, list.attribution)], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = list.file;
  a.click();
  URL.revokeObjectURL(url);
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

// text with its web addresses turned into links (leaving out punctuation that ends a sentence
// or closes brackets around them)
function linkify(text) {
  const p = element("p", "attribution");
  for (const [i, part] of text.split(/(https?:\/\/\S*[^\s.,;:)])/).entries()) {
    if (i % 2 === 0) {
      p.append(part);
    } else {
      const a = element("a", "", part);
      a.href = part;
      p.append(a);
    }
  }
  return p;
}

// one <ul> per kind, so general lists are set apart from the topic lists after them
const listsBox = document.getElementById("lists");
let group = null;
for (const list of LISTS) {
  if (group?.kind !== list.kind) {
    group = { kind: list.kind, ul: element("ul") };
    listsBox.append(group.ul);
  }
  const buttons = { load: element("button", "load"), at: element("button", "at") };
  const downloadButton = element("button", "", "Download");
  downloadButton.title = `Save the list as ${list.file}`;
  const title = element("div", "title");
  title.append(element("span", "name", list.name), element("span", "size", count(list.size, "word")), buttons.load, buttons.at, downloadButton);
  const status = element("p", "status");
  status.setAttribute("aria-live", "polite");
  const li = element("li");
  li.append(title, element("p", "description", list.description));
  if (list.attribution) li.append(linkify(list.attribution));
  li.append(status);
  group.ul.append(li);

  const row = { li, buttons, status };
  rows.set(list.file, row);
  buttons.load.addEventListener("click", () => toggle(list, row, SLOTS.words));
  buttons.at.addEventListener("click", () => toggle(list, row, SLOTS.at));
  downloadButton.addEventListener("click", () => download(list, row));
}

// a list loaded from this page (or a file with the same name) is marked as loaded
for (const slot of Object.values(SLOTS)) markSlot(slot, null);
refreshLoaded();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshLoaded();
});
