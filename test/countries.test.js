import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { counts, filterSongs, fromHash, toHash } from "../src/countries/filter.js";

const SONGS = [
  { country: "Albania", continent: "EU", song: "Albania (Are You All Mine?)", artist: "Albania", album: "The Chiswick Story", video: "a" },
  { country: "Ivory Coast", continent: "AF", song: "Ivory Coast", artist: "Rancid", album: "Life Won't Wait", video: "b" },
  { country: "São Tomé and Príncipe", continent: "AF", song: "São Tomé", artist: "Fael", album: "", video: "c" },
  { country: "Japan", continent: "AS", song: "Lovers In Japan", artist: "Coldplay", album: "Viva la Vida", video: "d" },
];
const none = { continent: null, country: null, q: null };
const names = (selection) => filterSongs(SONGS, { ...none, ...selection }).map((s) => s.country);

test("filters combine, and search ignores case and accents", () => {
  assert.deepEqual(names({ continent: "AF" }), ["Ivory Coast", "São Tomé and Príncipe"]);
  assert.deepEqual(names({ continent: "AF", q: "rancid" }), ["Ivory Coast"]);
  assert.deepEqual(names({ q: "sao tome" }), ["São Tomé and Príncipe"]);
  assert.deepEqual(names({ q: "viva" }), ["Japan"]);
  assert.deepEqual(names({ country: "Japan" }), ["Japan"]);
});

test("counts for a facet ignore that facet's own filter", () => {
  assert.deepEqual(counts(SONGS, { ...none, continent: "AF" }, "continent"), new Map([["EU", 1], ["AF", 2], ["AS", 1]]));
  assert.deepEqual(counts(SONGS, { ...none, continent: "AF" }, "country"), new Map([["Ivory Coast", 1], ["São Tomé and Príncipe", 1]]));
});

test("the selection round-trips through the URL hash", () => {
  const selection = { continent: "OC", country: "São Tomé and Príncipe", q: "a b&c" };
  assert.deepEqual(fromHash(toHash(selection)), selection);
  assert.equal(toHash(none), "");
  assert.deepEqual(fromHash("#continent=XX"), none);
});

test("the Independent Nations list has a song with a video for each country (and a few others), all on the map", () => {
  const data = JSON.parse(readFileSync(new URL("../src/countries/data.json", import.meta.url)));
  const songs = data.lists.nations;
  assert.equal(songs.length, 199);
  assert.equal(new Set(songs.map((s) => s.country)).size, 199);
  const onMap = new Set(data.countries.map((c) => c.name));
  for (const song of songs) {
    assert.match(song.video, /^[\w-]{11}$/, song.song);
    assert.ok(onMap.has(song.country), song.country);
    assert.match(song.flag, /^\p{Regional_Indicator}{2}$/u, song.country);
  }
});
