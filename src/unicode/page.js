// The Unicode page: search characters, emoji and named sequences by name, or paste text to see its
// characters. Click a character to copy it, or + to add it to a tray of several to copy at once.

import DATA from "../../unicode/characters.txt";
import { attributionParts } from "../wordlists/lists.js";
import { LANGUAGES, Readings, radicalQuery, readingQuery, romaji, romanize } from "./readings.js";
import { ALIAS_TYPES, CATEGORIES, EMOJI, INVISIBLE, KEYWORDS, SHORT, TONES, Unicode, codepoints, displayName, isInvisible, isSequence, normalize, withTone, withTones } from "./unicode.js";

const STATE_KEY = "unicode-state";
const PAGE = { list: 200, grid: 800 }; // results shown at first, and added by each "Show more", in each view
const VIEWS = { list: "List", grid: "Grid" };

// general categories (UnicodeData.txt), for the details
const GC = {
  Lu: "uppercase letter", Ll: "lowercase letter", Lt: "titlecase letter", Lm: "modifier letter", Lo: "other letter",
  Mn: "nonspacing mark", Mc: "spacing mark", Me: "enclosing mark",
  Nd: "decimal number", Nl: "letter number", No: "other number",
  Pc: "connector punctuation", Pd: "dash punctuation", Ps: "open punctuation", Pe: "close punctuation",
  Pi: "initial quote", Pf: "final quote", Po: "other punctuation",
  Sm: "math symbol", Sc: "currency symbol", Sk: "modifier symbol", So: "other symbol",
  Zs: "space separator", Zl: "line separator", Zp: "paragraph separator",
  Cc: "control", Cf: "format", Cs: "surrogate", Co: "private use", Cn: "unassigned",
};

// the category filter's options: each major category, then its minor ones (named to make sense on
// their own, as a closed dropdown doesn't show its section)
const MAJOR_ALL = { L: "All letters", M: "All marks", N: "All numbers", P: "All punctuation", S: "All symbols", Z: "All separators", C: "All other" };
const MINOR_CATEGORIES = {
  Lu: "Uppercase letters", Ll: "Lowercase letters", Lt: "Titlecase letters", Lm: "Modifier letters", Lo: "Other letters",
  Mn: "Nonspacing marks", Mc: "Spacing marks", Me: "Enclosing marks",
  Nd: "Decimal digits", Nl: "Letter numbers", No: "Other numbers",
  Pc: "Connectors", Pd: "Dashes", Ps: "Opening brackets", Pe: "Closing brackets", Pi: "Opening quotes", Pf: "Closing quotes", Po: "Other punctuation",
  Sm: "Math symbols", Sc: "Currency symbols", Sk: "Modifier symbols", So: "Other symbols",
  Zs: "Spaces", Zl: "Line separator", Zp: "Paragraph separator",
  Cc: "Controls", Cf: "Format characters",
};

const unicode = new Unicode(DATA);
const attribution = /^# attribution: (.*)$/m.exec(DATA)[1];

const input = document.getElementById("query");
const tray = document.getElementById("tray");
const trayRow = document.getElementById("tray-row");
const summary = document.getElementById("summary");
const results = document.getElementById("results");
const tones = document.getElementById("tones");
const FILTERS = {
  category: document.getElementById("category"),
  script: document.getElementById("script"),
  block: document.getElementById("block"),
  type: document.getElementById("type"),
};

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ query: input.value, tray: tray.value, tone, filters: chosen, view }));
  } catch (e) {}
}

// --- Filters

