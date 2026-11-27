import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { counts, filterSongs, fromHash, toHash } from "../src/countries/filter.js";

const song = (name, continents, song, artist, album, countries = [name]) => ({ name, countries, continents, song, artist, album, video: "x" });
const SONGS = [
  song("Albania", ["EU"], "Albania (Are You All Mine?)", "Albania", "The Chiswick Story"),
  song("Ivory Coast", ["AF"], "Ivory Coast", "Rancid", "Life Won't Wait"),
  song("São Tomé and Príncipe", ["AF"], "São Tomé", "Fael", ""),
  song("Japan", ["AS"], "Lovers In Japan", "Coldplay", "Viva la Vida"),
  song("Soviet Union", ["EU", "AS"], "Back In the U.S.S.R.", "Ramsey Lewis", "Mother Nature's Son", ["Russia", "Kazakhstan"]),
];
const none = { list: null, continent: null, country: null, q: null };
const names = (selection) => filterSongs(SONGS, { ...none, ...selection }).map((s) => s.name);

test("filters combine, and search ignores case and accents", () => {
  assert.deepEqual(names({ continent: "AF" }), ["Ivory Coast", "São Tomé and Príncipe"]);
  assert.deepEqual(names({ continent: "AF", q: "rancid" }), ["Ivory Coast"]);
  assert.deepEqual(names({ q: "sao tome" }), ["São Tomé and Príncipe"]);
  assert.deepEqual(names({ q: "viva" }), ["Japan"]);
  assert.deepEqual(names({ country: "Japan" }), ["Japan"]);
});

test("a historical country matches each of its modern countries and continents, and its own name", () => {
  assert.deepEqual(names({ country: "Kazakhstan" }), ["Soviet Union"]);
  assert.deepEqual(names({ continent: "AS" }), ["Japan", "Soviet Union"]);
  assert.deepEqual(names({ q: "soviet" }), ["Soviet Union"]);
  assert.deepEqual(names({ q: "russia" }), ["Soviet Union"]);
  assert.deepEqual(counts(SONGS, none, "country").get("Russia"), 1);
});

test("counts for a facet ignore that facet's own filter", () => {
  assert.deepEqual(counts(SONGS, { ...none, continent: "AF" }, "continent"), new Map([["EU", 2], ["AF", 2], ["AS", 2]]));
  assert.deepEqual(counts(SONGS, { ...none, continent: "AF" }, "country"), new Map([["Ivory Coast", 1], ["São Tomé and Príncipe", 1]]));
});

test("the selection round-trips through the URL hash", () => {
  const selection = { list: null, continent: "OC", country: "São Tomé and Príncipe", q: "a b&c" };
  assert.deepEqual(fromHash(toHash(selection)), selection);
  const jazz = { ...selection, list: "jazz" };
  assert.equal(toHash({ ...none, list: "jazz" }), "#jazz");
  assert.deepEqual(fromHash(toHash(jazz)), jazz);
  assert.equal(toHash(none), "");
  assert.deepEqual(fromHash("#continent=XX"), none);
});

test("the Independent Nations list has a song with a video for each country (and a few others), all on the map", () => {
  const data = JSON.parse(readFileSync(new URL("../src/countries/data.json", import.meta.url)));
  const songs = data.lists.nations;
  assert.equal(songs.length, 199);
  assert.equal(new Set(songs.map((s) => s.name)).size, 199);
  const onMap = new Set(data.countries.map((c) => c.name));
  for (const song of [...songs, ...data.lists.jazz]) {
    assert.match(song.video, /^[\w-]{11}$/, song.song);
    for (const [i, c] of song.countries.entries()) {
      assert.ok(onMap.has(c), c);
      assert.match(song.flags[i], /^\p{Regional_Indicator}{2}$/u, c);
    }
  }
});
