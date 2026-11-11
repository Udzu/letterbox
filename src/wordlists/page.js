// The Wordlists page: the lists in wordlists/, each of which can be loaded as the word list
// shared by the Anagrams, Pangrams and Patterns pages (or added to it, combining lists), or as
// the @ list that @ stands for on the Patterns page, or downloaded. Whichever it is, the
// list is stripped of comments and blank lines (apart from a downloaded list's attribution, which
// the other pages skip), so a downloaded list loads with the same words.

import { TOPICS, appendList, attributionParts, downloadText, removeList, stripList, wordCount } from "./lists.js";

// [{ file, name, description, tag?, attribution?, size }], general lists first and then by name,
// written into the page by the build
const LISTS = JSON.parse(document.getElementById("lists-data").textContent);
const BY_FILE = new Map(LISTS.map((list) => [list.file, list]));

// the stored entries for the word list shared by the Anagrams, Pangrams and Patterns pages, and
// for the Patterns page's @ list: { name, text }, plus, for lists loaded here, the files they
// came from, as files: [file], in order. The word list can combine several lists, added with
// the + buttons; its name is then their file names joined by " + ", which the other pages show.
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
    current: [],
  },
  at: {
    key: "at-list",
    rowClass: "at",
    button: "at",
    label: () => "@",
    title: (on) => on
      ? "Stop using this as the @ list on the Patterns page, so @ stands for the word list again"
      : "Load as the @ list on the Patterns page, so @ stands for these words (matches still come from the word list)",
    current: [],
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

const rows = new Map(); // file -> { li, buttons: { load, add, at }, status }

// the files a stored list came from: just its name for one loaded elsewhere
const filesOf = (stored) => (stored === null ? [] : stored.files ?? [stored.name]);

// Show which lists are in a slot, given their files (some of which may not be on this page).
// The first list in the word list has its Load button pressed, and the others their + buttons.
function markSlot(slot, files) {
  slot.current = files;
  for (const [file, row] of rows) {
    const first = file === files[0];
    const button = row.buttons[slot.button];
    row.li.classList.toggle(slot.rowClass, files.includes(file));
    button.textContent = slot.label(first);
    button.title = slot.title(first);
    button.setAttribute("aria-pressed", first);
    if (slot !== SLOTS.words) continue;
    const added = files.includes(file) && !first;
    row.buttons.add.setAttribute("aria-pressed", added);
    row.buttons.add.disabled = first;
    row.buttons.add.title = first
      ? "This is the word list already"
      : added
        ? "Take this list out of the word list"
        : "Add this list to the word list on the Anagrams, Pangrams and Patterns pages, after the words already in it";
  }
}

// lists loaded or cleared elsewhere (on another page, or in another tab) show up on return
async function refreshLoaded() {
  for (const slot of Object.values(SLOTS)) markSlot(slot, filesOf(await fetchList(slot)));
}

function setStatus(row, message, error = false) {
  row.status.textContent = message;
  row.status.classList.toggle("error", error);
}

// the slot's button: load the list there, or unload it if it's there already
function toggle(list, row, slot) {
  if (slot.current[0] === list.file) unload(row, slot);
  else load(list, row, slot);
}

// the + button: add the list to the word list, or take it out if it's been added
function toggleAdd(list, row) {
  if (SLOTS.words.current.includes(list.file)) takeOut(list, row);
  else add(list, row);
}

async function unload(row, slot) {
  try {
    await storeList(slot, null);
  } catch {
    setStatus(row, "This browser wouldn't unload the list.", true);
    return;
  }
  markSlot(slot, []);
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
    await storeList(slot, { name: list.file, text, files: [list.file] });
  } catch {
    setStatus(row, "This browser won't store the list, but you can download it and load it on each page instead.", true);
    return;
  }
  markSlot(slot, [list.file]);
  for (const other of rows.values()) setStatus(other, "");
  const words = count(wordCount(text), "word");
  setStatus(row, slot === SLOTS.words
    ? `Loaded ${words}. Reload any of the other pages that are already open to see it.`
    : `Loaded ${words} as the @ list, so @ on the Patterns page stands for these words. Reload Patterns if it's already open.`);
}

// change the word list to the given files and text, reporting how it went in the row
async function storeWords(row, files, text, done) {
  try {
    await storeList(SLOTS.words, { name: files.join(" + "), text, files });
  } catch {
    setStatus(row, "This browser won't store the list.", true);
    return;
  }
  markSlot(SLOTS.words, files);
  for (const other of rows.values()) setStatus(other, "");
  setStatus(row, `${done} The word list is now ${files.join(" + ")}, with ${count(wordCount(text), "word")}. Reload any of the other pages that are already open to see it.`);
}

async function add(list, row) {
  const stored = await fetchList(SLOTS.words);
  if (stored === null) return load(list, row, SLOTS.words);
  setStatus(row, "Adding…");
  let text;
  try {
    text = await listText(list);
  } catch (e) {
    setStatus(row, `Couldn't fetch the list (${e.message}).`, true);
    return;
  }
  const combined = appendList(stored.text, text);
  const added = wordCount(combined) - wordCount(stored.text);
  await storeWords(row, [...filesOf(stored), list.file], combined, `Added ${count(added, "new word")}.`);
}

