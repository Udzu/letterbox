import { test } from "node:test";
import assert from "node:assert/strict";
import { CharSet, MAX_CP, partition } from "../src/patterns/charset.js";
import { seededRandom } from "./helpers.js";

const ranges = (s) => s.ranges.map(([lo, hi]) => [lo, hi]);

test("from normalises ranges", () => {
  assert.deepEqual(ranges(CharSet.from([[5, 7], [1, 2], [3, 3], [10, 12], [11, 20], [30, 29]])), [[1, 3], [5, 7], [10, 20]]);
  assert.deepEqual(ranges(CharSet.of(3, 1, 2, 9)), [[1, 3], [9, 9]]);
});

test("complement", () => {
  assert.ok(CharSet.EMPTY.complement().isAll());
  assert.ok(CharSet.ALL.complement().isEmpty());
  assert.deepEqual(ranges(CharSet.of(0, 5, MAX_CP).complement()), [[1, 4], [6, MAX_CP - 1]]);
});

// random sets over a small universe, checked against brute-force membership
const U = 40;
function randomSet(rand) {
  return CharSet.from(Array.from({ length: Math.floor(rand() * 4) }, () => {
    const lo = Math.floor(rand() * U);
    return [lo, lo + Math.floor(rand() * 6)];
  }));
}
const points = [...Array(U + 8).keys(), MAX_CP - 1, MAX_CP];

test("set operations agree with membership", () => {
  const rand = seededRandom(7);
  for (let i = 0; i < 500; i++) {
    const a = randomSet(rand);
    const b = randomSet(rand);
    for (const cp of points) {
      assert.equal(a.union(b).has(cp), a.has(cp) || b.has(cp));
      assert.equal(a.intersect(b).has(cp), a.has(cp) && b.has(cp));
      assert.equal(a.minus(b).has(cp), a.has(cp) && !b.has(cp));
      assert.equal(a.complement().has(cp), !a.has(cp));
    }
    assert.ok(a.complement().complement().equals(a));
    assert.equal(a.isSubsetOf(b), points.every((cp) => !a.has(cp) || b.has(cp)));
    assert.equal(a.size(), [...Array(U + 8).keys()].filter((cp) => a.has(cp)).length);
  }
});

test("partition splits sets into disjoint pieces", () => {
  const rand = seededRandom(11);
  for (let i = 0; i < 300; i++) {
    const sets = Array.from({ length: 1 + Math.floor(rand() * 4) }, () => randomSet(rand));
    const pieces = partition(sets);
    for (const cp of points) {
      const containing = pieces.filter((p) => p.set.has(cp));
      const expected = sets.flatMap((s, j) => (s.has(cp) ? [j] : []));
      if (expected.length === 0) assert.equal(containing.length, 0);
      else {
        assert.equal(containing.length, 1);
        assert.deepEqual(containing[0].members, expected);
      }
    }
    // pieces with the same members are merged
    assert.equal(new Set(pieces.map((p) => p.members.join())).size, pieces.length);
  }
});
