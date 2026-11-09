// The Rhymes page: look up a word, pick one of its pronunciations, and list its perfect rhymes.

import { attributionParts } from "../wordlists/lists.js";
import { Rhymes, parsePronunciations, rhymeParts, toIpa } from "./rhymes.js";

const WORD_KEY = "rhymes-word";
const OPTIONS_KEY = "rhymes-options";
const GROUPING_KEY = "rhymes-grouping";
// the ways rhymes can be grouped, and their buttons' labels
const GROUPINGS = { frequency: "by frequency", syllables: "by syllables" };
// the sections rhymes are shown in (see Rhymes.arrange), and their headings
const BANDS = { common: "Common", uncommon: "Less common", rare: "Rare", phrases: "Phrases and hyphenated words" };
const SOURCES = { C: "CMUdict", U: "Wiktionary (US)", W: "Wiktionary", E: "Wiktionary (enPR)", B: "Wiktionary (British, converted)" };

const input = document.getElementById("word");
const status = document.getElementById("status");
const prons = document.getElementById("prons");
const summary = document.getElementById("summary");
const results = document.getElementById("results");
const attribution = document.getElementById("attribution");
// option name -> its tickbox
const OPTIONS = {
  sameOnset: document.getElementById("same-onset"),
  looseOnsets: document.getElementById("loose-onsets"),
  cotCaught: document.getElementById("cot-caught"),
};
const currentOptions = () => Object.fromEntries(Object.entries(OPTIONS).map(([name, box]) => [name, box.checked]));

let rhymes = null;
let grouping = GROUPINGS[load(GROUPING_KEY)] ? load(GROUPING_KEY) : "frequency";
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

// A group of pronunciations with the same rhymes: the first, and the others as "also" (with their
// spelling if it's different).
function groupLabel({ entry, others }) {
  const parts = [el("span", { className: "word", textContent: entry.word }), " ", el("span", { className: "ipa", textContent: `/${toIpa(entry.pron)}/` })];
  if (others.length) {
    const also = others.map((e) => (e.word === entry.word ? "" : `${e.word} `) + `/${toIpa(e.pron)}/`).join(", ");
    parts.push(" ", el("span", { className: "also", textContent: `(also ${also})` }));
  }
  return parts;
}

function showPronunciations() {
  const { choices, choice } = shown;
  prons.replaceChildren();
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
  const { ipa } = rhymeParts(entry.pron);
  const perfect = !options.sameOnset && !options.looseOnsets ? "perfect " : "";
  const text = `${count === 0 ? "No" : count.toLocaleString("en")} ${perfect}rhyme${count === 1 ? "" : "s"} on /${ipa}/`;
  if (count === 0) {
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
  // sections of [title, items]: by number of syllables, or by frequency
  const bySyllables = grouping === "syllables";
  const sections = bySyllables
    ? rhymes.bySyllables(matches).map(({ syllables, items }) => [`${syllables} syllable${syllables === 1 ? "" : "s"}`, items])
    : Object.entries(rhymes.arrange(matches)).filter(([, items]) => items.length).map(([band, items]) => [BANDS[band], items]);
  results.classList.toggle("by-syllables", bySyllables);
  for (const [title, items] of sections) {
    const heading = el("h2", {}, [`${title} `, el("span", { className: "count", textContent: `(${items.length.toLocaleString("en")})` })]);
    results.append(el("section", {}, [heading, el("div", { className: "list" }, items.map((item) => el("span", {
      className: `rhyme ${item.band}`,
      textContent: item.word,
      tabIndex: 0,
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
const hashFor = (word) => (word.trim() ? "#" + encodeURIComponent(word.trim()).replace(/%20/g, "+") : location.pathname);

function update({ push = false } = {}) {
  if (!rhymes) return;
  const word = input.value;
  save(WORD_KEY, word);
  if (hashWord() !== word.trim()) history[push ? "pushState" : "replaceState"](null, "", hashFor(word));
  if (word.trim() === shown.word) return;
  shown = { word: word.trim(), choices: rhymes.pronunciationGroups(word, currentOptions()), choice: 0 };
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

try {
  const saved = JSON.parse(load(OPTIONS_KEY) || "{}");
  for (const [name, box] of Object.entries(OPTIONS)) box.checked = saved[name] === true;
} catch (e) {}
for (const box of Object.values(OPTIONS)) {
  box.addEventListener("change", () => {
    save(OPTIONS_KEY, JSON.stringify(currentOptions()));
    if (!rhymes) return;
    // mergers can change which pronunciations have the same rhymes: regroup, keeping the one chosen
    const chosen = shown.choices[shown.choice];
    const entries = chosen ? [chosen.entry, ...chosen.others] : [];
    shown.choices = shown.word ? rhymes.pronunciationGroups(shown.word, currentOptions()) : [];
    shown.choice = Math.max(0, shown.choices.findIndex((g) => entries.includes(g.entry) || g.others.some((e) => entries.includes(e))));
    showPronunciations();
    showRhymes();
  });
}

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