async function takeOut(list, row) {
  const stored = await fetchList(SLOTS.words);
  const files = filesOf(stored).filter((file) => file !== list.file);
  if (stored === null || files.length === 0) return unload(row, SLOTS.words);
  setStatus(row, "Taking out…");
  let text, kept;
  try {
    text = await listText(list);
    kept = await Promise.all(files.filter((file) => BY_FILE.has(file)).map((file) => listText(BY_FILE.get(file))));
  } catch (e) {
    setStatus(row, `Couldn't fetch the lists (${e.message}).`, true);
    return;
  }
  await storeWords(row, files, removeList(stored.text, text, kept), "Taken out.");
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

// an attribution, with its [text](url) links as links
function attributionElement(attribution) {
  const p = element("p", "attribution");
  for (const part of attributionParts(attribution)) {
    if (part.href === undefined) {
      p.append(part.text);
    } else {
      const a = element("a", "", part.text);
      a.href = part.href;
      p.append(a);
    }
  }
  return p;
}

// Between the general lists and the topic and untagged lists after them, an "all" badge, then a
// badge for each topic in use and an "other" badge for untagged lists, each with its number of
// lists: pressing a topic or "other" shows only the lists it's for, and pressing it again or
// pressing "all" shows them all. A row's topic badge works like the topic's badge here.
const listsBox = document.getElementById("lists");
const filterBox = element("div", "filters");
filterBox.setAttribute("role", "group");
filterBox.setAttribute("aria-label", "Show only lists about");
const filters = new Map(); // filter -> button
let filter = null;
const filterOf = (list) => list.tag ?? "other";
// a topic's class for its badge's colours (politics-religion for politics & religion)
const badgeClass = (topic) => `badge ${topic.replace(/\W+/g, "-")}`;
const counts = new Map(); // filter -> number of lists
for (const list of LISTS) {
  if (list.tag !== "general") counts.set(filterOf(list), (counts.get(filterOf(list)) ?? 0) + 1);
}
const allButton = element("button", "badge all", `all (${[...counts.values()].reduce((a, b) => a + b, 0)})`);
allButton.title = "Show all the lists";
allButton.addEventListener("click", () => setFilter(null));
filterBox.append(allButton);
for (const name of [...TOPICS, "other"].filter((name) => counts.has(name))) {
  const button = element("button", badgeClass(name), `${name} (${counts.get(name)})`);
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => setFilter(filter === name ? null : name));
  filters.set(name, button);
  filterBox.append(button);
}
const filtered = []; // [{ list, li }] for the lists the filter applies to
const rowBadges = []; // [{ topic, button }] for the badges on the lists' rows

function setFilter(name) {
  filter = name;
  allButton.setAttribute("aria-pressed", String(name === null));
  for (const [key, button] of filters) {
    button.setAttribute("aria-pressed", String(key === name));
    button.title = key === name ? "Show all the lists" : `Show only the ${key === "other" ? "untagged" : key} lists`;
  }
  for (const { topic, button } of rowBadges) {
    button.setAttribute("aria-pressed", String(topic === name));
    button.title = topic === name ? "Show all the lists" : `Show only the ${topic} lists`;
  }
  filterBox.classList.toggle("active", name !== null);
  for (const { list, li } of filtered) li.hidden = name !== null && filterOf(list) !== name;
  // the last row shown has no border under it
  const shown = filtered.filter(({ li }) => !li.hidden);
  for (const { li } of filtered) li.classList.toggle("last", li === shown.at(-1)?.li);
}

// one <ul> for the general lists and another, after the badges, for the other lists
let group = null;
for (const list of LISTS) {
  const general = list.tag === "general";
  if (group?.general !== general) {
    group = { general, ul: element("ul") };
    if (!general) listsBox.append(filterBox);
    listsBox.append(group.ul);
  }
  const buttons = { load: element("button", "load"), add: element("button", "add", "+"), at: element("button", "at") };
  const downloadButton = element("button", "", "Download");
  downloadButton.title = `Save the list as ${list.file}`;
  const title = element("div", "title");
  title.append(element("span", "name", list.name));
  if (list.tag && !general) {
    const badge = element("button", badgeClass(list.tag), list.tag);
    // filtering hides rows above this one, so keep its badge where it was on the screen
    badge.addEventListener("click", () => {
      const top = badge.getBoundingClientRect().top;
      setFilter(filter === list.tag ? null : list.tag);
      window.scrollBy(0, badge.getBoundingClientRect().top - top);
    });
    rowBadges.push({ topic: list.tag, button: badge });
    title.append(badge);
  }
  title.append(element("span", "size", count(list.size, "word")), buttons.load, buttons.add, buttons.at, downloadButton);
  const status = element("p", "status");
  status.setAttribute("aria-live", "polite");
  const li = element("li");
  li.append(title, element("p", "description", list.description));
  if (list.attribution) li.append(attributionElement(list.attribution));
  li.append(status);
  group.ul.append(li);
  if (!general) filtered.push({ list, li });

  const row = { li, buttons, status };
  rows.set(list.file, row);
  buttons.load.addEventListener("click", () => toggle(list, row, SLOTS.words));
  buttons.add.addEventListener("click", () => toggleAdd(list, row));
  buttons.at.addEventListener("click", () => toggle(list, row, SLOTS.at));
  downloadButton.addEventListener("click", () => download(list, row));
}

setFilter(null);

// a list loaded from this page (or a file with the same name) is marked as loaded
for (const slot of Object.values(SLOTS)) markSlot(slot, []);
refreshLoaded();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshLoaded();
});
