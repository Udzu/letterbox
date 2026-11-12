// The Rhymes page: look up a word, pick one of its pronunciations, and list its rhymes.

import { attributionParts } from "../wordlists/lists.js";
import { Rhymes, compareWords, lookupKey, parsePronunciations, parseSounds, rhymeParts, toIpa } from "./rhymes.js";

const WORD_KEY = "rhymes-word";
const OPTIONS_KEY = "rhymes-options";
const GROUPING_KEY = "rhymes-grouping";
const TYPE_KEY = "rhymes-type";
// the ways rhymes can be grouped, and their buttons' labels
const GROUPINGS = { frequency: "by frequency", syllables: "by syllables", letters: "by letters" };
// the sections rhymes are shown in (see Rhymes.arrange), and their headings
const BANDS = { common: "Common", uncommon: "Less common", rare: "Rare", phrases: "Phrases and hyphenated words" };
// the heading for mosaic rhymes (see Rhymes.mosaic), shown after the others however they're grouped
const MOSAIC = "Mosaic rhymes";
const SOURCES = { C: "CMUdict", U: "Wiktionary (US)", W: "Wiktionary", E: "Wiktionary (enPR)", B: "Wiktionary (British, converted)", P: "its words' pronunciations" };

const input = document.getElementById("word");
const status = document.getElementById("status");
const prons = document.getElementById("prons");
const summary = document.getElementById("summary");
const results = document.getElementById("results");
const attribution = document.getElementById("attribution");
const soundHelp = document.getElementById("sound-help");
// option name -> its tickbox
const OPTIONS = {
  sameOnset: document.getElementById("same-onset"),
  looseOnsets: document.getElementById("loose-onsets"),
  cotCaught: document.getElementById("cot-caught"),
  maryMarryMerry: document.getElementById("mary-marry-merry"),
  hurryFurry: document.getElementById("hurry-furry"),
  cureForce: document.getElementById("cure-force"),
  flapping: document.getElementById("flapping"),
  pinPen: document.getElementById("pin-pen"),
  nonRhotic: document.getElementById("non-rhotic"),
};
// type of search -> its button (see TYPES in rhymes.js)
const TYPE_BUTTONS = Object.fromEntries([...document.querySelectorAll("#types button")].map((b) => [b.dataset.type, b]));
const checked = () => Object.fromEntries(Object.entries(OPTIONS).map(([name, box]) => [name, box.checked]));
const currentOptions = () => ({ ...checked(), type });

let rhymes = null;
let grouping = GROUPINGS[load(GROUPING_KEY)] ? load(GROUPING_KEY) : "frequency";
let type = TYPE_BUTTONS[load(TYPE_KEY)] ? load(TYPE_KEY) : "perfect";
let shown = { word: null, choices: [], choice: 0 };

function load(name) {
  try {
    return localStorage.getItem(name) || "";
  } catch (e) {
    return "";
  }
}

