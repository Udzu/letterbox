// The Wordlists page: the lists in wordlists/, each of which can be loaded into the shared word
// list slot used by the Anagrams, Pangrams and Patterns pages, or downloaded. Either way the
// list is stripped of comments and blank lines, so a downloaded list loads with the same words.

import { stripList, wordCount } from "./lists.js";

// [{ file, name, description, size }], sorted by name, written into the page by the build
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

const rows = new Map(); // file -> { badge, status }
let loadedName = null;

function markLoaded(name) {
  loadedName = name;
  for (const [file, row] of rows) row.badge.hidden = file !== name;
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
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
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

const listsBox = document.getElementById("lists");
for (const list of LISTS) {
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
  li.append(title, element("p", "description", list.description), status);
  listsBox.append(li);

  const row = { badge, status };
  rows.set(list.file, row);
  loadButton.addEventListener("click", () => load(list, row));
  downloadButton.addEventListener("click", () => download(list, row));
}

// a list loaded from this page (or a file with the same name) is marked as loaded
fetchWordList().then((stored) => {
  if (stored && loadedName === null) markLoaded(stored.name);
});