// Each filter: its options (value, label and, for the emoji groups, an optgroup label), the first
// being "any", and the option values an entry has. Type holds filters that don't need a dropdown of
// their own (so they can't be combined with each other), with the emoji groups last, as a dropdown
// can't show where a group ends. Each dropdown lists only the options with matches
// given the search and the other filters (and the one chosen, even if it has none).
const groupNames = [...new Set(unicode.groups.map((g) => g.group))].filter((g) => g !== "Component");
const FILTER_OPTIONS = {
  category: {
    options: [["", "Any category"], ...Object.entries(CATEGORIES).flatMap(([major, name]) => [
      [major, MAJOR_ALL[major], name],
      ...Object.entries(MINOR_CATEGORIES).filter(([gc]) => gc[0] === major).map(([gc, label]) => [gc, label, name]),
    ])],
    values: (e) => [e.gc[0], e.gc],
  },
  script: {
    options: [["", "Any script"], ...Object.entries(unicode.scriptNames).sort((a, b) => a[1].localeCompare(b[1]))],
    values: (e) => [e.script],
  },
  block: {
    options: [["", "Any block"], ...unicode.blocks.map((b) => [b.name, b.name])],
    values: (e) => [e.block],
  },
  type: {
    options: [
      ["", "Any type"],
      ["emoji", "Emoji"],
      ["not-emoji", "Not emoji"],
      ["emoji-sequence", "Emoji sequences"],
      ["invisible", "Invisible characters"],
      ["new", `New in Unicode ${unicode.latest.replace(/\.0$/, "")}`],
      ...groupNames.map((g) => [`group:${g}`, g, "Emoji groups"]),
    ],
    values: (e) => (e.types ??= [
      ...(e.emoji ? ["emoji", `group:${unicode.groups[e.emoji.group].group}`] : ["not-emoji"]),
      ...(e.emoji && isSequence(e) ? ["emoji-sequence"] : []),
      ...(isInvisible(e) ? ["invisible"] : []),
      ...(e.age === unicode.latest ? ["new"] : []),
    ]),
  },
};
const chosen = Object.fromEntries(Object.keys(FILTERS).map((name) => [name, ""]));
const passes = (entry, except) => Object.entries(chosen).every(([name, value]) =>
  name === except || !value || FILTER_OPTIONS[name].values(entry).includes(value));

// rebuild a dropdown with the options in available (all if null)
function fillFilter(name, available) {
  const select = FILTERS[name];
  const nodes = [];
  let group = null;
  for (const [value, label, optgroup] of FILTER_OPTIONS[name].options) {
    if (value && value !== chosen[name] && available && !available.has(value)) continue;
    const node = el("option", { value, textContent: label });
    if (!optgroup) nodes.push(node);
    else {
      if (group?.label !== optgroup) nodes.push((group = el("optgroup", { label: optgroup })));
      group.append(node);
    }
  }
  select.replaceChildren(...nodes);
  select.value = chosen[name];
}

// the options with matches among these results, for each filter
function fillFilters(entries) {
  for (const name of Object.keys(FILTERS)) {
    const available = new Set();
    if (entries) for (const entry of entries) if (passes(entry, name)) for (const v of FILTER_OPTIONS[name].values(entry)) available.add(v);
    fillFilter(name, entries && available);
  }
}

// --- Skin tone

let tone = 0;
const TONE_LABELS = ["No skin tone", "Light skin tone", "Medium-light skin tone", "Medium skin tone", "Medium-dark skin tone", "Dark skin tone"];
const toneButtons = [0, ...TONES].map((t, i) => {
  const button = el("button", { type: "button", textContent: i ? String.fromCodePoint(0x270b, t) : "✋", title: TONE_LABELS[i] });
  button.addEventListener("click", () => {
    tone = t;
    showTones();
    show();
    save();
  });
  return button;
});
tones.append(el("span", { className: "label", textContent: "Skin tone:" }), ...toneButtons);
function showTones() {
  toneButtons.forEach((b, i) => b.setAttribute("aria-pressed", String([0, ...TONES][i] === tone)));
}

// --- Showing characters


// The glyph for a result: the text itself, with a dotted circle before a lone combining mark, or a
// label in a dashed box for a character that shows nothing.
function glyph(entry, cps) {
  const text = String.fromCodePoint(...cps);
  if (cps.length === 1) {
    const { gc, aliases, name } = entry;
    const abbreviation = aliases.find((a) => a.type === "abbreviation")?.alias;
    const vs = /^VARIATION SELECTOR-(\d+)$/.exec(name);
    if (/^C[cfsno]|^Z[lp]/.test(gc) || INVISIBLE.test(text)) {
      const label = abbreviation ?? (vs ? `VS${vs[1]}` : /^TAG /.test(name) ? `TAG ${String.fromCodePoint(cps[0] - 0xe0000)}` : `${cps[0].toString(16).toUpperCase()}`);
      return el("span", { className: "glyph invisible", textContent: label });
    }
    if (gc === "Zs") return el("span", { className: "glyph space", textContent: text });
    if (gc[0] === "M") return el("span", { className: "glyph", textContent: "\u25cc" + text });
  }
  return el("span", { className: "glyph", textContent: text });
}

