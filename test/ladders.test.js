import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, changedPositions, distances, entryInfo, fewerLength, hint, isStep, keysOf, ladderWords, lengthRange, makePuzzle, neighbours, shortestLadder, stepError, stepKind } from "../src/ladders/game.js";

const infos = (words) => words.map(entryInfo);
const rules = { length: 4, capitals: false, phrases: false };

test("filters capitals and phrases, for puzzles and steps alike", () => {
  const list = infos(["cold", "Cold", "Rome", "a lot", "x-ray", "warm"]);
  assert.deepEqual([...keysOf(list, rules, [4, 4])], [["COLD", ["cold"]], ["WARM", ["warm"]]]);
  assert.deepEqual([...keysOf(list, { ...rules, capitals: true }, [4, 4]).keys()], ["COLD", "ROME", "WARM"]);
  assert.deepEqual([...keysOf(list, { ...rules, phrases: true }, [4, 4]).keys()], ["COLD", "ALOT", "XRAY", "WARM"]);
});

test("puzzles come from the @ list, steps from either list", () => {
  const { pool, allowed } = ladderWords(infos(["cold", "cord", "card"]), infos(["cold", "ward", "warm"]), rules);
  assert.deepEqual([...pool.keys()], ["COLD", "WARD", "WARM"]);
  assert.deepEqual([...allowed].sort(), ["CARD", "COLD", "CORD", "WARD", "WARM"]);
  const noAt = ladderWords(infos(["cold", "cord"]), null, rules);
  assert.deepEqual([...noAt.pool.keys()], ["COLD", "CORD"]);
});

test("a step changes exactly one letter", () => {
  assert.equal(isStep("COLD", "CORD"), true);
  assert.equal(isStep("COLD", "COLD"), false);
  assert.equal(isStep("COLD", "CARD"), false);
  assert.equal(isStep("COLD", "COLDS"), false);
  assert.equal(stepError("COLD", "CORD"), null);
  assert.equal(stepError("COLD", "COLD"), "Change a letter");
  assert.equal(stepError("COLD", "WARD"), "Change only one letter, not 3");
});

const LADDER = ["COLD", "CORD", "CARD", "WARD", "WARM"];

test("finds shortest ladders", () => {
  const graph = buildGraph([...LADDER, "WORD", "XYZW"]);
  // COLD → CORD → WORD → WARD → WARM is as short as the one through CARD
  assert.equal(shortestLadder(graph, "COLD", "WARM").length, 5);
  assert.deepEqual(shortestLadder(graph, "COLD", "CARD"), ["COLD", "CORD", "CARD"]);
  assert.equal(shortestLadder(graph, "COLD", "XYZW"), null);
  const { dist } = distances(graph, graph.index.get("COLD"));
  assert.equal(dist[graph.index.get("WARM")], 4);
  assert.equal(dist[graph.index.get("XYZW")], -1);
});

test("makes puzzles of the right length", () => {
  const graph = buildGraph(LADDER);
  for (let seed = 0; seed < 20; seed++) {
    let x = seed + 1;
    const random = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    const exact = makePuzzle(graph, { steps: 4, fewer: false }, random);
    assert.deepEqual([exact.start, exact.end].sort(), ["COLD", "WARM"]);
    assert.equal(exact.ladder.length, 5);
    const fewer = makePuzzle(graph, { steps: 3, fewer: true }, random);
    assert.ok(fewer.ladder.length >= 3 && fewer.ladder.length <= 4);
    assert.ok(fewer.ladder.every((w, i) => i === 0 || isStep(fewer.ladder[i - 1], w)));
  }
  assert.equal(makePuzzle(graph, { steps: 5, fewer: false }), null);
});

test("shorter puzzle lengths are each half as likely", () => {
  const counts = { 2: 0, 3: 0, 4: 0 };
  for (let i = 0; i < 700; i++) counts[fewerLength(4, () => (i + 0.5) / 700)]++;
  assert.deepEqual(counts, { 2: 100, 3: 200, 4: 400 });
  assert.equal(fewerLength(2, () => 0.99), 2);
});

