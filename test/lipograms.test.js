import { test } from "node:test";
import assert from "node:assert/strict";
import { avoidedLetters, check, entryFilter, entryInfo, findWords, nextLengths, plainLetters, restOf, sequenceFor } from "../src/lipograms/text.js";

const lengths = (text) => findWords(text).map((w) => w.length);
const fitting = (entries, options) => entries.map(entryInfo).filter((i) => i !== null).filter(entryFilter(options)).map((i) => i.entry);

test("counts words as the text does: apostrophes are silent, hyphens split", () => {
  assert.deepEqual(lengths("don't fun-filled café"), [4, 3, 6, 4]);
});

test("avoided letters are folded and ignore spaces", () => {
  assert.deepEqual(avoidedLetters("E é æ"), ["e", "a"]);
});

test("entries are filtered by avoided letters, including accented and combined ones", () => {
  const list = ["cat", "café", "Æsop", "dog", "Œdipus", "123"];
  assert.deepEqual(fitting(list, { avoided: ["e"] }), ["cat", "dog", "123"]);
  assert.deepEqual(fitting(list, { avoided: ["a", "o"] }), ["123"]);
});

test("capitals and phrases are kept", () => {
  assert.deepEqual(fitting(["Paris", "ice cream", "it's"], { avoided: ["e"] }), ["Paris", "it's"]);
  assert.deepEqual(fitting(["Paris", "ice cream", "it's"], {}), ["Paris", "ice cream", "it's"]);
});

test("entries without letters or digits are skipped", () => {
  assert.equal(entryInfo("--"), null);
});

test("first and last letters ignore case and accents", () => {
  const list = ["Éclair", "apple", "echo", "café", "Æsop", "mass", "Straße"];
  assert.deepEqual(fitting(list, { first: "e" }), ["Éclair", "echo"]);
  assert.deepEqual(fitting(list, { last: "e" }), ["apple", "café", "Straße"]);
  assert.deepEqual(fitting(list, { first: "a" }), ["apple", "Æsop"]);
  assert.deepEqual(fitting(list, { last: "s" }), ["mass"]);
  assert.deepEqual(fitting(list, { first: "e", last: "o" }), ["echo"]);
  assert.deepEqual(fitting(["it's", "'tis"], { first: "t", last: "s" }), ["'tis"]);
});

test("starts and ends with several letters, ignoring anything but letters and digits", () => {
  const list = ["sing", "singing", "Ring", "ding-dong", "don't", "doing", "Ich bin", "abc123"];
  assert.equal(plainLetters("-ING"), "ing");
  assert.deepEqual(fitting(list, { last: plainLetters("-ing") }), ["sing", "singing", "Ring", "doing"]);
  assert.deepEqual(fitting(list, { first: plainLetters("sin"), last: plainLetters("ging") }), ["singing"]);
  assert.deepEqual(fitting(list, { first: "dont" }), ["don't"]);
  assert.deepEqual(fitting(list, { first: "dingd" }), ["ding-dong"]);
  assert.deepEqual(fitting(list, { first: "ichb" }), ["Ich bin"]);
  assert.deepEqual(fitting(list, { last: "c123" }), ["abc123"]);
});

test("with exact lengths, entries fit the next length, and phrases the next few", () => {
  const seq = sequenceFor("custom", "3 5 2");
  const list = ["cat", "horse", "ice cream", "big horse", "big ox", "ox", "horse ox"];
  assert.deepEqual(fitting(list, { rest: restOf(seq, 0) }), ["cat", "ice cream", "big horse"]);
  assert.deepEqual(fitting(list, { rest: restOf(seq, 1) }), ["horse", "horse ox"]);
  assert.deepEqual(fitting(list, { rest: restOf(seq, 2) }), ["ox"]);
  assert.deepEqual(fitting(list, { rest: restOf(seq, 3) }), []);
});

test("with digits, 0 means ten letters and longer words take two digits", () => {
  const seq = sequenceFor("custom", "1.0412");
  const list = ["a", "absolutely", "five", "cats", "extraordinary", "be", "a cats", "abcdefghijkl"];
  // 1 0 4 1 2: "a" for the 1, then "absolutely" for the 0, then a 4-letter word
  assert.deepEqual(fitting(list, { rest: restOf(seq, 0) }), ["a"]);
  assert.deepEqual(fitting(list, { rest: restOf(seq, 1) }), ["absolutely"]);
  assert.deepEqual(fitting(list, { rest: restOf(seq, 2) }), ["five", "cats"]);
  // a 1 followed by 2 can be a one-letter word or a twelve-letter one
  assert.deepEqual(fitting(list, { rest: restOf(seq, 3) }), ["a", "abcdefghijkl"]);
});

test("the place to fill is where the text first goes wrong, or after its last word", () => {
  const seq = sequenceFor("pi", "");
  assert.equal(check(findWords("How I needs"), seq).used, 2);
  assert.equal(check(findWords("How I"), seq).used, 2);
  assert.deepEqual(fitting(["want", "drinks"], { rest: restOf(seq, 2) }), ["want"]);
  assert.deepEqual(fitting(["want", "drinks"], { rest: restOf(seq, 2), avoided: ["a"] }), []);
});

test("the next word's possible lengths", () => {
  const digits = sequenceFor("custom", "1.40217");
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((used) => nextLengths(restOf(digits, used))), [[1, 14], [4, 40], [10], [2, 21], [1, 17], [7]]);
  assert.deepEqual(nextLengths(restOf(digits, 6)), []);
  // 1 then 0 is just 1: ten letters stand for 0
  assert.deepEqual(nextLengths(restOf(sequenceFor("custom", "10"), 0)), [1]);
  const lengths = sequenceFor("custom", "3 14");
  assert.deepEqual([0, 1, 2].map((used) => nextLengths(restOf(lengths, used))), [[3], [14], []]);
});
