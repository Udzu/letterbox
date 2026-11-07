// The Wordlists page: the lists in wordlists/, each of which can be loaded into the shared word
// list slot used by the Anagrams, Pangrams and Patterns pages, or downloaded. Either way the
// list is stripped of comments and blank lines (apart from a downloaded list's attribution, which
// the other pages skip), so a downloaded list loads with the same words.

import { downloadText, stripList, wordCount } from "./lists.js";

// [{ file, name, description, kind, attribution?, size }], general lists first and then by name,
// written into the page by the build
const LISTS = JSON.parse(document.getElementById("lists-data").textContent);

// the word list entry shared by the Anagrams, Pangrams and Patterns pages
const DB = { name: "patterns", store: "wordlist", key: "list" };

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB.store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// unlike on the other pages, failing to store a list is an error worth reporting
async function storeWordList(value) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB.store, "readwrite");
    tx.objectStore(DB.store).put(value, DB.key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
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

const rows = new Map(); // file -> { li, badge, status }

// show which list (if any) is in the shared slot; null if none, or not one of these
function markLoaded(name) {
  for (const [file, row] of rows) {
    row.badge.hidden = file !== name;
    row.li.classList.toggle("current", file === name);
  }
}

// a list loaded or cleared elsewhere (on another page, or in another tab) shows up on return
async function refreshLoaded() {
  const stored = await fetchWordList();
  markLoaded(stored?.name ?? null);
}

function setStatus(row, message, error = false) {
  row.status.textContent = message;
  row.status.classList.toggle("error", error);
}

async function load(list, row) {
  setStatus(row, "Loading…");
  let text;
  try {
    text = await listText(list);
  } catch (e) {
    setStatus(row, `Couldn't fetch the list (${e.message}).`, true);
    return;
  }
  try {
    await storeWordList({ name: list.file, text });
  } catch {
    setStatus(row, "This browser won't store the list, but you can download it and load it on each page instead.", true);
    return;
  }
  markLoaded(list.file);
  for (const other of rows.values()) setStatus(other, "");
  setStatus(row, `Loaded ${count(wordCount(text), "word")}. Reload any of the other pages that are already open to see it.`);
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
  const loadButton = element("button", "", "Load");
  loadButton.title = "Use this list on the other pages";
  const downloadButton = element("button", "", "Download");
  downloadButton.title = `Save the list as ${list.file}`;
  const badge = element("span", "loaded", "Loaded");
  badge.hidden = true;
  const title = element("div", "title");
  title.append(element("span", "name", list.name), element("span", "size", count(list.size, "word")), loadButton, downloadButton, badge);
  const status = element("p", "status");
  status.setAttribute("aria-live", "polite");
  const li = element("li");
  li.append(title, element("p", "description", list.description));
  if (list.attribution) li.append(linkify(list.attribution));
  li.append(status);
  group.ul.append(li);

  const row = { li, badge, status };
  rows.set(list.file, row);
  loadButton.addEventListener("click", () => load(list, row));
  downloadButton.addEventListener("click", () => download(list, row));
}

// a list loaded from this page (or a file with the same name) is marked as loaded
refreshLoaded();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshLoaded();
});
