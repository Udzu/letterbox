// The Rhymes page: look up a word, pick one of its pronunciations, and list its perfect rhymes.

import { attributionParts } from "../wordlists/lists.js";
import { Rhymes, parsePronunciations, rhymeParts, toIpa } from "./rhymes.js";

const WORD_KEY = "rhymes-word";
const SOURCES = { C: "CMUdict", U: "Wiktionary (US)", W: "Wiktionary", E: "Wiktionary (enPR)", B: "Wiktionary (British, converted)" };

const input = document.getElementById("word");
const status = document.getElementById("status");
const prons = document.getElementById("prons");
const summary = document.getElementById("summary");
const results = document.getElementById("results");
const attribution = document.getElementById("attribution");

let rhymes = null;
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

const sourcesTitle = (entry) => `From ${[...entry.sources].map((s) => SOURCES[s]).join(", ")}`;

function showPronunciations() {
  const { choices, choice } = shown;
  prons.replaceChildren();
  if (choices.length === 1) {
    const [entry] = choices;
    prons.append(el("p", { className: "single", title: sourcesTitle(entry) }, [
      el("span", { className: "word", textContent: entry.word }), " ",
      el("span", { className: "ipa", textContent: `/${toIpa(entry.pron)}/` }),
    ]));
  } else if (choices.length > 1) {
    prons.append(el("p", { className: "hint", textContent: "Pronunciation:" }));
    choices.forEach((entry, i) => {
      const radio = el("input", { type: "radio", name: "pron", value: String(i), checked: i === choice });
      radio.addEventListener("change", () => {
        shown.choice = i;
        showRhymes();
      });
      prons.append(el("label", { title: sourcesTitle(entry) }, [
        radio, " ",
        el("span", { className: "word", textContent: entry.word }), " ",
        el("span", { className: "ipa", textContent: `/${toIpa(entry.pron)}/` }),
      ]));
    });
  }
}

function showRhymes() {
  results.replaceChildren();
  const entry = shown.choices[shown.choice];
  if (!entry) return;
  const words = rhymes.perfect(entry);
  const { ipa } = rhymeParts(entry.pron);
  summary.textContent = `${words.length === 0 ? "No" : words.length.toLocaleString("en")} perfect rhyme${words.length === 1 ? "" : "s"} on /${ipa}/`;
  if (words.length === 0) return;
  results.append(el("div", { className: "list" }, words.map((word) => el("span", { className: "rhyme", textContent: word, tabIndex: 0 }))));
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
const hashFor = (word) => (word.trim() ? "#" + encodeURIComponent(word.trim()).replace(/%20/g, "+") : location.pathname);

function update({ push = false } = {}) {
  if (!rhymes) return;
  const word = input.value;
  save(WORD_KEY, word);
  if (hashWord() !== word.trim()) history[push ? "pushState" : "replaceState"](null, "", hashFor(word));
  if (word.trim() === shown.word) return;
  shown = { word: word.trim(), choices: rhymes.pronunciations(word), choice: 0 };
  summary.textContent = "";
  if (!shown.word) {
    prons.replaceChildren();
    results.replaceChildren();
    return;
  }
  showPronunciations();
  if (shown.choices.length === 0) {
    results.replaceChildren();
    summary.textContent = `No pronunciation found for “${shown.word}”.`;
    return;
  }
  showRhymes();
}

// clicking (or pressing Enter on) a rhyme looks it up
function lookUp(target) {
  if (!target.classList?.contains("rhyme")) return;
  input.value = target.textContent;
  update({ push: true });
  input.focus();
  window.scrollTo({ top: 0 });
}
results.addEventListener("click", (e) => lookUp(e.target));
results.addEventListener("keydown", (e) => {
  if (e.key === "Enter") lookUp(e.target);
});

let timer = null;
input.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(update, 150);
});

window.addEventListener("popstate", () => {
  input.value = hashWord();
  update();
});

input.value = location.hash ? hashWord() : load(WORD_KEY);

async function start() {
  status.textContent = "Loading pronunciations…";
  try {
    const response = await fetch("rhymes/pronunciations.txt");
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = parsePronunciations(await response.text());
    rhymes = new Rhymes(data.entries);
    attribution.replaceChildren(...attributionParts(data.attribution).map((part) =>
      part.href ? el("a", { href: part.href, textContent: part.text }) : part.text));
    status.textContent = "";
    update();
  } catch (e) {
    status.textContent = `Couldn't load the pronunciations (${e.message}).`;
    status.classList.add("error");
  }
}
start();