// what a match on a label other than the name shown means
function explanation(entry, label) {
  if (!label || label.text === displayName(entry)) return "";
  if (label.kind === READING) return label.text;
  if (label.kind === MEANING) return `meaning “${label.text}”`;
  if (label.kind === EMOJI) return `emoji name “${label.text}”`;
  if (label.kind === SHORT) return `short name “${label.text}”`;
  if (label.kind === KEYWORDS) return `keywords: ${label.text}`;
  return `${ALIAS_TYPES[label.type] ?? label.type} “${label.text}”`;
}

// copy text, with the older way as a fallback (for browsers that don't allow the clipboard API here)
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const area = el("textarea", { value: text });
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

// add text to the tray, at the cursor if it's in the tray (showing the tray if it was empty)
function addToTray(text) {
  trayRow.hidden = false;
  const start = document.activeElement === tray ? tray.selectionStart : tray.value.length;
  const end = document.activeElement === tray ? tray.selectionEnd : tray.value.length;
  tray.value = tray.value.slice(0, start) + text + tray.value.slice(end);
  tray.selectionStart = tray.selectionEnd = start + text.length;
  save();
}

// a glyph that copies its text when clicked, showing "Copied" for a moment, or adds it to the tray
// when shift-clicked
function glyphButton(entry, cps, title = "") {
  const how = "click to copy, shift-click to add to the tray";
  const button = el("button", { type: "button", className: "glyph-button", title: title ? `${title} (${how})` : how[0].toUpperCase() + how.slice(1) }, [glyph(entry, cps)]);
  // (so shift-click doesn't select text)
  button.addEventListener("mousedown", (event) => event.shiftKey && event.preventDefault());
  button.addEventListener("click", async (event) => {
    const text = String.fromCodePoint(...cps);
    if (event.shiftKey) {
      addToTray(text);
      return;
    }
    await copyText(text);
    button.classList.add("copied");
    clearTimeout(button.timer);
    button.timer = setTimeout(() => button.classList.remove("copied"), 1000);
  });
  return button;
}

function details(entry) {
  const box = el("div", { className: "details" });
  const line = (label, ...content) => box.append(el("p", {}, [el("span", { className: "label", textContent: `${label}: ` }), ...content]));
  if (entry.cps.length > 1) {
    line("Codepoints", el("span", {}, entry.cps.flatMap((cp, i) => [...(i ? [el("br")] : []), `U+${cp.toString(16).toUpperCase().padStart(4, "0")} ${unicode.info(cp).name || unicode.info(cp).aliases[0]?.alias || ""}`])));
  } else {
    const gc = entry.gc;
    line("Category", `${GC[gc] ?? gc} (${gc})`);
  }
  line("Script", unicode.scriptNames[entry.script] ?? "Unknown");
  line("Block", entry.block);
  line("Added in", entry.unassigned ? "not assigned" : `Unicode ${entry.age}${entry.emoji ? ` (Emoji ${entry.emoji.version})` : ""}`);
  if (entry.omit) line("Note", "left out of name searches, as its name is just its codepoint");
  if (entry.aliases.length) line("Aliases", entry.aliases.map((a) => `${a.alias} (${ALIAS_TYPES[a.type] ?? a.type})`).join(", "));
  if (entry.short) line("Short name", entry.short);
  if (entry.emoji) {
    const { group, subgroup } = unicode.groups[entry.emoji.group];
    line("Emoji", `${entry.emoji.name} (${group} › ${subgroup})`);
    // text and emoji presentation, for single characters that have both
    if (entry.cps.length === 2 && entry.cps[1] === 0xfe0f) {
      const base = entry.cps[0];
      line("Styles", el("span", { className: "choices" }, [
        glyphButton(entry, [base, 0xfe0e], "Text style (with VS15)"), " text ",
        glyphButton(entry, [base, 0xfe0f], "Emoji style (with VS16)"), " emoji ",
        glyphButton(entry, [base], "Without a variation selector"), " plain",
      ]));
    }
    if (entry.emoji.tones) {
      line("Skin tones", el("span", { className: "choices" }, [0, ...TONES].map((t) => glyphButton(entry, withTone(entry, t)))));
    }
    if (entry.emoji.mixed) {
      const grid = el("span", { className: "grid" });
      for (const a of TONES) for (const b of TONES) grid.append(glyphButton(entry, withTones(entry, [a, b])));
      line("Mixed tones", grid);
    }
  }
  if (entry.keywords?.length) line("Keywords", entry.keywords.map((k) => k.text).join(", "));
  if (entry.cps.length === 1 && entry.script === "Hani") {
    // meaning, readings (with romaji and the romanization of Korean) and radical, once the readings
    // are loaded (and not if they can't be)
    const ideograph = () => {
      const info = readings?.get(entry.cps[0]);
      if (!info) return;
      if (info.definition) line("Meaning", info.definition);
      const romanized = { ja: romaji, ko: romanize };
      for (const [code, { name }] of Object.entries(LANGUAGES)) {
        const list = info.readings[code];
        if (list.length) line(name, list.map((r) => (romanized[code] ? `${r} (${romanized[code](r)})` : r)).join(", "));
      }
      const rs = readings.radicalOf(entry.cps[0]);
      if (rs && readings.radicals.has(rs[0])) {
        const [radical, extra] = rs;
        const link = el("button", { type: "button", className: "link", textContent: radicalName(radical), title: `List the characters with this radical (rs:${radical})` });
        link.addEventListener("click", () => searchRadical(radical));
        line("Radical", link, ` + ${strokes(extra)}${info.strokes ? ` (${info.strokes} in all)` : ""}`);
      }
    };
    if (readings) ideograph();
    else loadReadings().then(ideograph, () => {});
  }
  const variants = entry.cps.length === 1 ? unicode.variantsOf(entry.cps[0]) : [];
  if (variants.length) {
    line("Variants", el("span", { className: "choices" }, variants.flatMap((v, i) => [...(i ? [" "] : []), glyphButton(entry, v.cps, v.description), ` ${v.description}`])));
  }
  return box;
}

