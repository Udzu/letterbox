import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { counts, filterPairs, fromHash, surname, toHash } from "../src/classical/filter.js";

const pair = (section, composers, pop, piece) => ({
  section, composers, pop: { song: pop, artist: "", album: "", video: "x" }, piece: { song: piece, artist: "", album: "", video: "y" },
});
const PAIRS = [
  pair("adaptation", ["Sergei Rachmaninoff"], "All By Myself", "Piano Concerto No. 2"),
  pair("adaptation", ["Antonín Dvořák"], "Goin' Home", "Symphony No. 9"),
  pair("sample", ["Sergei Rachmaninoff"], "Mountains", "Lilacs"),
  pair("sample", ["Franz Liszt", "Niccolò Paganini"], "Shut Down", "La campanella"),
];
const none = { section: null, composer: null, q: null };
const pops = (selection) => filterPairs(PAIRS, { ...none, ...selection }).map((p) => p.pop.song);

test("filters combine, and search covers both tracks and composers, ignoring case and accents", () => {
  assert.deepEqual(pops({ composer: "Sergei Rachmaninoff" }), ["All By Myself", "Mountains"]);
  assert.deepEqual(pops({ composer: "Sergei Rachmaninoff", section: "sample" }), ["Mountains"]);
  assert.deepEqual(pops({ q: "dvorak" }), ["Goin' Home"]);
  assert.deepEqual(pops({ q: "concerto" }), ["All By Myself"]);
  assert.deepEqual(pops({ composer: "Niccolò Paganini" }), ["Shut Down"]);
});

test("counts for a facet ignore that facet's own filter, and count each composer", () => {
  assert.deepEqual(counts(PAIRS, { ...none, section: "sample" }, "section"), new Map([["adaptation", 2], ["sample", 2]]));
  assert.deepEqual(counts(PAIRS, { ...none, section: "sample" }, "composer"),
    new Map([["Sergei Rachmaninoff", 1], ["Franz Liszt", 1], ["Niccolò Paganini", 1]]));
});

test("surnames skip particles like van and von but keep di", () => {
  assert.equal(surname("Johann Sebastian Bach"), "Bach");
  assert.equal(surname("Ludwig van Beethoven"), "Beethoven");
  assert.equal(surname("Eduardo di Capua"), "di Capua");
  assert.equal(surname("Satie"), "Satie");
});

test("the selection round-trips through the URL hash, dropping unknown sections", () => {
  const selection = { section: "sample", composer: "Johann Sebastian Bach", q: "a b&c" };
  assert.deepEqual(fromHash(toHash(selection)), selection);
  assert.equal(toHash(none), "");
  assert.equal(fromHash("#section=remix").section, null);
});

test("the built data pairs every pop song with a piece and its composers", () => {
  const { pairs } = JSON.parse(readFileSync(new URL("../src/classical/data.json", import.meta.url), "utf8"));
  assert.ok(pairs.length > 100);
  for (const p of pairs) {
    assert.ok(["adaptation", "sample"].includes(p.section));
    assert.ok(p.composers.length > 0, p.piece.song);
    assert.ok(p.pop.song && p.piece.song);
  }
});