function save(name, value) {
  try {
    localStorage.setItem(name, value);
  } catch (e) {}
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const sourcesTitle = (entries) => entries.map((e) => `/${toIpa(e.pron)}/ from ${[...e.sources].map((s) => SOURCES[s]).join(", ")}`).join("\n");

// A group of pronunciations with the same rhymes: its spellings (those that differ in more than case,
// such as café for cafe), each with a Wiktionary link, then its first pronunciation, and the others
// as "also". Pronunciations that only differ in secondary stress (/kæˈfeɪ/, /ˌkæˈfeɪ/) are shown once.
function groupLabel({ entry, others }) {
  const entries = [entry, ...others];
  // the first of each kind
  const firsts = (key, value) => [...entries.reduce((m, e) => (m.has(key(e)) ? m : m.set(key(e), value(e))), new Map()).values()];
  const spellings = firsts((e) => lookupKey(e.word), (e) => e.word);
  const ipas = firsts((e) => e.pron.replaceAll("2", ""), (e) => `/${toIpa(e.pron)}/`);
  const parts = spellings.flatMap((word, i) => [...(i ? [", "] : []), el("span", { className: "word", textContent: word }), ...(entry.built ? [] : wiktionaryLink(word))]);
  parts.push(" ", el("span", { className: "ipa", textContent: ipas[0] }));
  if (entry.built) parts.push(" ", el("span", { className: "also", textContent: "(from its words)" }));
  if (ipas.length > 1) parts.push(" ", el("span", { className: "also", textContent: `(also ${ipas.slice(1).join(", ")})` }));
  return parts;
}

// A link to a word's Wiktionary entry (at its English section), if it comes from Wiktionary: words
// only in CMUdict, mostly names, usually have no entry.
const FROM_WIKTIONARY = /[UWEBP]/; // built phrases (P) are Wiktionary entries too

function wiktionaryLink(word) {
  if (!rhymes.pronunciations(word).some((e) => e.word === word && FROM_WIKTIONARY.test(e.sources))) return [];
  const href = `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replaceAll(" ", "_"))}#English`;
  return [" ", el("a", { className: "wiktionary", href, target: "_blank", rel: "noopener", textContent: "↗", title: `${word} on Wiktionary` })];
}

// a pronunciation typed between slashes: as understood, and the words pronounced that way, like
// /ˈɡɹin/ (like green, Greene)
function showSounds() {
  const { entry } = shown.choices[0];
  const items = rhymes.items(rhymes.homophones(entry.pron)).sort((a, b) => b.zipf - a.zipf || compareWords(a.word, b.word));
  const notes = [];
  if (items.length) {
    notes.push("like ", ...items.flatMap((item, i) => [...(i ? [", "] : []), el("a", {
      className: "rhyme", href: hashFor(item.word), textContent: item.word, title: item.variants.length ? `Also ${item.variants.join(", ")}` : "",
    })]));
  }
  if (shown.assumed) notes.push(...(notes.length ? ["; "] : []), "stress taken to be on the first vowel");
  const parts = [el("span", { className: "ipa", textContent: `/${toIpa(entry.pron)}/` })];
  if (notes.length) parts.push(" ", el("span", { className: "also homophones" }, ["(", ...notes, ")"]));
  prons.append(el("p", { className: "single" }, parts));
}

function showPronunciations() {
  const { choices, choice } = shown;
  prons.replaceChildren();
  if (shown.sounds) return showSounds();
  if (choices.length === 1) {
    const [group] = choices;
    prons.append(el("p", { className: "single", title: sourcesTitle([group.entry, ...group.others]) }, groupLabel(group)));
  } else if (choices.length > 1) {
    prons.append(el("p", { className: "hint", textContent: "Pronunciation:" }));
    choices.forEach((group, i) => {
      const radio = el("input", { type: "radio", name: "pron", value: String(i), checked: i === choice });
      radio.addEventListener("change", () => {
        shown.choice = i;
        showRhymes();
      });
      prons.append(el("label", { title: sourcesTitle([group.entry, ...group.others]) }, [radio, " ", ...groupLabel(group)]));
    });
  }
}

function showRhymes() {
  results.replaceChildren();
  const entry = shown.choices[shown.choice]?.entry;
  if (!entry) return;
  const options = currentOptions();
  const matches = rhymes.matches(entry, options);
  const count = rhymes.items(matches).length;
  // mosaic rhymes, most frequent first, leaving out phrases that are rhymes already (go it)
  const already = new Set([...matches.keys()].map((w) => lookupKey(w).replaceAll("-", " ")));
  const mosaic = rhymes.items(rhymes.mosaic(entry, options)).filter((item) => !already.has(lookupKey(item.word)))
    .map((item) => ({ ...item, band: "mosaic" })).sort((a, b) => b.zipf - a.zipf || compareWords(a.word, b.word));
  const { ipa } = rhymeParts(entry.pron);
  const kind = type !== "perfect" ? `${type} ` : !options.sameOnset && !options.looseOnsets ? "perfect " : "";
  const text = `${count === 0 ? "No" : count.toLocaleString("en")} ${kind}rhyme${count === 1 ? "" : "s"} on /${ipa}/`;
  if (count === 0 && mosaic.length === 0) {
    summary.textContent = text;
    return;
  }
  // a button for each way of grouping the rhymes, with the current one pressed
  const buttons = Object.entries(GROUPINGS).map(([name, label]) => {
    const button = el("button", { type: "button", textContent: label });
    button.setAttribute("aria-pressed", String(name === grouping));
    button.addEventListener("click", () => {
      grouping = name;
      save(GROUPING_KEY, name);
      showRhymes();
    });
    return button;
  });
  summary.replaceChildren(text, " ", el("span", { className: "grouping" }, ["Group: ", el("span", { className: "buttons" }, buttons)]));
  // sections of [title, items]: by frequency, or by number of syllables or letters
  const byCount = (groups, unit) => groups.map(({ count, items }) => [`${count} ${unit}${count === 1 ? "" : "s"}`, items]);
  const sections = grouping === "syllables" ? byCount(rhymes.bySyllables(matches), "syllable")
    : grouping === "letters" ? byCount(rhymes.byLetters(matches), "letter")
    : Object.entries(rhymes.arrange(matches)).filter(([, items]) => items.length).map(([band, items]) => [BANDS[band], items]);
  if (mosaic.length) sections.push([MOSAIC, mosaic]);
  results.classList.toggle("by-count", grouping !== "frequency");
  for (const [title, items] of sections) {
    const heading = el("h2", {}, [`${title} `, el("span", { className: "count", textContent: `(${items.length.toLocaleString("en")})` })]);
    // each rhyme links to its own lookup, so it can also be opened in a new tab
    results.append(el("section", {}, [heading, el("div", { className: "list" }, items.map((item) => el("a", {
      className: `rhyme ${item.band}`,
      href: hashFor(item.word),
      textContent: item.word,
      title: item.variants.length ? `Also ${item.variants.join(", ")}` : "",
    })))]));
  }
}

// the word is kept in the address (rhymes.html#word), so it can be linked to
function hashWord() {
  const hash = location.hash.slice(1).replace(/\+/g, " ");
  try {
    return decodeURIComponent(hash);
  } catch (e) {
    return hash;
  }
}
const hashFor = (word) => (word.trim() ? "#" + encodeURIComponent(word.trim()).replace(/%20/g, "+").replace(/%2F/g, "/") : location.pathname);

function update({ push = false } = {}) {
  if (!rhymes) return;
  const word = input.value;
  save(WORD_KEY, word);
  if (hashWord() !== word.trim()) history[push ? "pushState" : "replaceState"](null, "", hashFor(word));
  soundHelp.hidden = !word.trim().startsWith("/");
  if (word.trim() === shown.word) return;
  shown = { word: word.trim(), choices: [], choice: 0 };
  summary.textContent = "";
  if (!shown.word) {
    prons.replaceChildren();
    results.replaceChildren();
    return;
  }
  // a pronunciation between slashes (the closing one is optional)
  if (shown.word.startsWith("/")) {
    shown.sounds = true;
    try {
      const { pron, assumed } = parseSounds(shown.word.replace(/^\/|\/$/g, ""));
      shown.choices = [{ entry: { word: shown.word, pron, sources: "", zipf: 0 }, others: [] }];
      shown.assumed = assumed;
    } catch (e) {
      prons.replaceChildren();
      results.replaceChildren();
      summary.textContent = shown.word === "/" ? "" : `${e.message} in ${shown.word}.`;
      return;
    }
    showPronunciations();
    showRhymes();
    return;
  }
  shown.choices = rhymes.pronunciationGroups(word, currentOptions());
  // a phrase with no pronunciation of its own gets one built from its words
  if (shown.choices.length === 0) {
    const built = rhymes.phrasePronunciation(word);
    if (built) shown.choices = [{ entry: built, others: [] }];
  }
  showPronunciations();
  if (shown.choices.length === 0) {
    results.replaceChildren();
    summary.textContent = `No pronunciation found for “${shown.word}”.`;
    return;
  }
  showRhymes();
}

// clicking a rhyme or homophone (or pressing Enter on it) looks it up here, unless it's opened in a new
// tab or window
const lookUpClicked = (e) => {
  const target = e.target.closest?.("a.rhyme");
  if (!target || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  input.value = target.textContent;
  update({ push: true });
  input.focus();
  window.scrollTo({ top: 0 });
};
results.addEventListener("click", lookUpClicked);
prons.addEventListener("click", lookUpClicked);

let timer = null;
input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(update, 150);
});

