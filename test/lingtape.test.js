import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { counts, filterSongs, fold, fromHash, playlistLinks, toHash } from "../src/lingtape/filter.js";

const SONGS = [
  { language: "Yiddish", iso: "yid", family: "Indo-European", branch: "Germanic", continent: "EU", country: "USA", song: "A", artist: "X", video: "a" },
  { language: "Dutch", iso: "nld", family: "Indo-European", branch: "Germanic", continent: "EU", country: "Netherlands", song: "Icarus", artist: "Spinvis", video: "b" },
  { language: "Breton", iso: "bre", family: "Indo-European", branch: "Celtic", continent: "EU", country: "France", song: "Gortoz a Ran", artist: "Denez Prigent", video: "c" },
  { language: "Cherokee", iso: "chr", family: "Iroquoian", branch: null, continent: "NA", country: "USA", song: "Judadatla Tsisqwa", artist: "Kalyn Fay", video: "d" },
  { language: "Southern Sámi", iso: "sma", family: "Uralic", branch: "Sami", continent: "EU", country: "Norway", song: "Sïlpelibjh", artist: "Marja Mortensson", video: null },
  { language: "Toki Pona", iso: "tok", family: "conlang", branch: null, continent: "EU", country: null, song: "T", artist: "Y", video: "e" },
];
const none = { continent: null, family: null, branch: null, country: null, q: null };
const languages = (selection) => filterSongs(SONGS, { ...none, ...selection }).map((s) => s.language);

test("filters combine, with the continent being the language's, not its country's", () => {
  assert.deepEqual(languages({ continent: "EU", country: "USA" }), ["Yiddish"]);
  assert.deepEqual(languages({ family: "Indo-European", branch: "Germanic" }), ["Yiddish", "Dutch"]);
  assert.deepEqual(languages({ country: "USA" }), ["Yiddish", "Cherokee"]);
  assert.equal(languages({}).length, SONGS.length);
});

test("search matches every word, ignoring case and accents", () => {
  assert.deepEqual(languages({ q: "sami" }), ["Southern Sámi"]);
  assert.deepEqual(languages({ q: "SPINVIS icarus" }), ["Dutch"]);
  assert.deepEqual(languages({ q: "germanic usa" }), ["Yiddish"]);
  assert.deepEqual(languages({ q: "chr" }), ["Cherokee"]);
  assert.deepEqual(languages({ q: "  " }).length, SONGS.length);
  assert.equal(fold("Côte d'Ivoire"), "cote d'ivoire");
});

test("counts for a facet ignore that facet's own filter", () => {
  const selection = { ...none, continent: "EU", country: "USA" };
  assert.deepEqual(counts(SONGS, selection, "continent"), new Map([["EU", 1], ["NA", 1]]));
  assert.deepEqual(counts(SONGS, selection, "country"), new Map([["USA", 1], ["Netherlands", 1], ["France", 1], ["Norway", 1]]));
  const family = { ...none, family: "Indo-European", branch: "Celtic" };
  assert.deepEqual(counts(SONGS, family, "family"), new Map([["Indo-European", 3], ["Iroquoian", 1], ["Uralic", 1], ["conlang", 1]]));
  assert.deepEqual(counts(SONGS, family, "branch"), new Map([["Germanic", 2], ["Celtic", 1]]));
});

test("the selection round-trips through the URL hash", () => {
  const selection = { ...none, continent: "EU", family: "Indo-European", branch: "Germanic", q: "a b&c" };
  assert.deepEqual(fromHash(toHash(selection)), selection);
  assert.equal(toHash(none), "");
  assert.deepEqual(fromHash(""), none);
  assert.deepEqual(fromHash("#branch=Germanic"), none); // a branch needs its family
});

test("playlist links hold at most 50 videos each", () => {
  const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
  const links = playlistLinks(ids);
  assert.deepEqual(links.map((l) => [l.from, l.to]), [[1, 50], [51, 100], [101, 120]]);
  assert.equal(links[2].url, `https://www.youtube.com/watch_videos?video_ids=${ids.slice(100).join(",")}`);
  assert.deepEqual(playlistLinks([]), []);
});

test("the data has a song for each language, on the map", () => {
  const data = JSON.parse(readFileSync(new URL("../src/lingtape/data.json", import.meta.url)));
  const names = new Set(data.countries.map((c) => c.name));
  assert.equal(new Set(data.songs.map((s) => s.language)).size, data.songs.length);
  for (const song of data.songs) {
    assert.ok(!song.country || names.has(song.country), song.country);
    assert.ok(song.continent in { AF: 1, AS: 1, EU: 1, NA: 1, OC: 1, SA: 1 }, song.language);
    assert.ok(song.video === null || /^[\w-]{11}$/.test(song.video), song.language);
  }
});
