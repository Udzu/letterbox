import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { counts, decade, filterSongs, fromHash, sortSongs, surname, toHash } from "../src/stage/filter.js";

const song = (year, era, work, title, composers, language = "Italian") => ({ year, era, work, song: title, composers, language, artist: "", album: "", video: "x" });
const SONGS = [
  song(2015, "musicals", "Hamilton", "Satisfied", ["Lin-Manuel Miranda"], "English"),
  song(2011, "musicals", "Bring It On", "What I Was Born to Do", ["Tom Kitt", "Lin-Manuel Miranda"], "English"),
  song(1791, "operas", "Die Zauberflöte", "Der Hölle Rache", ["Wolfgang Amadeus Mozart"], "German"),
  song(1786, "operas", "Le nozze di Figaro", "Voi che sapete", ["Wolfgang Amadeus Mozart"]),
  song(1738, "baroque", "Serse", "Ombra mai fù", ["George Frideric Handel"]),
];
const none = { era: null, decade: null, year: null, language: null, composer: null, q: null, sort: null };
const titles = (selection) => filterSongs(SONGS, { ...none, ...selection }).map((s) => s.song);

test("filters combine, and search covers works and composers, ignoring case and accents", () => {
  assert.deepEqual(titles({ composer: "Lin-Manuel Miranda" }), ["Satisfied", "What I Was Born to Do"]);
  assert.deepEqual(titles({ era: "operas", decade: "1790s" }), ["Der Hölle Rache"]);
  assert.deepEqual(titles({ era: "operas", decade: "1780s", year: "1786" }), ["Voi che sapete"]);
  assert.deepEqual(titles({ language: "German" }), ["Der Hölle Rache"]);
  assert.deepEqual(titles({ era: "operas", language: "Italian" }), ["Voi che sapete"]);
  // the language only shows as a flag, so isn't searched
  assert.deepEqual(titles({ q: "german" }), []);
  assert.deepEqual(titles({ q: "holle" }), ["Der Hölle Rache"]);
  assert.deepEqual(titles({ q: "figaro mozart" }), ["Voi che sapete"]);
  assert.deepEqual(titles({ q: "baroque" }), ["Ombra mai fù"]);
  // search words match the start of words: "kander" doesn't find Michael Iskander, but "mira" finds Miranda
  const iskander = { ...SONGS[1], artist: "Michael Iskander" };
  assert.deepEqual(filterSongs([iskander], { ...none, q: "kander" }), []);
  assert.deepEqual(titles({ q: "mira" }), ["Satisfied", "What I Was Born to Do"]);
  assert.deepEqual(titles({ q: "(" }), []);
});

test("counts for a facet ignore that facet's own filter (and decades ignore the year), counting each composer", () => {
  assert.deepEqual(counts(SONGS, { ...none, era: "operas" }, "era"), new Map([["musicals", 2], ["operas", 2], ["baroque", 1]]));
  assert.deepEqual(counts(SONGS, { ...none, era: "operas", decade: "1780s", year: "1786" }, "decade"), new Map([["1790s", 1], ["1780s", 1]]));
  assert.deepEqual(counts(SONGS, { ...none, era: "musicals" }, "composer"), new Map([["Lin-Manuel Miranda", 2], ["Tom Kitt", 1]]));
  assert.deepEqual(counts(SONGS, { ...none, language: "German" }, "language"), new Map([["English", 2], ["German", 1], ["Italian", 2]]));
});

test("songs sort newest or oldest first", () => {
  assert.deepEqual(sortSongs(SONGS, null).map((s) => s.year), [2015, 2011, 1791, 1786, 1738]);
  assert.deepEqual(sortSongs(SONGS, "oldest").map((s) => s.year), [1738, 1786, 1791, 2011, 2015]);
  assert.equal(decade(1637), "1630s");
});

test("surnames are the last word, apart from a few", () => {
  assert.equal(surname("Wolfgang Amadeus Mozart"), "Mozart");
  assert.equal(surname("Ludwig van Beethoven"), "Beethoven");
  assert.equal(surname("Johann Strauss II"), "Strauss II");
  assert.equal(surname("Andrew Lloyd Webber"), "Lloyd Webber");
  assert.equal(surname("Stew"), "Stew");
});

test("the selection round-trips through the URL hash, dropping a year outside its decade", () => {
  const selection = { era: "operas", decade: "1780s", year: "1786", language: "Italian", composer: "Wolfgang Amadeus Mozart", q: "a b&c", sort: "oldest" };
  assert.deepEqual(fromHash(toHash(selection)), selection);
  assert.equal(toHash(none), "");
  assert.equal(fromHash("#era=operetta").era, null);
  assert.equal(fromHash("#decade=1780s&year=1791").year, null);
  assert.equal(fromHash("#sort=newest").sort, null);
});

test("the built data has a song a year from 1637 to 2024 but 1646, newest first, each with a work, composer and language", () => {
  const { songs, gaps, flags } = JSON.parse(readFileSync(new URL("../src/stage/data.json", import.meta.url), "utf8"));
  assert.deepEqual(gaps.map((g) => [g.year, g.era, Boolean(g.note)]), [[1646, "baroque", true]]);
  const years = songs.map((s) => s.year);
  const expected = [];
  for (let y = 2024; y >= 1637; y--) if (y !== 1646) expected.push(y);
  assert.deepEqual(years, expected);
  const eraOf = (y) => (y >= 1877 ? "musicals" : y >= 1761 ? "operas" : "baroque");
  for (const s of songs) {
    assert.equal(s.era, eraOf(s.year), `${s.year} ${s.song}`);
    assert.ok(s.work && s.song && s.composers.length && flags[s.language], `${s.year} ${s.song}`);
  }
});
