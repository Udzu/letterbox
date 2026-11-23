import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, distances, entryInfo, fewerLength, isStep, keysOf, ladderWords, makePuzzle, shortestLadder, stepError } from "../src/ladders/game.js";

const infos = (words) => words.map(entryInfo);
const rules = { length: 4, capitals: false, phrases: false };

test("filters capitals and phrases, for puzzles and steps alike", () => {
  const list = infos(["cold", "Cold", "Rome", "a lot", "x-ray", "warm"]);
  assert.deepEqual([...keysOf(list, rules, 4)], [["COLD", ["cold"]], ["WARM", ["warm"]]]);
  assert.deepEqual([...keysOf(list, { ...rules, capitals: true }, 4).keys()], ["COLD", "ROME", "WARM"]);
  assert.deepEqual([...keysOf(list, { ...rules, phrases: true }, 4).keys()], ["COLD", "ALOT", "XRAY", "WARM"]);
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
