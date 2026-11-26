import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { counts, decade, filterSongs, fromHash, parseWriters, toHash } from "../src/christmas/filter.js";

const SONGS = [
  { year: 1855, language: "English", song: "Hark! The Herald Angels Sing", artist: "Frank Sinatra", nationality: "German", mixed: true, writers: ["Felix Mendelssohn"], note: null, video: "a" },
  { year: 1942, language: "English", song: "White Christmas", artist: "Bing Crosby", nationality: "American", mixed: false, writers: ["Irving Berlin"], note: null, video: "b" },
  { year: 1945, language: "English", song: "Let It Snow", artist: "Dean Martin", nationality: "American", mixed: false, writers: ["Sammy Cahn", "Jule Styne"], note: null, video: "c" },
  { year: 1960, language: "French", song: "Noël, c'est l'amour", artist: "Tino Rossi", nationality: "French", mixed: false, writers: ["Norbert Glanzberg"], note: null, video: "d" },
  { year: 2014, language: "English", song: "Cozy Little Christmas", artist: "Katy Perry", nationality: "American", mixed: true, writers: ["Greg Kurstin", "Jack Antonoff"], note: "(& St Vincent is ~20% Jewish)", video: "e" },
];
const none = { language: null, nationality: null, decade: null, year: null, team: null, writer: null, q: null };
const names = (selection) => filterSongs(SONGS, { ...none, ...selection }).map((s) => s.song);

test("decades, with the songs before 1900 together", () => {
  assert.equal(decade(1855), "Before 1900");
  assert.equal(decade(1900), "1900s");
  assert.equal(decade(1949), "1940s");
  assert.equal(decade(2025), "2020s");
});

test("filters combine", () => {
  assert.deepEqual(names({ decade: "1940s" }), ["White Christmas", "Let It Snow"]);
  assert.deepEqual(names({ team: "mixed" }), ["Hark! The Herald Angels Sing", "Cozy Little Christmas"]);
  assert.deepEqual(names({ team: "jewish", nationality: "American" }), ["White Christmas", "Let It Snow"]);
  assert.deepEqual(names({ writer: "Jule Styne" }), ["Let It Snow"]);
  assert.deepEqual(names({ language: "French" }), ["Noël, c'est l'amour"]);
  assert.equal(names({}).length, SONGS.length);
});

test("search matches every word in the song, performer, songwriters and note, ignoring case and accents", () => {
  assert.deepEqual(names({ q: "noel" }), ["Noël, c'est l'amour"]);
  assert.deepEqual(names({ q: "cahn snow" }), ["Let It Snow"]);
  assert.deepEqual(names({ q: "vincent" }), ["Cozy Little Christmas"]);
  assert.deepEqual(names({ q: "sinatra" }), ["Hark! The Herald Angels Sing"]);
});

test("counts for a facet ignore that facet's own filter, and count each songwriter", () => {
  const selection = { ...none, decade: "1940s", nationality: "French" };
  assert.deepEqual(counts(SONGS, selection, "decade"), new Map([["1960s", 1]]));
  assert.deepEqual(counts(SONGS, selection, "nationality"), new Map([["American", 2]]));
  assert.deepEqual(counts(SONGS, { ...none, team: "mixed" }, "writer"),
    new Map([["Felix Mendelssohn", 1], ["Greg Kurstin", 1], ["Jack Antonoff", 1]]));
});

test("songwriters are split into names, with first names sharing a surname and notes kept apart", () => {
  assert.deepEqual(parseWriters("Sammy Cahn, Jule Styne"), { writers: ["Sammy Cahn", "Jule Styne"], note: null });
  assert.deepEqual(parseWriters("Aaron and Bryce Dessner"), { writers: ["Aaron Dessner", "Bryce Dessner"], note: null });
  assert.deepEqual(parseWriters("Ryan & Jack Met, Sam Hollander"), { writers: ["Ryan Met", "Jack Met", "Sam Hollander"], note: null });
  assert.deepEqual(parseWriters("Jack Antonoff (& St Vincent is ~20% Jewish)"), { writers: ["Jack Antonoff"], note: "(& St Vincent is ~20% Jewish)" });
});

test("the selection round-trips through the URL hash", () => {
  const selection = { ...none, language: "French", decade: "Before 1900", team: "mixed", writer: "Irving Berlin", q: "a b&c" };
  assert.deepEqual(fromHash(toHash(selection)), selection);
  assert.equal(toHash(none), "");
  assert.deepEqual(fromHash(""), none);
  assert.deepEqual(fromHash("#team=other"), none);
});

test("the data has a YouTube video for each song, and flags for the languages and nationalities", () => {
  const data = JSON.parse(readFileSync(new URL("../src/christmas/data.json", import.meta.url)));
  for (const song of data.songs) {
    assert.match(song.video, /^[\w-]{11}$/, song.song);
    assert.ok(song.writers.length > 0, song.song);
    assert.ok(song.language === "English" || data.flags[song.language], song.language);
    assert.ok(data.flags[song.nationality], song.nationality);
  }
});

test("a year narrows its decade, and needs it", () => {
  assert.deepEqual(names({ decade: "1940s", year: "1945" }), ["Let It Snow"]);
  assert.deepEqual(counts(SONGS, { ...none, decade: "1940s", year: "1945" }, "year"), new Map([["1942", 1], ["1945", 1]]));
  assert.deepEqual(counts(SONGS, { ...none, decade: "1940s", year: "1945" }, "decade").get("1940s"), 2);
  assert.deepEqual(fromHash("#decade=1940s&year=1945"), { ...none, decade: "1940s", year: "1945" });
  assert.deepEqual(fromHash("#year=1945"), none);
  assert.deepEqual(fromHash("#decade=1950s&year=1945"), { ...none, decade: "1950s" });
});
