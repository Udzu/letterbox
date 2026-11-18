import { test } from "node:test";
import assert from "node:assert/strict";
import { entryInfo, keyOf, keysOf, letters, lockError, possible, puzzleWords, score } from "../src/words/game.js";

test("folds accents and special letters, dropping non-letters", () => {
  assert.equal(letters("fiancée"), "FIANCEE");
  assert.equal(letters("a lot"), "ALOT");
  assert.equal(letters("Øresund"), "ORESUND");
  assert.equal(letters("Straße"), "STRASSE");
  assert.equal(letters("O'Neill"), "ONEILL");
});

test("keeps entries of the right length, and phrases only if allowed", () => {
  const five = { length: 5, phrases: false };
  assert.equal(keyOf("crane", five), "CRANE");
  assert.equal(keyOf("Crêpe", five), "CREPE");
  assert.equal(keyOf("cranes", five), null);
  assert.equal(keyOf("a lot", { length: 4, phrases: false }), null);
  assert.equal(keyOf("a lot", { length: 4, phrases: true }), "ALOT");
  assert.equal(keyOf("x-ray", { length: 4, phrases: false }), null);
  assert.equal(keyOf("x-ray", { length: 4, phrases: true }), "XRAY");
  assert.equal(keyOf("γάμμα", five), null); // not A–Z
  assert.deepEqual([...keysOf(["moon", "Moon", "mood"].map(entryInfo), { length: 4, phrases: false })], [["MOON", ["moon", "Moon"]], ["MOOD", ["mood"]]]);
});

test("answers come from the @ list, guesses from both", () => {
  const s = { length: 4, phrases: false };
  const { answers, guesses } = puzzleWords(["able", "bake", "cake"].map(entryInfo), ["cake", "lake"].map(entryInfo), s);
  assert.deepEqual([...answers.keys()], ["CAKE", "LAKE"]);
  assert.deepEqual([...guesses].sort(), ["ABLE", "BAKE", "CAKE", "LAKE"]);
  const unique = puzzleWords(["able", "bake", "cake", "deed"].map(entryInfo), null, { ...s, duplicates: false });
  assert.deepEqual([...unique.answers.keys()], ["ABLE", "BAKE", "CAKE"]);
  assert.ok(unique.guesses.has("DEED"));
  const lower = puzzleWords(["moon", "Moon", "Elena", "NASA", "able"].map(entryInfo), null, { ...s, capitals: false });
  assert.deepEqual([...lower.answers], [["MOON", ["moon"]], ["ABLE", ["able"]]]);
  assert.ok(lower.guesses.has("NASA"));
  const only = puzzleWords(["able", "bake"].map(entryInfo), null, s);
  assert.deepEqual([...only.answers.keys()], ["ABLE", "BAKE"]);
});

test("scores repeated letters as in Wordle", () => {
  assert.equal(score("CRANE", "CRANE"), "ggggg");
  assert.equal(score("EERIE", "ANCEE"), "y...g");
  assert.equal(score("SPEED", "ABIDE"), "..y.y");
  assert.equal(score("EEXXE", "XEEEX"), "ygyyy");
  assert.equal(score("LLAMA", "HELLO"), "yy...");
});

test("checks locked greens and yellows", () => {
  const history = [{ guess: "CRANE", colours: score("CRANE", "CHEER") }]; // gy..y
  const greens = { lockGreens: true, lockYellows: false };
  const yellows = { lockGreens: false, lockYellows: true };
  const both = { lockGreens: true, lockYellows: true };
  assert.equal(lockError("BLOKE", history, greens), "The 1st letter must be C");
  assert.equal(lockError("CLOTH", history, greens), null);
  assert.equal(lockError("CLOTH", history, yellows), "The guess must use R");
  assert.equal(lockError("ROGER", history, yellows), null); // yellows may stay where they were
  assert.equal(lockError("BREED", history, both), "The 1st letter must be C");
  // two Es seen: a yellow and a green, both needed when both are locked
  const h2 = [{ guess: "EERIE", colours: score("EERIE", "CHEER") }];
  assert.equal(h2[0].colours, "yyy.."); // two Es and the R are elsewhere
  assert.equal(lockError("THREE", h2, yellows), null);
  assert.equal(lockError("THROW", h2, yellows), "The guess must use E twice");
});

test("finds the answers that fit", () => {
  const answers = ["CHEER", "CHEAP", "CLEAR", "SHEER"];
  const history = [{ guess: "CRANE", colours: score("CRANE", "CHEER") }];
  assert.deepEqual(possible(answers, history), ["CHEER"]);
  assert.deepEqual(possible(answers, []), answers);
});