try {
  const saved = JSON.parse(load(OPTIONS_KEY) || "{}");
  for (const [name, box] of Object.entries(OPTIONS)) box.checked = saved[name] === true;
} catch (e) {}
for (const box of Object.values(OPTIONS)) {
  box.addEventListener("change", () => {
    save(OPTIONS_KEY, JSON.stringify(checked()));
    if (!rhymes) return;
    if (shown.sounds) return showRhymes();
    // mergers can change which pronunciations have the same rhymes: regroup, keeping the one chosen
    const chosen = shown.choices[shown.choice];
    const entries = chosen ? [chosen.entry, ...chosen.others] : [];
    shown.choices = shown.word ? rhymes.pronunciationGroups(shown.word, currentOptions()) : [];
    const built = shown.choices.length === 0 && shown.word ? rhymes.phrasePronunciation(shown.word) : null;
    if (built) shown.choices = [{ entry: built, others: [] }];
    shown.choice = Math.max(0, shown.choices.findIndex((g) => entries.includes(g.entry) || g.others.some((e) => entries.includes(e))));
    showPronunciations();
    showRhymes();
  });
}

// the type of search, with the current one's button pressed
const showType = () => Object.entries(TYPE_BUTTONS).forEach(([name, b]) => b.setAttribute("aria-pressed", String(name === type)));
showType();
for (const [name, button] of Object.entries(TYPE_BUTTONS)) {
  button.addEventListener("click", () => {
    type = name;
    save(TYPE_KEY, name);
    showType();
    if (rhymes) showRhymes();
  });
}

