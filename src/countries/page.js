// The Countries page: browse a playlist of songs named after countries by map, continent and search,
// and play the songs in place or as a YouTube playlist.

import data from "./data.json";
import { CONTINENTS, counts, filterSongs, fromHash, KEYS, toHash } from "./filter.js";
import { createMap } from "../shared/map.js";
import { createPlayer, el, playLinks, plural, showCards } from "../shared/songs.js";

const $ = (id) => document.getElementById(id);

const songs = data.lists.nations;
let selection = fromHash(location.hash);

function select(changes) {
  selection = { ...selection, ...changes };
  history.replaceState(null, "", toHash(selection) || location.pathname + location.search);
  render();
}

// --- the map: hovering over a country shows its song (whether or not it's filtered out) ---
const songOf = new Map(songs.map((s) => [s.country, s]));
const updateMap = createMap($("map"), data, {
  onSelect: (country) => select({ country: selection.country === country ? null : country }),
  zoomIn: $("zoom-in"),
  zoomOut: $("zoom-out"),
  zoomReset: $("zoom-reset"),
  label: (name) => (songOf.has(name) ? `${name}: ${songOf.get(name).song} · ${songOf.get(name).artist}` : name),
});

// --- the filters ---
// a row of toggle buttons, one for each value with songs (or selected), with its count
function chips(container, entries, selected, onClick) {
  container.replaceChildren(...entries.filter(([value, , n]) => n || value === selected).map(([value, label, n]) =>
    el("button", { type: "button", className: "chip", ariaPressed: String(value === selected), onclick: () => onClick(value === selected ? null : value) },
      label, " ", el("span", { className: "count" }, String(n)))));
}

const search = $("search");
search.value = selection.q ?? "";
search.addEventListener("input", () => select({ q: search.value.trim() || null }));
$("clear").addEventListener("click", () => { search.value = ""; select(Object.fromEntries(KEYS.map((k) => [k, null]))); });
window.addEventListener("hashchange", () => { selection = fromHash(location.hash); search.value = selection.q ?? ""; render(); });

// --- the songs ---
const { thumbnail, playRandom } = createPlayer();

// a link-styled button that sets a filter and scrolls to the results
const filterLink = (text, changes, title) => el("button", { type: "button", className: "link", title,
  onclick: () => { select(changes); $("results-header").scrollIntoView({ block: "start" }); } }, text);

const cards = new Map(); // song → card, made once and reused so playing videos survive filtering
function card(song) {
  if (cards.has(song)) return cards.get(song);
  const c = el("article", { className: "song" },
    thumbnail(song),
    el("div", { className: "info" },
      el("div", { className: "title" }, el("a", { href: `https://youtu.be/${song.video}`, target: "_blank", rel: "noopener" }, song.song)),
      el("div", { className: "artist" }, song.artist),
      el("div", { className: "where" }, `${song.flag} `, filterLink(song.country, { country: song.country }, "Show this country's song"),
        " · ", filterLink(CONTINENTS[song.continent], { continent: song.continent }, "Show this continent's songs"))));
  c.song = song;
  cards.set(song, c);
  return c;
}

$("random").addEventListener("click", () => playRandom(filterSongs(songs, selection).map(card)));

// --- rendering ---
function render() {
  const results = filterSongs(songs, selection);
  updateMap(counts(songs, selection, "country"), selection.country);

  const continents = counts(songs, selection, "continent");
  chips($("continents"), Object.entries(CONTINENTS).map(([code, name]) => [code, name, continents.get(code) ?? 0]),
    selection.continent, (continent) => select({ continent }));

  $("summary").replaceChildren(el("b", {}, results.length === songs.length ? `All ${plural(songs.length, "song")}` : plural(results.length, "song")));
  $("clear").hidden = !KEYS.some((k) => selection[k]);
  $("random").disabled = results.length === 0;
  $("play").replaceChildren(...playLinks(results.map((s) => s.video)));

  showCards($("songs"), results.map(card));
  $("empty").hidden = results.length > 0;
}

render();
