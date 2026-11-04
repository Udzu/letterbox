// Character class shorthands \d \w \s, with PCRE's default (ASCII) meanings: \d is [0-9],
// \w is [A-Za-z0-9_] and \s is [\t\n\v\f\r ]. The uppercase forms (\D \W \S) are the
// complements.

import { CharSet } from "./charset.js";

const range = (lo, hi) => [lo.codePointAt(0), hi.codePointAt(0)];
const SETS = {
  d: CharSet.from([range("0", "9")]),
  w: CharSet.from([range("a", "z"), range("A", "Z"), range("0", "9"), range("_", "_")]),
  s: CharSet.from([[0x09, 0x0d], range(" ", " ")]),
};

// the characters a shorthand { name, negated } matches
export function shorthandSet({ name, negated }) {
  return negated ? SETS[name].complement() : SETS[name];
}

export function formatShorthand({ name, negated }) {
  return `\\${negated ? name.toUpperCase() : name}`;
}
