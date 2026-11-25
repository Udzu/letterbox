// The Lingtape page: browse the LINGTAPE playlist (a song in each of 365 languages) by map, continent,
// language family and search, and play the songs in place or as a YouTube playlist.

import data from "./data.json";
import { CONTINENTS, counts, filterSongs, fromHash, playlistLinks, toHash } from "./filter.js";
import { createMap, LEVELS } from "./map.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children.filter((c) => c != null && c !== false));
  return e;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

const songs = data.songs;
let selection = fromHash(location.hash);

function select(changes) {
  selection = { ...selection, ...changes };
  if (!selection.family) selection.branch = null;
  history.replaceState(null, "", toHash(selection) || location.pathname + location.search);
  render();
}

// --- the map ---
const updateMap = createMap($("map"), data, {
  onSelect: (country) => select({ country: selection.country === country ? null : country }),
  zoomIn: $("zoom-in"),
  zoomOut: $("zoom-out"),
  zoomReset: $("zoom-reset"),
});
$("legend").append(...LEVELS.map((min, i) => el("span", {}, el("i", { className: `level${i}` }),
  i === LEVELS.length - 1 ? `${min}+` : LEVELS[i + 1] - 1 === min ? `${min}` : `${min}–${LEVELS[i + 1] - 1}`)));

// --- the filters ---
// a row of toggle buttons, one for each value with songs (or selected), with its count
function chips(container, entries, selected, onClick) {
  container.replaceChildren(...entries.filter(([value, , n]) => n || value === selected).map(([value, label, n]) =>
    el("button", { type: "button", className: "chip", ariaPressed: String(value === selected), onclick: () => onClick(value === selected ? null : value) },
      label, " ", el("span", { className: "count" }, String(n)))));
}

// families with most songs first, the descriptive categories (creole, conlang, …) after the real families
const isCategory = (family) => family === family.toLowerCase();
function familyEntries(map) {
  return [...map].sort((a, b) => isCategory(a[0]) - isCategory(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0])).map(([f, n]) => [f, f, n]);
}

const search = $("search");
search.value = selection.q ?? "";
search.addEventListener("input", () => select({ q: search.value.trim() || null }));
$("country").addEventListener("change", (e) => select({ country: e.target.value || null }));
$("clear").addEventListener("click", () => { search.value = ""; select({ continent: null, family: null, branch: null, country: null, q: null }); });
window.addEventListener("hashchange", () => { selection = fromHash(location.hash); search.value = selection.q ?? ""; render(); });

// --- the songs ---
let playing = null; // the card whose video is playing in place

function thumbnail(song) {
  if (!song.video) {
    return el("div", { className: "thumb missing" }, el("span", {}, "Not on YouTube"),
      el("a", { href: "https://music.apple.com/gb/playlist/lingtape/pl.u-KVXBBJWsmgB1L9", target: "_blank", rel: "noopener" }, "Apple Music playlist"));
  }
  const button = el("button", { type: "button", className: "thumb", title: `Play ${song.song}`, onclick: () => play(button.closest(".song")) },
    el("img", { src: `https://i.ytimg.com/vi/${song.video}/mqdefault.jpg`, alt: "", loading: "lazy" }),
    el("span", { className: "play", ariaHidden: "true" }, "▶"));
  return button;
}

function play(card) {
  if (playing && playing !== card) stop(playing);
  playing = card;
  const song = card.song;
  card.querySelector(".thumb").replaceWith(el("iframe", {
    className: "thumb",
    src: `https://www.youtube-nocookie.com/embed/${song.video}?autoplay=1&rel=0`,
    title: `${song.song} by ${song.artist}`,
    allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
    allowFullscreen: true,
  }));
}

function stop(card) {
  card.querySelector(".thumb").replaceWith(thumbnail(card.song));
  if (playing === card) playing = null;
}

// a link-styled button that sets a filter
const filterLink = (text, changes, title) => el("button", { type: "button", className: "link", title, onclick: () => { select(changes); $("results-header").scrollIntoView({ block: "start" }); } }, text);

