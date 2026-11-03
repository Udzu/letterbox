import { test } from "node:test";
import assert from "node:assert/strict";
import { compile } from "../src/patterns/index.js";
import { compile as compileAst } from "../src/patterns/compile.js";
import { matches } from "../src/patterns/nfa.js";
import { describeLengths, matchLengths } from "../src/patterns/lengths.js";
import { randomAst, seededRandom } from "./helpers.js";

const CASES = [
  // [pattern, min, max]
  ["", 0, 0],
  ["a", 1, 1],
  ["[]", null, null],
  ["a&b", null, null],
  ["abc|de", 2, 3],
  ["a*", 0, Infinity],
  ["a+b?", 1, Infinity],
  ["a{2,5}", 2, 5],
  ["(ab){0,3}c", 1, 7],
  ["(a|bc)*d", 1, Infinity],
  ["!a", 0, Infinity],
  ["!.*", null, null],
  ["a*&.{2,4}", 2, 4],
  ["o+<l+", 2, Infinity],
  ["the>^A+", 4, Infinity],
  ["(the|a)-.", 0, 2],
  ["lo+l->o+", 2, Infinity],
  ["[a-z]{1000}", 1000, 1000],
  ["(a|b)*a(a|b){10}", 11, Infinity],
];

for (const [pattern, min, max] of CASES) {
  test(`lengths ${JSON.stringify(pattern)}`, () => {
    assert.deepEqual(matchLengths(compile(pattern)), { min, max });
  });
}

// all strings over the alphabet of exactly the given length
function stringsOfLength(alphabet, n) {
  let level = [""];
  for (let i = 0; i < n; i++) level = level.flatMap((s) => alphabet.map((c) => s + c));
  return level;
}

test("lengths agree with brute force", () => {
  // for patterns using only a and b, every other character behaves like c, so checking
  // every string over {a, b, c} of a given length tells us exactly whether any match has it
  const rand = seededRandom(41);
  const N = 6;
  const levels = Array.from({ length: N + 1 }, (_, n) => stringsOfLength(["a", "b", "c"], n));
  for (let i = 0; i < 300; i++) {
    const nfa = compileAst(randomAst(rand, 3, { chars: ["a", "b"] }));
    const { min, max } = matchLengths(nfa);
    const found = levels.flatMap((level, n) => (level.some((s) => matches(nfa, s)) ? [n] : []));
    if (found.length) assert.equal(min, found[0]);
    else assert.ok(min === null || min > N);
    for (const n of found) assert.ok(n <= max);
    if (max !== Infinity && max !== null && max <= N) assert.equal(found.at(-1), max);
  }
});

test("describeLengths", () => {
  assert.equal(describeLengths({ min: null, max: null }), "Nothing matches");
  assert.equal(describeLengths({ min: 0, max: 0 }), "Only the empty string matches");
  assert.equal(describeLengths({ min: 5, max: 5 }), "Match length: 5");
  assert.equal(describeLengths({ min: 3, max: 8 }), "Match lengths: 3 to 8");
  assert.equal(describeLengths({ min: 0, max: Infinity }), "Match lengths: 0 or more");
});
