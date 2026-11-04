// Character set transformations for the case-insensitive and cipher shift modifiers.

import { CharSet } from "./charset.js";

// Case-insensitive matching uses the same rule as JavaScript's iu regex flags: Unicode
// simple case folding, where two characters match if they fold to the same character. So
// k, K and the Kelvin sign K all match each other, but changes of length like ß and SS
// don't. The equivalence classes are found by linking each character to its single
// character upper and lower case forms, then splitting those groups with a real iu regex
// (which tells apart, for example, dotless ı from i and I, which case folding keeps apart).
// Only code points below this have case.
const CASED_LIMIT = 0x20000;
const BLOCK = 128;
const HAS_CASE = /\p{Changes_When_Casemapped}/u;

let caseTable = null; // { cased: sorted code points with a class of 2+, classOf: Map cp → class }

function buildCaseTable() {
  const parent = new Map();
  const find = (x) => {
    while (parent.has(x) && parent.get(x) !== x) x = parent.get(x);
    return x;
  };
  const link = (x, y) => {
    if (!parent.has(x)) parent.set(x, x);
    if (!parent.has(y)) parent.set(y, y);
    const [rx, ry] = [find(x), find(y)];
    if (rx !== ry) parent.set(Math.max(rx, ry), Math.min(rx, ry));
  };
  // most blocks have no case at all, and checking a whole block at once is quicker
  for (let lo = 0; lo < CASED_LIMIT; lo += BLOCK) {
    const cps = [];
    for (let cp = lo; cp < lo + BLOCK; cp++) if (cp < 0xd800 || cp > 0xdfff) cps.push(cp);
    if (cps.length === 0 || !HAS_CASE.test(String.fromCodePoint(...cps))) continue;
    for (const cp of cps) {
      const c = String.fromCodePoint(cp);
      for (const other of [c.toLowerCase(), c.toUpperCase()]) {
        const ocp = other.codePointAt(0);
        if (other !== c && other.length === String.fromCodePoint(ocp).length) link(cp, ocp);
      }
    }
  }
  const groups = new Map();
  for (const cp of parent.keys()) {
    const root = find(cp);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(cp);
  }
  const classOf = new Map();
  for (let members of groups.values()) {
    while (members.length) {
      const re = new RegExp(`^\\u{${members[0].toString(16)}}$`, "iu");
      const same = members.filter((cp) => re.test(String.fromCodePoint(cp)));
      members = members.filter((cp) => !re.test(String.fromCodePoint(cp)));
      if (same.length > 1) for (const cp of same) classOf.set(cp, same);
    }
  }
  return { cased: [...classOf.keys()].sort((x, y) => x - y), classOf };
}

// the characters that match some character of the set case-insensitively
export function caseClose(set) {
  caseTable ??= buildCaseTable();
  const { cased, classOf } = caseTable;
  const extra = [];
  for (const [lo, hi] of set.ranges) {
    for (let i = lowerBound(cased, lo); i < cased.length && cased[i] <= hi; i++) {
      for (const cp of classOf.get(cased[i])) extra.push([cp, cp]);
    }
  }
  return extra.length ? set.union(CharSet.from(extra)) : set;
}

// for tests: the case-insensitive class of a character, including itself
export function caseClass(cp) {
  caseTable ??= buildCaseTable();
  return caseTable.classOf.get(cp) ?? [cp];
}

// Shift ASCII letters n places along the alphabet, keeping their case and wrapping round,
// as in a Caesar cipher. Other characters are unchanged.
const ALPHABETS = ["a", "A"].map((c) => c.codePointAt(0));

export function shiftSet(set, n) {
  const shift = ((n % 26) + 26) % 26;
  if (shift === 0) return set;
  let out = set;
  for (const base of ALPHABETS) {
    const letters = CharSet.from([[base, base + 25]]);
    const shifted = [];
    for (const [lo, hi] of set.intersect(letters).ranges) {
      const [a, b] = [lo - base + shift, hi - base + shift];
      // a range can wrap round past z
      if (b < 26) shifted.push([base + a, base + b]);
      else if (a >= 26) shifted.push([base + a - 26, base + b - 26]);
      else shifted.push([base + a, base + 25], [base, base + b - 26]);
    }
    out = out.minus(letters).union(CharSet.from(shifted));
  }
  return out;
}

// Atbash: ASCII letters reflected in the alphabet, keeping their case, so a and z swap, b
// and y, and so on. Other characters are unchanged.
export function mirrorSet(set) {
  let out = set;
  for (const base of ALPHABETS) {
    const letters = CharSet.from([[base, base + 25]]);
    const mirrored = set.intersect(letters).ranges.map(([lo, hi]) => [2 * base + 25 - hi, 2 * base + 25 - lo]);
    out = out.minus(letters).union(CharSet.from(mirrored));
  }
  return out;
}

function lowerBound(xs, x) {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
