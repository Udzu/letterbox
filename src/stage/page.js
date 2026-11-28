// The Stage page: browse a playlist with a song from a musical or opera for every year from 1637 to 2024,
// by era (musicals, operas or baroque operas), decade and year, language, composer and search, newest or oldest
// first, and play the songs in place or on YouTube.

import data from "./data.json";
import { counts, decade, ERAS, filterSongs, fromHash, KEYS, sortSongs, surname, toHash } from "./filter.js";
import { createPlayer, el, playLinks, plural, showCards } from "../shared/songs.js";

const $ = (id) => document.getElementById(id);
const { songs, gaps, flags } = data; // gaps: the years without a song (1646), shown as cards with a note

let selection = fromHash(location.hash);

function select(changes) {
  if ("era" in changes && !("decade" in changes)) changes = { ...changes, decade: null }; // decades are chosen within an era
  if ("decade" in changes && !("year" in changes)) changes = { ...changes, year: null }; // a year needs its decade
  selection = { ...selection, ...changes };
  history.replaceState(null, "", toHash(selection) || location.pathname + location.search);
  render();
}

// each era's years, as "1877–2024"
const span = (era) => {
  const years = songs.filter((s) => s.era === era).map((s) => s.year);
  return `${Math.min(...years)}–${Math.max(...years)}`;
};
const SPANS = Object.fromEntries(Object.keys(ERAS).map((era) => [era, span(era)]));

// --- the filters ---
// a row of toggle buttons, one for each value with songs (or selected), with its count
function chips(container, entries, selected, onClick) {
  container.replaceChildren(...entries.filter(([value, , n]) => n || value === selected).map(([value, label, n, title]) =>
    el("button", { type: "button", className: "chip", ariaPressed: String(value === selected), title: title ?? "", onclick: () => onClick(value === selected ? null : value) },
      label, " ", el("span", { className: "count" }, String(n)))));
}

// the order: newest first (the default) or oldest first
const SORTS = { newest: "Newest first", oldest: "Oldest first" };
function renderSorts() {
  const current = selection.sort ?? "newest";
  $("sorts").replaceChildren(...Object.entries(SORTS).map(([sort, label]) => el("button", {
    type: "button", className: "chip", ariaPressed: String(sort === current), onclick: () => select({ sort: sort === "newest" ? null : sort }),
  }, label)));
}

const search = $("search");
search.value = selection.q ?? "";
search.addEventListener("input", () => select({ q: search.value.trim() || null }));
$("clear").addEventListener("click", () => { search.value = ""; select(Object.fromEntries(KEYS.map((k) => [k, null]))); });
window.addEventListener("hashchange", () => { selection = fromHash(location.hash); search.value = selection.q ?? ""; render(); });

// --- the songs ---
const { thumbnail, playRandom } = createPlayer();

// a button that sets a filter and scrolls to the results
const setFilter = (changes) => { select(changes); $("results-header").scrollIntoView({ block: "start" }); };
// a flag that shows the songs in its language (none for English, the most common)
const flagLink = (language) => language !== "English" && el("button", { type: "button", className: "flag", title: `${language}: show these songs`, ariaLabel: `${language}: show these songs`, onclick: () => setFilter({ language }) }, flags[language]);
const filterLink = (text, changes, title) => el("button", { type: "button", className: "link", title, onclick: () => setFilter(changes) }, text);

const cards = new Map(); // song → card, made once and reused so playing videos survive filtering
function card(song) {
  if (cards.has(song)) return cards.get(song);
  if (song.gap) return gapCard(song);
  const composers = song.composers.flatMap((name, i) => [i ? " & " : "", filterLink(name, { composer: name }, `Show songs by ${name}`)]);
  const c = el("article", { className: `song ${song.era}` },
    thumbnail(song),
    el("div", { className: "info" },
      el("div", { className: "title" }, song.video ? el("a", { href: `https://youtu.be/${song.video}`, target: "_blank", rel: "noopener" }, song.song) : song.song,
        song.language !== "English" && " ", flagLink(song.language)),
      el("div", { className: "work" }, "from ", el("i", {}, song.work)),
      el("div", { className: "about" },
        filterLink(String(song.year), { era: song.era, decade: decade(song.year), year: String(song.year) }, `Show the song from ${song.year}`),
        " · ", filterLink(ERAS[song.era], { era: song.era }, `Show the ${ERAS[song.era].toLowerCase()} (${SPANS[song.era]})`),
        " · ", ...composers)));
  c.song = song;
  cards.set(song, c);
  return c;
}

// a year without a song: why not, in place of the video and title
function gapCard(gap) {
  const c = el("article", { className: `song gap ${gap.era}` },
    el("div", { className: "info" },
      el("div", { className: "title" }, String(gap.year)),
      el("div", { className: "note" }, gap.note)));
  cards.set(gap, c);
  return c;
}
const gapEntries = gaps.map((g) => ({ ...g, gap: true, composers: [], song: g.note }));

$("random").addEventListener("click", () => playRandom(filterSongs(songs, selection).map(card)));

// --- rendering ---
function render() {
  const results = sortSongs(filterSongs(songs, selection), selection.sort);
  const shownCards = sortSongs(filterSongs([...songs, ...gapEntries], selection), selection.sort); // with any gaps
  const eras = counts(songs, selection, "era");
  chips($("eras"), Object.entries(ERAS).map(([e, label]) => [e, label, eras.get(e) ?? 0, SPANS[e]]), selection.era, (era) => select({ era }));

  // the decades of the chosen era (oldest first), and the years of the chosen decade
  const decades = selection.era ? counts(songs, selection, "decade") : new Map();
  for (const label of ["decades-label", "decades"]) $(label).hidden = !selection.era;
  chips($("decades"), [...decades].sort((a, b) => a[0].localeCompare(b[0])).map(([d, n]) => [d, d, n]), selection.decade, (d) => select({ decade: d }));
  const years = selection.decade ? counts(songs, selection, "year") : new Map();
  for (const label of ["years-label", "years"]) $(label).hidden = !selection.decade;
  chips($("years"), [...years].sort((a, b) => a[0] - b[0]).map(([y, n]) => [y, y, n]), selection.year, (year) => select({ year }));

  // languages, most songs first
  const languages = counts(songs, selection, "language");
  chips($("languages"), [...languages].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l, n]) => [l, `${flags[l]} ${l}`, n]), selection.language, (language) => select({ language }));

  // composers with more than one song (and the selected one), most first
  const composers = counts(songs, selection, "composer");
  const all = counts(songs, {}, "composer");
  const shown = [...composers].filter(([c]) => (all.get(c) ?? 0) > 1 || c === selection.composer)
    .sort((a, b) => b[1] - a[1] || surname(a[0]).localeCompare(surname(b[0])));
  if (selection.composer && !composers.has(selection.composer)) shown.unshift([selection.composer, 0]);
  chips($("composers"), shown.map(([c, n]) => [c, surname(c), n, c]), selection.composer, (composer) => select({ composer }));
  renderSorts();

  $("summary").replaceChildren(el("b", {}, results.length === songs.length ? `All ${plural(songs.length, "song")}` : plural(results.length, "song")));
  $("clear").hidden = !KEYS.some((k) => selection[k]);
  $("random").disabled = results.length === 0;
  $("play").replaceChildren(...playLinks(results.map((s) => s.video).filter(Boolean)));

  showCards($("songs"), shownCards.map(card));
  $("empty").hidden = shownCards.length > 0;
}

render();