function row(entry, label) {
  const cps = withTone(entry, tone);
  const name = displayName(entry);
  const meta = [codepoints(cps)];
  const why = explanation(entry, label);
  if (why) meta.push(why);
  const toggle = el("button", { type: "button", className: "name" }, [
    el("span", { className: entry.name ? "" : "lower", textContent: name || "(no name)" }),
    el("span", { className: "meta", textContent: meta.join(" · ") }),
  ]);
  toggle.setAttribute("aria-expanded", "false");
  const plus = el("button", { type: "button", className: "plus", textContent: "+", title: "Add to the tray" });
  plus.setAttribute("aria-label", `Add ${name || codepoints(cps)} to the tray`);
  plus.addEventListener("click", () => addToTray(String.fromCodePoint(...withTone(entry, tone))));
  const item = el("li", {}, [glyphButton(entry, cps), toggle, plus]);
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    if (open) item.append(details(entry));
    else item.querySelector(".details")?.remove();
  });
  return item;
}

// a grid cell: just the glyph, named in its tooltip
function cell(entry) {
  const cps = withTone(entry, tone);
  return el("li", {}, [glyphButton(entry, cps, displayName(entry) || codepoints(cps))]);
}

let found = [];
let shown = 0;
let view = "list";

function more() {
  const list = results.querySelector("ul") ?? results.appendChild(el("ul", { className: view }));
  results.querySelector(".more")?.remove();
  const next = found.slice(shown, shown + PAGE[view]);
  list.append(...next.map(({ entry, label }) => (view === "grid" ? cell(entry) : row(entry, label))));
  shown += next.length;
  // in the grid, fill the last row if there are more (cells vary in width, so add them until one wraps)
  if (view === "grid" && shown < found.length) {
    const top = list.lastElementChild.offsetTop;
    while (shown < found.length) {
      const extra = list.appendChild(cell(found[shown].entry));
      if (extra.offsetTop !== top) {
        extra.remove();
        break;
      }
      shown++;
    }
  }
  if (shown < found.length) {
    const button = el("button", { type: "button", className: "more", textContent: `Show more (${(found.length - shown).toLocaleString("en")} left)` });
    button.addEventListener("click", more);
    results.append(button);
  }
}

// a button for each view, with the current one pressed
function viewButtons() {
  const buttons = Object.entries(VIEWS).map(([name, label]) => {
    const button = el("button", { type: "button", textContent: label });
    button.setAttribute("aria-pressed", String(name === view));
    button.addEventListener("click", () => {
      view = name;
      show();
      save();
    });
    return button;
  });
  return el("span", { className: "view" }, ["View: ", el("span", { className: "buttons" }, buttons)]);
}