const cards = new Map(); // song → card, made once and reused so playing videos survive filtering
function card(song) {
  if (cards.has(song)) return cards.get(song);
  const where = [
    filterLink(song.family, { family: song.family, branch: null }, "Show this family"),
    song.branch && " / ", song.branch && filterLink(song.branch, { family: song.family, branch: song.branch }, "Show this branch"),
    " · ",
    song.country ? filterLink(song.country, { country: song.country }, "Show this country") : "no country",
  ];
  const c = el("article", { className: "song" },
    thumbnail(song),
    el("div", { className: "info" },
      el("div", { className: "language" }, el("b", {}, song.language), " ",
        song.iso && el("a", { className: "iso", href: `https://iso639-3.sil.org/code/${song.iso}`, target: "_blank", rel: "noopener", title: "ISO 639-3 code" }, song.iso)),
      el("div", { className: "title" }, song.video
        ? el("a", { href: `https://youtu.be/${song.video}`, target: "_blank", rel: "noopener" }, song.song)
        : song.song, el("span", { className: "artist" }, ` · ${song.artist}`)),
      el("div", { className: "where" }, ...where.filter(Boolean))));
  c.song = song;
  cards.set(song, c);
  return c;
}

$("random").addEventListener("click", () => {
  const playable = filterSongs(songs, selection).filter((s) => s.video);
  if (!playable.length) return;
  const c = card(playable[Math.floor(Math.random() * playable.length)]);
  c.scrollIntoView({ block: "center", behavior: "smooth" });
  play(c);
});

// Show the given cards (in the sheet's order, as are those shown) without moving any that are already
// shown, since moving an iframe reloads it and would restart a playing video.
function showCards(wanted) {
  const list = $("songs");
  const keep = new Set(wanted);
  for (const c of [...list.children]) if (!keep.has(c)) c.remove();
  let next = list.firstElementChild;
  for (const c of wanted) {
    if (c === next) next = next.nextElementSibling;
    else list.insertBefore(c, next);
  }
}

// --- rendering ---
function render() {
  const results = filterSongs(songs, selection);
  updateMap(counts(songs, selection, "country"), selection.country);

  const continents = counts(songs, selection, "continent");
  chips($("continents"), Object.entries(CONTINENTS).map(([code, name]) => [code, name, continents.get(code) ?? 0]),
    selection.continent, (continent) => select({ continent }));
  chips($("families"), familyEntries(counts(songs, selection, "family")), selection.family, (family) => select({ family }));
  const branches = selection.family ? counts(songs, selection, "branch") : new Map();
  $("branches-row").hidden = $("branches-label").hidden = branches.size === 0;
  chips($("branches"), [...branches].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([b, n]) => [b, b, n]),
    selection.branch, (branch) => select({ branch }));

  const countries = counts(songs, selection, "country");
  const options = [...countries].sort((a, b) => a[0].localeCompare(b[0]));
  if (selection.country && !countries.has(selection.country)) options.unshift([selection.country, 0]);
  $("country").replaceChildren(el("option", { value: "" }, "All countries"),
    ...options.map(([c, n]) => el("option", { value: c, selected: c === selection.country }, `${c} (${n})`)));

  const videos = results.filter((s) => s.video).map((s) => s.video);
  const missing = results.length - videos.length;
  const any = Object.values(selection).some(Boolean);
  $("summary").replaceChildren(
    el("b", {}, results.length === songs.length ? `All ${plural(songs.length, "song")}` : plural(results.length, "song")),
    missing ? ` (${missing} not on YouTube)` : "");
  $("clear").hidden = !any;
  $("random").disabled = videos.length === 0;
  const links = playlistLinks(videos);
  $("play").replaceChildren(...links.map(({ from, to, url }, i) => el("a", { href: url, target: "_blank", rel: "noopener", className: "play-link" },
    links.length === 1 ? "▶ Play on YouTube" : `${i ? "" : "▶ Play on YouTube: "}${from}–${to}`)));

  showCards(results.map(card));
  $("empty").hidden = results.length > 0;
}

render();
