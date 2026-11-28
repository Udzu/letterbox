import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { counts, eraOf, filterPairs, fromHash, playVideos, sortPairs, surname, toHash } from "../src/classical/filter.js";

const pair = (section, composers, pop, piece, year, era = eraOf(year)) => ({
  section, composers, year, era, pop: { song: pop, artist: "", album: "", video: "x" }, piece: { song: piece, artist: "", album: "", video: "y" },
});
const PAIRS = [
  pair("adaptation", ["Sergei Rachmaninoff"], "All By Myself", "Piano Concerto No. 2", 1901),
  pair("adaptation", ["Antonín Dvořák"], "Goin' Home", "Symphony No. 9", 1893),
  pair("sample", ["Sergei Rachmaninoff"], "Mountains", "Lilacs", 1902),
  pair("sample", ["Franz Liszt", "Niccolò Paganini"], "Shut Down", "La campanella", 1851),
  pair("sample", ["Johann Sebastian Bach"], "Symphony in X Major", "Brandenburg Concerto No. 3", 1721),
];
const none = { section: null, era: null, composer: null, q: null, sort: null, play: null };
const pops = (selection) => filterPairs(PAIRS, { ...none, ...selection }).map((p) => p.pop.song);

test("filters combine, and search covers both tracks and composers, ignoring case and accents", () => {
  assert.deepEqual(pops({ composer: "Sergei Rachmaninoff" }), ["All By Myself", "Mountains"]);
  assert.deepEqual(pops({ composer: "Sergei Rachmaninoff", section: "sample" }), ["Mountains"]);
  assert.deepEqual(pops({ q: "dvorak" }), ["Goin' Home"]);
  assert.deepEqual(pops({ q: "piano concerto" }), ["All By Myself"]);
  assert.deepEqual(pops({ composer: "Niccolò Paganini" }), ["Shut Down"]);
});

test("counts for a facet ignore that facet's own filter, and count each composer", () => {
  assert.deepEqual(counts(PAIRS, { ...none, section: "sample" }, "section"), new Map([["adaptation", 2], ["sample", 3]]));
  assert.deepEqual(counts(PAIRS, { ...none, section: "sample" }, "era"), new Map([["Romantic", 2], ["Baroque", 1]]));
  assert.deepEqual(counts(PAIRS, { ...none, section: "sample" }, "composer"),
    new Map([["Sergei Rachmaninoff", 1], ["Franz Liszt", 1], ["Niccolò Paganini", 1], ["Johann Sebastian Bach", 1]]));
});

test("eras come from years, and pairs can be sorted by year or filtered by era or year", () => {
  assert.deepEqual([1700, 1750, 1819, 1820, 1909, 1910, 1987].map(eraOf), ["Baroque", "Classical", "Classical", "Romantic", "Romantic", "Modern", "Modern"]);
  assert.deepEqual(sortPairs(PAIRS, "year").map((p) => p.year), [1721, 1851, 1893, 1901, 1902]);
  assert.equal(sortPairs(PAIRS, null), PAIRS);
  assert.deepEqual(pops({ era: "Baroque" }), ["Symphony in X Major"]);
  assert.deepEqual(pops({ q: "1901" }), ["All By Myself"]);
});

test("the play links play pairs, or just the pop songs or pieces", () => {
  const two = PAIRS.slice(0, 2);
  assert.deepEqual(playVideos(two, null), ["x", "y", "x", "y"]);
  assert.deepEqual(playVideos(two, "pop"), ["x", "x"]);
  assert.deepEqual(playVideos(two, "piece"), ["y", "y"]);
});

test("surnames skip particles like van and von but keep di", () => {
  assert.equal(surname("Johann Sebastian Bach"), "Bach");
  assert.equal(surname("Ludwig van Beethoven"), "Beethoven");
  assert.equal(surname("Eduardo di Capua"), "di Capua");
  assert.equal(surname("Satie"), "Satie");
});

test("the selection round-trips through the URL hash, dropping unknown sections", () => {
  const selection = { section: "sample", era: "Baroque", composer: "Johann Sebastian Bach", q: "a b&c", sort: "year", play: "piece" };
  assert.deepEqual(fromHash(toHash(selection)), selection);
  assert.equal(toHash(none), "");
  assert.equal(fromHash("#section=remix").section, null);
  assert.equal(fromHash("#era=Rococo").era, null);
  assert.equal(fromHash("#sort=composer").sort, null);
  assert.equal(fromHash("#play=both").play, null);
});

test("the built data pairs every pop song with a piece and its composers", () => {
  const { pairs } = JSON.parse(readFileSync(new URL("../src/classical/data.json", import.meta.url), "utf8"));
  assert.ok(pairs.length > 100);
  for (const p of pairs) {
    assert.ok(["adaptation", "sample"].includes(p.section));
    assert.ok(p.composers.length > 0, p.piece.song);
    assert.ok(p.year >= 1600 && p.year <= 2026 && p.era, p.piece.song);
    assert.ok(p.pop.song && p.piece.song);
  }
});