function show() {
  const query = input.value;
  const active = Object.values(chosen).some(Boolean);
  results.replaceChildren();
  shown = 0;
  const clear = (text = "") => {
    found = [];
    summary.textContent = text;
    fillFilters(null);
  };
  if (!query.trim() && !active) return clear();
  const rs = radicalQuery(query);
  const reading = rs ? null : readingQuery(query);
  if (reading && !reading.terms.length) return clear(`Type a ${LANGUAGES[reading.lang].name} reading after the colon.`);
  if ((rs || reading) && !readings) {
    clear("Loading readings…");
    loadReadings().then(show, () => {
      if (radicalQuery(input.value) || readingQuery(input.value)) summary.textContent = "Couldn't load the readings. Open this page once while online (in the app, if you've installed it) and they'll be kept for offline use.";
    });
    return;
  }
  let all;
  let about = "";
  if (rs) {
    if (!rs.radical) return showRadicals();
    const id = readings.radical(rs.radical);
    if (!id) return clear(notRadical(rs.radical));
    about = ` with radical ${radicalName(id)}${rs.extra === null ? "" : ` + ${strokes(rs.extra)}`}`;
    all = readings.byRadical(id, rs.extra).map(({ cp, radical, extra }) =>
      ({ entry: unicode.entryFor(cp), label: { kind: READING, text: `radical ${radical} + ${strokes(extra)}` } }));
  } else if (reading) {
    const { name } = LANGUAGES[reading.lang];
    all = readings.search(reading.lang, reading.terms).map(({ cp, reading: r }) =>
      ({ entry: unicode.entryFor(cp), label: { kind: READING, text: `${name} ${r}` } }));
  } else {
    all = unicode.search(query);
    // then ideographs with the search as a definition (once the readings are loaded), unless it's a lookup
    if (readings && unicode.lookup(query) === null) {
      const listed = new Set(all.map((r) => r.entry));
      for (const { cp, meaning } of readings.define(normalize(query))) {
        const entry = unicode.entryFor(cp);
        if (!listed.has(entry)) all.push({ entry, label: { kind: MEANING, text: meaning } });
      }
    }
  }
  fillFilters(all.map((r) => r.entry));
  found = all.filter((r) => passes(r.entry));
  if (!query.trim() && (chosen.type === "emoji" || chosen.type.startsWith("group:"))) found.sort((a, b) => a.entry.emoji.order - b.entry.emoji.order);
  const n = found.length;
  summary.textContent = `${n === 0 ? "No" : n.toLocaleString("en")} result${n === 1 ? "" : "s"}${about}`;
  if (n) summary.append(" ", viewButtons());
  more();
}

// --- Radicals

const strokes = (n) => `${n} stroke${Math.abs(n) === 1 ? "" : "s"}`;

