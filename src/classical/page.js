// The Classical page: browse a playlist of pop songs based on classical pieces, each shown with the
// piece it's based on, by section (adaptations or samples), era, composer and search, sorted by pop song
// or by when the piece was composed, and play them in place or on YouTube.

import data from "./data.json";
import { counts, ERAS, eraYears, filterPairs, fromHash, KEYS, PLAYS, playVideos, SECTIONS, sortPairs, surname, toHash, yearText } from "./filter.js";
import { createPlayer, el, playLinks, plural, showCards } from "../shared/songs.js";

const $ = (id) => document.getElementById(id);
const { pairs } = data;

let selection = fromHash(location.hash);

function select(changes) {
  selection = { ...selection, ...changes };
  history.replaceState(null, "", toHash(selection) || location.pathname + location.search);
  render();
}

// --- the filters ---
// a row of toggle buttons, one for each value with pairs (or selected), with its count
function chips(container, entries, selected, onClick) {
  container.replaceChildren(...entries.filter(([value, , n]) => n || value === selected).map(([value, label, n, title]) =>
    el("button", { type: "button", className: "chip", ariaPressed: String(value === selected), title: title ?? "", onclick: () => onClick(value === selected ? null : value) },
      label, " ", el("span", { className: "count" }, String(n)))));
}

// the sort order: by pop song (the default) or by when the piece was composed
const SORTS = { song: "Pop song", year: "Year of piece" };
function renderSorts() {
  const current = selection.sort ?? "song";
  $("sorts").replaceChildren(...Object.entries(SORTS).map(([sort, label]) => el("button", {
    type: "button", className: "chip", ariaPressed: String(sort === current), onclick: () => select({ sort: sort === "song" ? null : sort }),
  }, label)));
}

// what the play links and random button play: pairs (the default), or just the pop songs or the pieces
function renderPlays() {
  const current = selection.play ?? "pairs";
  $("plays").replaceChildren("Play: ", ...Object.entries({ pairs: "Pairs", ...PLAYS }).map(([play, label]) => el("button", {
    type: "button", className: "chip", ariaPressed: String(play === current), onclick: () => select({ play: play === "pairs" ? null : play }),
  }, label)));
}

const search = $("search");
search.value = selection.q ?? "";
search.addEventListener("input", () => select({ q: search.value.trim() || null }));
$("clear").addEventListener("click", () => { search.value = ""; select(Object.fromEntries(KEYS.map((k) => [k, null]))); });
window.addEventListener("hashchange", () => { selection = fromHash(location.hash); search.value = selection.q ?? ""; render(); });

// --- the pairs ---
const { thumbnail, playRandom } = createPlayer();

// a button that sets a filter and scrolls to the results
const setFilter = (changes) => { select(changes); $("results-header").scrollIntoView({ block: "start" }); };
const filterLink = (text, changes, title) => el("button", { type: "button", className: "link", title, onclick: () => setFilter(changes) }, text);

// a pop song or piece: its video, title and, under that, the given byline (a pop song's performer, or a
// piece's composers)
function half(track, kind, ...byline) {
  const h = el("div", { className: `song ${kind}` },
    thumbnail(track),
    el("div", { className: "info" },
      el("div", { className: "title" }, track.video ? el("a", { href: `https://youtu.be/${track.video}`, target: "_blank", rel: "noopener" }, track.song) : track.song),
      el("div", { className: "artist" }, ...byline)));
  h.song = track;
  return h;
}

const cards = new Map(); // pair → card, made once and reused so playing videos survive filtering
function card(pair) {
  if (cards.has(pair)) return cards.get(pair);
  // the piece is credited to its composers (its performers are only in the video's title)
  const composers = pair.composers.flatMap((name, i) => [i ? " & " : "", filterLink(name, { composer: name }, `Show pieces by ${name}`)]);
  const c = el("article", { className: `pair ${pair.section}` },
    el("div", { className: "tracks" }, half(pair.pop, "pop", "by ", pair.pop.artist),
      half(pair.piece, "piece", "by ", ...composers, ` (${yearText(pair)})`)),
    el("div", { className: "about" },
      filterLink(pair.section === "sample" ? "Samples" : "Adaptation", { section: pair.section }, `Show these ${SECTIONS[pair.section].toLowerCase()}`),
      " · ", filterLink(pair.era, { era: pair.era }, `Show pieces from the ${pair.era} era (${eraYears(pair.era)})`)));
  c.pair = pair;
  cards.set(pair, c);
  return c;
}

// a random pop song (or piece, when just playing pieces)
$("random").addEventListener("click", () =>
  playRandom(filterPairs(pairs, selection).map((p) => card(p).querySelector(selection.play === "piece" ? ".piece" : ".pop"))));

// --- rendering ---
function render() {
  const results = sortPairs(filterPairs(pairs, selection), selection.sort);
  const sections = counts(pairs, selection, "section");
  chips($("sections"), Object.entries(SECTIONS).map(([s, label]) => [s, label, sections.get(s) ?? 0]), selection.section, (section) => select({ section }));
  const eras = counts(pairs, selection, "era");
  chips($("eras"), Object.keys(ERAS).map((e) => [e, e, eras.get(e) ?? 0, eraYears(e)]), selection.era, (era) => select({ era }));
  renderSorts();

  // composers with more than one pair (and the selected one), most first
  const composers = counts(pairs, selection, "composer");
  const all = counts(pairs, { ...selection, section: null, era: null, q: null }, "composer");
  const shown = [...composers].filter(([c]) => (all.get(c) ?? 0) > 1 || c === selection.composer)
    .sort((a, b) => b[1] - a[1] || surname(a[0]).localeCompare(surname(b[0])));
  if (selection.composer && !composers.has(selection.composer)) shown.unshift([selection.composer, 0]);
  chips($("composers"), shown.map(([c, n]) => [c, surname(c), n, c]), selection.composer, (composer) => select({ composer }));

  $("summary").replaceChildren(el("b", {}, results.length === pairs.length ? `All ${plural(pairs.length, "pair")}` : plural(results.length, "pair")));
  $("clear").hidden = !KEYS.some((k) => selection[k]);
  $("random").disabled = results.length === 0;
  $("random").textContent = selection.play === "piece" ? "Random piece" : "Random song";
  renderPlays();
  $("play").replaceChildren(...playLinks(playVideos(results, selection.play)));

  showCards($("pairs"), results.map(card));
  $("empty").hidden = results.length > 0;
}

render();
