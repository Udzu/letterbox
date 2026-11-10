// The Unicode page: search characters, emoji and named sequences by name, or paste text to see its
// characters. Click a character to copy it, or + to add it to a tray of several to copy at once.

import DATA from "../../unicode/characters.txt";
import { attributionParts } from "../wordlists/lists.js";
import { ALIAS_TYPES, CATEGORIES, INVISIBLE, TONES, Unicode, codepoints, displayName, isInvisible, isSequence, withTone, withTones } from "./unicode.js";

const STATE_KEY = "unicode-state";
const PAGE = 200; // results shown at first, and added by each "Show more"

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
    localStorage.setItem(STATE_KEY, JSON.stringify({ query: input.value, tray: tray.value, tone, filters: chosen }));
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
      ["sequence", "Sequences"],
      ["invisible", "Invisible characters"],
      ["new", `New in Unicode ${unicode.latest.replace(/\.0$/, "")}`],
      ...groupNames.map((g) => [`group:${g}`, g, "Emoji groups"]),
    ],
    values: (e) => (e.types ??= [
      ...(e.emoji ? ["emoji", `group:${unicode.groups[e.emoji.group].group}`] : ["not-emoji"]),
      ...(isSequence(e) ? ["sequence"] : []),
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
  if (label.kind === 1) return `emoji name “${label.text}”`;
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

// a glyph that copies its text when clicked, showing "Copied" for a moment
function glyphButton(entry, cps, title = "") {
  const button = el("button", { type: "button", className: "glyph-button", title: title ? `${title} (click to copy)` : "Click to copy" }, [glyph(entry, cps)]);
  button.addEventListener("click", async () => {
    await copyText(String.fromCodePoint(...cps));
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
  if (entry.omit) line("Note", "left out of searches, as its name is just its codepoint");
  if (entry.aliases.length) line("Aliases", entry.aliases.map((a) => `${a.alias} (${ALIAS_TYPES[a.type] ?? a.type})`).join(", "));
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

let found = [];
let shown = 0;

function more() {
  const list = results.querySelector("ul") ?? results.appendChild(el("ul"));
  results.querySelector(".more")?.remove();
  const next = found.slice(shown, shown + PAGE);
  list.append(...next.map(({ entry, label }) => row(entry, label)));
  shown += next.length;
  if (shown < found.length) {
    const button = el("button", { type: "button", className: "more", textContent: `Show more (${(found.length - shown).toLocaleString("en")} left)` });
    button.addEventListener("click", more);
    results.append(button);
  }
}

function show() {
  const query = input.value;
  const active = Object.values(chosen).some(Boolean);
  results.replaceChildren();
  shown = 0;
  if (!query.trim() && !active) {
    found = [];
    summary.textContent = "";
    fillFilters(null);
    return;
  }
  const all = unicode.search(query);
  fillFilters(all.map((r) => r.entry));
  found = all.filter((r) => passes(r.entry));
  if (!query.trim() && (chosen.type === "emoji" || chosen.type.startsWith("group:"))) found.sort((a, b) => a.entry.emoji.order - b.entry.emoji.order);
  const n = found.length;
  summary.textContent = `${n === 0 ? "No" : n.toLocaleString("en")} result${n === 1 ? "" : "s"}`;
  more();
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
document.getElementById("attribution").replaceChildren(...attributionParts(attribution).map((part) =>
  part.href ? el("a", { href: part.href, textContent: part.text }) : part.text));