// a radical as its number, character and name, like "85 ⽔ water", or "120' 纟 silk (simplified)"
function radicalName(id) {
  const r = readings.radicals.get(id);
  const base = readings.radicals.get(id.replace(/'+$/, ""));
  const name = unicode.info(base.char).name.replace(/^KANGXI RADICAL /, "").toLowerCase();
  return `${id} ${String.fromCodePoint(r.char ?? r.ideograph)} ${name}${id === base.radical ? "" : " (simplified)"}`;
}

function searchRadical(id) {
  input.value = `rs:${id}`;
  show();
  save();
  input.scrollIntoView({ block: "nearest" });
}

// why a radical search found nothing
function notRadical(name) {
  const cps = [...name].map((c) => c.codePointAt(0));
  const rs = cps.length === 1 && readings.radicalOf(cps[0]);
  if (rs) return `${name} isn't a radical: it's radical ${radicalName(rs[0])} + ${strokes(rs[1])} (rs:${rs[0]}).`;
  return `No radical “${name}”. Type rs: on its own to see them all.`;
}

// the 214 radicals, by strokes, each listing its characters when clicked
function showRadicals() {
  found = [];
  fillFilters(null);
  summary.textContent = "The 214 radicals, by number of strokes. Click one to list its characters.";
  const byStrokes = new Map();
  for (const r of readings.radicals.values()) {
    if (r.radical.includes("'")) continue;
    if (!byStrokes.has(r.strokes)) byStrokes.set(r.strokes, []);
    byStrokes.get(r.strokes).push(r);
  }
  const table = el("div", { className: "radicals" });
  for (const [n, list] of [...byStrokes].sort((a, b) => a[0] - b[0])) {
    const buttons = list.map((r) => {
      const button = el("button", { type: "button", textContent: String.fromCodePoint(r.ideograph), title: radicalName(r.radical) });
      button.addEventListener("click", () => searchRadical(r.radical));
      return button;
    });
    table.append(el("div", { className: "row" }, [el("span", { className: "strokes", textContent: n }), el("span", { className: "buttons" }, buttons)]));
  }
  results.append(table);
}

// --- Readings of CJK ideographs: fetched in the background once the page has loaded, or when first
// needed if that hasn't finished (checking for a newer version each time), and kept in browser
// storage for offline use

const READING = "reading"; // the kinds of label for a reading match and a definition match
const MEANING = "meaning";
const READINGS_URL = "unicode/readings.txt";
let readings = null;
let readingsLoad = null;

// browser storage can hang (as in some private windows), so give up on it after a while
const withTimeout = (promise) => Promise.race([promise, new Promise((_, reject) =>
  setTimeout(() => reject(new Error("browser storage didn't respond")), 2000))]);

function storage(mode, act) {
  return withTimeout(new Promise((resolve, reject) => {
    const open = indexedDB.open("unicode", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("data");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = act(open.result.transaction("data", mode).objectStore("data"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  }));
}

function loadReadings() {
  readingsLoad ??= (async () => {
    let text;
    try {
      const response = await fetch(READINGS_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      text = await response.text();
      // stored again only if it's changed (by the server's version of it)
      const version = response.headers.get("ETag") ?? response.headers.get("Last-Modified") ?? "";
      storage("readonly", (store) => store.get("readings-version")).catch(() => null).then((stored) => {
        if (version && stored === version) return;
        storage("readwrite", (store) => store.put(text, "readings"))
          .then(() => storage("readwrite", (store) => store.put(version, "readings-version"))).catch(() => {});
      });
    } catch (e) {
      text = await storage("readonly", (store) => store.get("readings")).catch(() => null);
      if (!text) throw e;
    }
    readings = new Readings(text);
  })();
  // a failed load can be tried again
  readingsLoad.catch(() => (readingsLoad = null));
  return readingsLoad;
}

// --- Help on the intro's terms: a tooltip, and examples shown after the term on click (or tap)

for (const term of document.querySelectorAll(".intro .term")) {
  const help = document.getElementById(term.getAttribute("aria-controls"));
  term.title = help.textContent.trim().replace(/^\((.*)\)$/, "$1");
  term.addEventListener("click", () => {
    help.hidden = !help.hidden;
    term.setAttribute("aria-expanded", String(!help.hidden));
  });
}

// --- Tray

document.getElementById("copy").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  await copyText(tray.value);
  button.textContent = "Copied";
  setTimeout(() => (button.textContent = "Copy"), 1200);
});
document.getElementById("clear").addEventListener("click", () => {
  tray.value = "";
  trayRow.hidden = true;
  save();
});
tray.addEventListener("input", save);

// --- Start

const state = load();
input.value = state.query ?? "";
tray.value = state.tray ?? "";
trayRow.hidden = !tray.value;
tone = TONES.includes(state.tone) ? state.tone : 0;
view = state.view in VIEWS ? state.view : "list";
for (const [name, select] of Object.entries(FILTERS)) {
  const value = state.filters?.[name] ?? "";
  if (FILTER_OPTIONS[name].options.some(([v]) => v === value)) chosen[name] = value;
  select.addEventListener("change", () => {
    chosen[name] = select.value;
    show();
    save();
  });
}
input.addEventListener("input", () => {
  show();
  save();
});
// fix each dropdown's width at its widest (with every option), so it doesn't change as options come and go
fillFilters(null);
for (const select of Object.values(FILTERS)) select.style.width = `${select.offsetWidth}px`;
showTones();
show();
// fetch the readings when the browser is idle, so they're kept for offline use
// (showing the results again if the search matches any definitions)
const prefetch = () => loadReadings().then(() => {
  if (input.value.trim() && !readingQuery(input.value) && readings.define(normalize(input.value)).length) show();
}, () => {});
if (navigator.onLine) {
  if (window.requestIdleCallback) requestIdleCallback(prefetch, { timeout: 3000 });
  else setTimeout(prefetch, 2000);
}
document.getElementById("attribution").replaceChildren(...attributionParts(attribution).map((part) =>
  part.href ? el("a", { href: part.href, textContent: part.text }) : part.text));
