// Character class shorthands. \d \w \s have PCRE's default (ASCII) meanings: \d is [0-9],
// \w is [A-Za-z0-9_] and \s is [\t\n\v\f\r ]. \p{...} is a Unicode property, taking any
// name JavaScript accepts, such as \p{L}, \p{Lu} or \p{Script=Greek}. The uppercase forms
// (\D \W \S \P{...}) are the complements.

import { CharSet, MAX_CP } from "./charset.js";

const range = (lo, hi) => [lo.codePointAt(0), hi.codePointAt(0)];
const SETS = {
  d: CharSet.from([range("0", "9")]),
  w: CharSet.from([range("a", "z"), range("A", "Z"), range("0", "9"), range("_", "_")]),
  s: CharSet.from([[0x09, 0x0d], range(" ", " ")]),
};

// is this a property name JavaScript accepts?
export function isProperty(name) {
  try {
    new RegExp(`\\p{${name}}`, "u");
    return true;
  } catch {
    return false;
  }
}

const properties = new Map();

// the characters a shorthand { name, negated, property } matches
export function shorthandSet({ name, negated, property }) {
  let set = SETS[name];
  if (name === "p") {
    if (!properties.has(property)) properties.set(property, setFromRegex(new RegExp(`\\p{${property}}`, "u")));
    set = properties.get(property);
  }
  return negated ? set.complement() : set;
}

// The set of code points a single-character regex matches, found by testing each one. Whole
// blocks are checked first, since most are entirely in or entirely out.
const BLOCK = 256;
function setFromRegex(re) {
  const all = new RegExp(`^(?:${re.source})+$`, "u");
  const ranges = [];
  for (let lo = 0; lo <= MAX_CP; lo += BLOCK) {
    const cps = [];
    for (let cp = lo; cp < lo + BLOCK && cp <= MAX_CP; cp++) if (cp < 0xd800 || cp > 0xdfff) cps.push(cp);
    if (cps.length === 0) continue;
    const block = String.fromCodePoint(...cps);
    if (!re.test(block)) continue;
    if (all.test(block)) ranges.push([lo, Math.min(lo + BLOCK - 1, MAX_CP)]);
    else for (const cp of cps) if (re.test(String.fromCodePoint(cp))) ranges.push([cp, cp]);
  }
  return CharSet.from(ranges);
}

export function formatShorthand({ name, negated, property }) {
  if (name === "p") return `\\${negated ? "P" : "p"}{${property}}`;
  return `\\${negated ? name.toUpperCase() : name}`;
}
