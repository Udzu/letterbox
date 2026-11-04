// Transposition: (?tn:A) matches the strings x b m a y for which x a m b y is in A, where a
// and b are single characters and m has n - 1 characters, so (?t1:A) swaps two adjacent
// characters. (?t:A) swaps two characters any distance apart. Swapping two equal
// characters gives A's own string.
//
// The construction reads x with A. At the first swapped position the string has b, but A
// must read a, which only comes later in the string, so it guesses a and remembers what
// it still owes: the string must later have a, and A must later read b. It then reads m
// with A (counting characters if n is given), checks the second swapped position, and reads
// y with A. States are created only as they're reached.
//
// The guesses are over groups of characters rather than characters: A's labels are split
// into disjoint groups (see partition), and A can't tell apart two characters in the same
// group, so it's enough to know which group a and b are in.

import { partition } from "./charset.js";
import { Builder, trim } from "./nfa.js";

// `a` must have no ε-moves; distance is n, or null for any
export function transpose(a, distance) {
  const labels = [...new Set(a.edges.flat().map((e) => e.label))];
  const groups = partition(labels);
  const groupsOf = new Map(labels.map((label) => [label, []]));
  groups.forEach(({ members }, k) => {
    for (const i of members) groupsOf.get(labels[i]).push(k);
  });
  // the groups A can read from each state: next, for adjacent swaps, or at any point later
  const next = a.edges.map((es) => new Set(es.flatMap((e) => groupsOf.get(e.label))));
  const owed = distance === 1 ? next : later(a, next);

  const builder = new Builder();
  const ids = new Map();
  const states = [];
  // phases: "x" (p), "m" (p, a's group, b's group, characters of m so far), "y" (p)
  const id = (...state) => {
    const key = state.join(",");
    if (!ids.has(key)) {
      ids.set(key, builder.state());
      states.push(state);
    }
    return ids.get(key);
  };
  const start = id("x", a.start);
  const accepting = [];
  for (let i = 0; i < states.length; i++) {
    const [phase, p, ga, gb, k] = states[i];
    switch (phase) {
      case "x":
        for (const { label, to } of a.edges[p]) {
          builder.edge(i, label, id("x", to));
          // swap: A reads a (in group g), while the string has some b that A reads later
          for (const g of groupsOf.get(label)) {
            for (const h of owed[to]) builder.edge(i, groups[h].set, id("m", to, g, h, 0));
          }
        }
        break;
      case "m": {
        const end = distance === null || k === distance - 1;
        for (const { label, to } of a.edges[p]) {
          if (distance === null || k < distance - 1) builder.edge(i, label, id("m", to, ga, gb, distance === null ? 0 : k + 1));
          // the second swapped position: the string has a, and A reads b
          if (end && groupsOf.get(label).includes(gb)) builder.edge(i, groups[ga].set, id("y", to));
        }
        break;
      }
      case "y":
        for (const { label, to } of a.edges[p]) builder.edge(i, label, id("y", to));
        if (a.accepting.has(p)) accepting.push(i);
        break;
    }
  }
  return trim(builder.build(start, accepting));
}

// the groups readable from each state at some point (now or later), as a fixed point
function later(a, next) {
  const out = next.map((s) => new Set(s));
  for (let changed = true; changed;) {
    changed = false;
    for (let s = a.size - 1; s >= 0; s--) {
      for (const { to } of a.edges[s]) {
        for (const g of out[to]) {
          if (!out[s].has(g)) {
            out[s].add(g);
            changed = true;
          }
        }
      }
    }
  }
  return out;
}
