// The Jewish Christmas page: browse a playlist of Christmas songs by Jewish songwriters by decade,
// language, songwriter nationality, songwriter and search, and play the songs in place or on YouTube.

import data from "./data.json";
import { counts, decade, filterSongs, fromHash, KEYS, TEAMS, toHash } from "./filter.js";
import { createPlayer, el, playLinks, plural, showCards } from "../shared/songs.js";

const $ = (id) => document.getElementById(id);
const { songs, flags } = data;
const flagged = (name) => (flags[name] ? `${flags[name]} ${name}` : name);
const TOP_WRITERS = 12; // songwriters shown under "Most songs"

let selection = fromHash(location.hash);

function select(changes) {
  if ("decade" in changes && !("year" in changes)) changes = { ...changes, year: null }; // a year needs its decade
  selection = { ...selection, ...changes };
  history.replaceState(null, "", toHash(selection) || location.pathname + location.search);
  render();
}

// --- the timeline: every decade from the 1900s, with the older songs together before them (on phones,
// only the 1900s, 1950s and 2000s are labelled, as 1900, 1950 and 2000) ---
const firstDecade = 1900, lastDecade = Math.floor(Math.max(...songs.map((s) => s.year)) / 10) * 10;
const DECADES = ["Before 1900"];
for (let d = firstDecade; d <= lastDecade; d += 10) DECADES.push(`${d}s`);
$("decades").append(...DECADES.map((d) => el("span", {},
  el("span", { className: "long" }, d === "Before 1900" ? "< 1900" : d),
  el("span", { className: "short" }, d === "Before 1900" ? "<" : Number(d.slice(0, 4)) % 50 ? "" : d.slice(0, 4)))));

function renderTimeline() {
  const n = counts(songs, selection, "decade");
  const max = Math.max(1, ...n.values());
  $("timeline").replaceChildren(...DECADES.map((d) => {
    const count = n.get(d) ?? 0;
    return el("button", {
      type: "button", className: `decade${count ? "" : " empty"}`, ariaPressed: String(d === selection.decade),
      title: `${d}: ${plural(count, "song")}`, ariaLabel: `${d}: ${plural(count, "song")}`,
      onclick: () => select({ decade: d === selection.decade ? null : d }),
    }, el("span", { className: "n" }, count ? String(count) : ""), el("span", { className: "bar", style: `height: ${(count / max) * 100}%` }));
  }));
}

// --- the filters ---
// a row of toggle buttons, one for each value with songs (or selected), with its count
function chips(container, entries, selected, onClick) {
  container.replaceChildren(...entries.filter(([value, , n]) => n || value === selected).map(([value, label, n]) =>
    el("button", { type: "button", className: "chip", ariaPressed: String(value === selected), onclick: () => onClick(value === selected ? null : value) },
      label, " ", el("span", { className: "count" }, String(n)))));
}

// the values with most songs first, with the given ones (English, American) leading
const byCount = (map, first = null) =>
  [...map].sort((a, b) => (b[0] === first) - (a[0] === first) || b[1] - a[1] || a[0].localeCompare(b[0]));

const search = $("search");
search.value = selection.q ?? "";
search.addEventListener("input", () => select({ q: search.value.trim() || null }));
$("clear").addEventListener("click", () => { search.value = ""; select(Object.fromEntries(KEYS.map((k) => [k, null]))); });
window.addEventListener("hashchange", () => { selection = fromHash(location.hash); search.value = selection.q ?? ""; render(); });

// --- the songs ---
const { thumbnail, playRandom } = createPlayer();

// a button that sets a filter and scrolls to the results
const setFilter = (changes) => { select(changes); $("results-header").scrollIntoView({ block: "start" }); };
const filterLink = (text, changes, title) => el("button", { type: "button", className: "link", title, onclick: () => setFilter(changes) }, text);
const flagLink = (name, changes, title) => flags[name] && el("button", { type: "button", className: "flag", title, ariaLabel: title, onclick: () => setFilter(changes) }, flags[name]);

const cards = new Map(); // song → card, made once and reused so playing videos survive filtering
function card(song) {
  if (cards.has(song)) return cards.get(song);
  // a ? after a name (as in the sheet) is shown as a superscript
  const writers = song.writers.flatMap((w, i) => [i ? ", " : "", filterLink(w.replace(/\?$/, ""), { writer: w }, "Show this songwriter's songs"),
    w.endsWith("?") && el("sup", {}, "?")]);
  const c = el("article", { className: "song" },
    thumbnail(song),
    el("div", { className: "info" },
      el("div", { className: "title" }, el("a", { href: `https://youtu.be/${song.video}`, target: "_blank", rel: "noopener" }, song.song),
        song.language !== "English" && " ", song.language !== "English" && flagLink(song.language, { language: song.language }, `${song.language}: show these songs`)),
      el("div", { className: "artist" }, song.artist),
      el("div", { className: "writers" },
        filterLink(String(song.year), { decade: decade(song.year), year: String(song.year) }, `Show songs from ${song.year}`), " · ",
        song.nationality !== "American" && flagLink(song.nationality, { nationality: song.nationality }, `${song.nationality} songwriters: show these songs`),
        song.nationality !== "American" && " ",
        ...writers,
        song.note && ` ${song.note}`,
        song.mixed && " ", song.mixed && filterLink("+ others", { team: "mixed" }, "With non-Jewish co-writers: show these songs"))));
  c.song = song;
  cards.set(song, c);
  return c;
}

$("random").addEventListener("click", () => playRandom(filterSongs(songs, selection).map(card)));

// --- rendering ---
function render() {
  const results = filterSongs(songs, selection);
  renderTimeline();
  const years = selection.decade ? counts(songs, selection, "year") : new Map();
  $("years-row").hidden = $("years-label").hidden = !selection.decade;
  chips($("years"), [...years].sort((a, b) => a[0] - b[0]).map(([y, n]) => [y, y, n]), selection.year, (year) => select({ year }));

  chips($("languages"), byCount(counts(songs, selection, "language"), "English").map(([l, n]) => [l, flagged(l), n]),
    selection.language, (language) => select({ language }));
  chips($("nationalities"), byCount(counts(songs, selection, "nationality"), "American").map(([c, n]) => [c, flagged(c), n]),
    selection.nationality, (nationality) => select({ nationality }));
  const teams = counts(songs, selection, "team");
  chips($("teams"), Object.entries(TEAMS).map(([t, label]) => [t, label, teams.get(t) ?? 0]), selection.team, (team) => select({ team }));
  const writers = byCount(counts(songs, selection, "writer")).filter(([, n]) => n > 1).slice(0, TOP_WRITERS);
  if (selection.writer && !writers.some(([w]) => w === selection.writer)) writers.unshift([selection.writer, counts(songs, selection, "writer").get(selection.writer) ?? 0]);
  chips($("writers"), writers.map(([w, n]) => [w, w, n]), selection.writer, (writer) => select({ writer }));

  $("summary").replaceChildren(el("b", {}, results.length === songs.length ? `All ${plural(songs.length, "song")}` : plural(results.length, "song")));
  $("clear").hidden = !Object.values(selection).some(Boolean);
  $("random").disabled = results.length === 0;
  $("play").replaceChildren(...playLinks(results.map((s) => s.video)));

  showCards($("songs"), results.map(card));
  $("empty").hidden = results.length > 0;
}

render();
