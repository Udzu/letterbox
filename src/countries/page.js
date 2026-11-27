// The Countries page: browse playlists of songs named after countries (Independent Nations, and Jazz
// Countries in its own tab) by map, continent and search, and play the songs in place or on YouTube.

import data from "./data.json";
import { CONTINENTS, counts, filterSongs, fromHash, KEYS, toHash } from "./filter.js";
import { createMap } from "../shared/map.js";
import { createPlayer, el, playLinks, plural, showCards } from "../shared/songs.js";

const $ = (id) => document.getElementById(id);

let selection = fromHash(location.hash);
let songs; // the songs in the selected list

// change the selection (or, with fresh, start a new one: filters don't carry over between the tabs)
function select(changes, fresh = false) {
  selection = fresh ? { ...fromHash(""), ...changes } : { ...selection, ...changes };
  history.replaceState(null, "", toHash(selection) || location.pathname + location.search);
  render();
}

// --- the tabs: the playlists, each with its own intro (elements with data-list) ---
const TABS = { nations: "🌍 Independent Nations", jazz: "🎷 Jazz" };
const listOf = (selection) => selection.list ?? "nations";
function renderTabs() {
  const list = listOf(selection);
  $("tabs").replaceChildren(...Object.entries(TABS).map(([l, label]) => el("button", {
    type: "button", role: "tab", className: "tab", ariaSelected: String(l === list),
    onclick: () => { if (l !== list) { search.value = ""; select({ list: l === "nations" ? null : l }, true); } },
  }, label, " ", el("span", { className: "count" }, String(data.lists[l].length)))));
  for (const e of document.querySelectorAll("[data-list]")) e.hidden = e.dataset.list !== list;
}

// --- the map: hovering over a country shows its songs (whether or not they're filtered out) ---
const LEVELS = [1, 2, 3, 4];
const updateMap = createMap($("map"), data, {
  onSelect: (country) => select({ country: selection.country === country ? null : country }),
  zoomIn: $("zoom-in"),
  zoomOut: $("zoom-out"),
  zoomReset: $("zoom-reset"),
  levels: LEVELS,
  label: (name) => {
    const here = songs.filter((s) => s.countries.includes(name));
    if (!here.length) return name;
    // just the song named after the country itself (or the first), if there are several
    const main = here.find((s) => s.name === name) ?? here[0];
    const others = here.length - 1;
    return `${name}: ${main.song} · ${main.artist}${others ? ` (+ ${others} other${others === 1 ? "" : "s"})` : ""}`;
  },
});
$("legend").append(...LEVELS.map((n, i) => el("span", {}, el("i", { className: `level${i}` }), i === LEVELS.length - 1 ? `${n}+` : String(n))));

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
$("clear").addEventListener("click", () => { search.value = ""; select(Object.fromEntries(KEYS.map((k) => [k, null]))); }); // keeps the tab
window.addEventListener("hashchange", () => { selection = fromHash(location.hash); search.value = selection.q ?? ""; render(); });

// --- the songs ---
const { thumbnail, playRandom } = createPlayer();

// a link-styled button that sets a filter and scrolls to the results
const filterLink = (text, changes, title) => el("button", { type: "button", className: "link", title,
  onclick: () => { select(changes); $("results-header").scrollIntoView({ block: "start" }); } }, text);

// the song's countries, as flag and link each, after the historical name if it has one:
// "Prussia (now 🇩🇪 Germany, 🇵🇱 Poland)"
function where(song) {
  const modern = song.countries.flatMap((c, i) => [i ? ", " : "", `${song.flags[i]} `, filterLink(c, { country: c }, "Show this country's songs")]);
  const historical = song.countries.length > 1 || song.name !== song.countries[0];
  return historical ? [song.name, " (now ", ...modern, ")"] : modern;
}

const cards = new Map(); // song → card, made once and reused so playing videos survive filtering
function card(song) {
  if (cards.has(song)) return cards.get(song);
  const c = el("article", { className: "song" },
    thumbnail(song),
    el("div", { className: "info" },
      el("div", { className: "title" }, el("a", { href: `https://youtu.be/${song.video}`, target: "_blank", rel: "noopener" }, song.song)),
      el("div", { className: "artist" }, song.artist),
      el("div", { className: "where" }, ...where(song),
        ...song.continents.flatMap((c, i) => [i ? ", " : " · ", filterLink(CONTINENTS[c], { continent: c }, "Show this continent's songs")]))));
  c.song = song;
  cards.set(song, c);
  return c;
}

$("random").addEventListener("click", () => playRandom(filterSongs(songs, selection).map(card)));

// --- rendering ---
function render() {
  songs = data.lists[listOf(selection)];
  renderTabs();
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