test("swaps exchange any two letters, and letters can be added or removed", () => {
  assert.equal(stepKind("SALT", "SLAT"), "swap");
  assert.equal(stepKind("SALT", "TALS"), "swap");
  assert.equal(stepKind("SALT", "SLTA"), null);
  assert.equal(stepKind("SALT", "SALTS"), "add");
  assert.equal(stepKind("SALT", "SPALT"), "add");
  assert.equal(stepKind("SALT", "SAT"), "remove");
  assert.equal(stepKind("SALT", "SA"), null);
  assert.equal(stepKind("SALT", "SALE"), "change");
  assert.equal(isStep("SALT", "SLAT"), false);
  assert.equal(isStep("SALT", "SLAT", { swaps: true }), true);
  assert.equal(isStep("SALT", "SAT", { swaps: true }), false);
  assert.equal(isStep("SALT", "SAT", { addRemove: true }), true);
  assert.equal(stepError("SALT", "SLAT"), "Swapping letters isn't allowed");
  assert.equal(stepError("SALT", "SALTS"), "Adding and removing letters isn't allowed");
  assert.equal(stepError("SALT", "LATS", { swaps: true }), "Change one letter, or swap two");
  assert.equal(stepError("SALT", "SALTED", { addRemove: true }), "Add or remove only one letter");
  assert.equal(stepError("SALT", "TALES", { addRemove: true }), "Add or remove one letter, keeping the rest in order");
});

test("marks the letters a step changed or added", () => {
  assert.deepEqual(changedPositions("SALT", "SALE"), [3]);
  assert.deepEqual(changedPositions("SALT", "SLAT"), [1, 2]);
  assert.deepEqual(changedPositions("SALT", "SPALT"), [1]);
  assert.deepEqual(changedPositions("SALT", "SALLT"), [3]);
  assert.deepEqual(changedPositions("SALT", "SAT"), []);
});

test("ladders can use other lengths when letters can be added and removed", () => {
  assert.deepEqual(lengthRange({ length: 4, addRemove: false }), [4, 4]);
  assert.deepEqual(lengthRange({ length: 4, addRemove: true }), [2, 6]);
  assert.deepEqual(lengthRange({ length: 2, addRemove: true }), [1, 4]);
  const { pool } = ladderWords(infos(["at", "cat", "cart", "carts", "carted", "cartels"]), null, { ...rules, addRemove: true });
  assert.deepEqual([...pool.keys()], ["AT", "CAT", "CART", "CARTS", "CARTED"]);
});

test("the graph and puzzles follow the moves allowed", () => {
  const words = ["SALT", "SLAT", "SLOT", "SLOTS", "LOTS", "SAT"];
  assert.equal(shortestLadder(buildGraph(words), "SALT", "SLOT"), null);
  assert.deepEqual(shortestLadder(buildGraph(words, { swaps: true }), "SALT", "SLOT"), ["SALT", "SLAT", "SLOT"]);
  const both = buildGraph(words, { swaps: true, addRemove: true });
  assert.deepEqual(shortestLadder(both, "SALT", "LOTS"), ["SALT", "SLAT", "SLOT", "SLOTS", "LOTS"]);
  assert.deepEqual(shortestLadder(both, "SAT", "SALT"), ["SAT", "SALT"]);
  // start and end words have the chosen length, though the ladder goes through others
  for (let seed = 1; seed < 20; seed++) {
    let x = seed;
    const random = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    const puzzle = makePuzzle(both, { steps: 2, fewer: false, length: 4 }, random);
    assert.equal(puzzle.start.length, 4);
    assert.equal(puzzle.end.length, 4);
    assert.equal(puzzle.ladder.length, 3);
  }
});

test("hints move towards the end, avoiding used words", () => {
  const graph = buildGraph(LADDER);
  const toEnd = distances(graph, graph.index.get("WARM"));
  assert.deepEqual(hint(graph, toEnd, "COLD", new Set(["COLD"]), {}), { word: "CORD", left: 3 });
  assert.equal(hint(graph, toEnd, "COLD", new Set(["COLD", "CORD"]), {}), null);
  // from a word outside the graph (only in the word list)
  assert.deepEqual(hint(graph, toEnd, "CARE", new Set(), {}), { word: "CARD", left: 2 });
  assert.deepEqual(neighbours("CAT", { addRemove: true }, (w) => ["AT", "CART", "COT", "CAT"].includes(w)).sort(), ["AT", "CART", "COT"]);
  assert.deepEqual(neighbours("SALT", { swaps: true }, (w) => w === "SLAT"), ["SLAT"]);
  assert.deepEqual(neighbours("SALT", {}, (w) => w === "SLAT"), []);
});