window.addEventListener("popstate", () => {
  input.value = hashWord();
  update();
});

input.value = location.hash ? hashWord() : load(WORD_KEY);

// --- Where the pronunciations come from: the online file, which is also kept in browser storage so
// the page still works offline after a visit, or a file the user has loaded, which replaces it until
// they go back to the online data.

const DB = { name: "rhymes", store: "data" };
const ONLINE = "rhymes/pronunciations.txt";

// browser storage can hang (as in some private windows), so give up on it after a while
const STORAGE_TIMEOUT = 2000;
const withTimeout = (promise) => Promise.race([promise, new Promise((_, reject) =>
  setTimeout(() => reject(new Error("browser storage didn't respond")), STORAGE_TIMEOUT))]);

function openDb() {
  return withTimeout(new Promise((resolve, reject) => {
    const request = indexedDB.open(DB.name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB.store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

// the stored value for a key ("online" or "loaded"), or null (including when storage doesn't work)
async function getStored(key) {
  try {
    const db = await openDb();
    return await withTimeout(new Promise((resolve, reject) => {
      const request = db.transaction(DB.store).objectStore(DB.store).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    }));
  } catch {
    return null;
  }
}

// store a value (or delete it, for null), returning whether that worked
async function setStored(key, value) {
  try {
    const db = await openDb();
    await withTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(DB.store, "readwrite");
      if (value === null) tx.objectStore(DB.store).delete(key);
      else tx.objectStore(DB.store).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    }));
    return true;
  } catch {
    return false;
  }
}

const dataStatus = document.getElementById("data-status");
const fileInput = document.getElementById("data-file");
// the data in use: { text, name (for a loaded file), note (about where it's from) }
let current = null;

// use some pronunciation data, or throw an error if it doesn't parse
function useData(data) {
  const parsed = parsePronunciations(data.text);
  rhymes = new Rhymes(parsed.entries);
  current = data;
  attribution.replaceChildren(...attributionParts(parsed.attribution).map((part) =>
    part.href ? el("a", { href: part.href, textContent: part.text }) : part.text));
  status.textContent = "";
  status.classList.remove("error");
  shown = { word: null, choices: [], choice: 0 };
  update();
  showDataStatus(parsed.entries.length);
}

function action(text, onClick) {
  const link = el("a", { href: "#", textContent: text });
  link.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return link;
}

function showDataStatus(count) {
  const n = count.toLocaleString("en");
  const download = el("a", { textContent: "Download", download: current.name ?? "pronunciations.txt",
    href: URL.createObjectURL(new Blob([current.text], { type: "text/plain" })) });
  const parts = current.name
    ? [`Using ${n} pronunciations from `, el("i", { textContent: current.name }), ". ", download, " · ",
       action("Load another file…", () => fileInput.click()), " · ", action("Use the online pronunciations", useOnline)]
    : [`Using ${n} pronunciations${current.note ? ` ${current.note}` : ""}. `, download, " · ",
       action("Load a file…", () => fileInput.click())];
  dataStatus.replaceChildren(...parts);
}

function showError(message) {
  status.textContent = message;
  status.classList.add("error");
}

// the online pronunciations: fetched (and stored for next time), or else the stored copy
async function useOnline() {
  await setStored("loaded", null);
  status.textContent = "Loading pronunciations…";
  try {
    // checked with the server every time (a quick request if it hasn't changed), so a new version of the data
    // isn't missed because the browser's cache thinks its copy is still fresh
    const response = await fetch(ONLINE, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    useData({ text });
    setStored("online", { text, date: Date.now() });
  } catch (e) {
    const stored = await getStored("online");
    if (stored) {
      const date = new Date(stored.date).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      useData({ text: stored.text, note: `saved on ${date} (couldn't fetch the latest)` });
    } else {
      dataStatus.replaceChildren(action("Load a file…", () => fileInput.click()));
      showError(`Couldn't load the pronunciations (${e.message}). Open this page once while online (in the app, if you've installed it) and they'll be kept for offline use. Or download them from the online page (at the bottom) and load the file here.`);
    }
  }
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  fileInput.value = "";
  if (!file) return;
  const data = { text: await file.text(), name: file.name };
  try {
    useData(data);
  } catch (e) {
    showError(`Couldn't use ${file.name}: ${e.message}.`);
    return;
  }
  if (!(await setStored("loaded", data))) status.textContent = "The file couldn't be saved in this browser, so you'll need to load it again next time.";
});

async function start() {
  const loaded = await getStored("loaded");
  if (loaded) {
    try {
      useData(loaded);
      return;
    } catch {
      await setStored("loaded", null);
    }
  }
  await useOnline();
}
start();
