// Anagrams: (?a:A) matches the rearrangements of the strings in A, which must be finite (the
// anagrams of an infinite language usually aren't regular: those of (ab)* have as many a's
// as b's).
//
// The characters A uses are first split into disjoint groups (see partition), so that every
// edge label is a union of groups. A string's letter counts are then its number of
// characters in each group. This is exact, without listing A's strings one by one: each
// edge reads any one character of its label, independently of the others, so a string is
// an anagram of a string of A exactly when its counts are those of some path through A.
//
// The result is a DFA whose states are counts, starting from all zeros: reading a character
// adds one to its group's count, as long as that stays within the counts of some string of
// A, and the accepting states are the counts of A's strings themselves. For a single word,
// that's the product of (count + 1) over its letters, such as 64 states for "listen".

import { partition } from "./charset.js";
import { Builder, TooManyStatesError, removeEpsilons } from "./nfa.js";

// Returns the anagrams' DFA, or null if A is infinite.
export function anagram(a) {
  const g = removeEpsilons(a); // also trimmed, so any cycle is on an accepting path
  if (hasCycle(g)) return null;
  const labels = [...new Set(g.edges.flat().map((e) => e.label))];
  const groups = partition(labels);
  // the groups making up each label
  const groupsOf = new Map(labels.map((label) => [label, []]));
  groups.forEach(({ members }, k) => {
    for (const i of members) groupsOf.get(labels[i]).push(k);
  });
  const limit = new Builder().limit;
  const key = (counts) => counts.join(",");

  // the counts of A's strings: every (state, counts) pair reachable from the start
  const targets = new Map(); // key → counts
  const seen = new Set();
  const stack = [[g.start, groups.map(() => 0)]];
  while (stack.length) {
    const [s, counts] = stack.pop();
    const k = `${s}:${key(counts)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > limit) throw new TooManyStatesError(limit);
    if (g.accepting.has(s)) targets.set(key(counts), counts);
    for (const { label, to } of g.edges[s]) {
      for (const group of groupsOf.get(label)) {
        const next = [...counts];
        next[group]++;
        stack.push([to, next]);
      }
    }
  }

  // the DFA's states: all counts within some target's
  const states = new Map(); // key → id
  const list = [];
  const b = new Builder();
  const add = (counts) => {
    const k = key(counts);
    if (states.has(k)) return false;
    states.set(k, b.state());
    list.push(counts);
    return true;
  };
  for (const target of targets.values()) {
    // every count vector below the target, found by lowering one count at a time
    const pending = [target];
    while (pending.length) {
      const counts = pending.pop();
      if (!add(counts)) continue;
      counts.forEach((n, group) => {
        if (n > 0) pending.push(counts.map((m, j) => (j === group ? m - 1 : m)));
      });
    }
  }
  if (targets.size === 0) return b.build(b.state(), []);
  list.forEach((counts, id) => {
    counts.forEach((n, group) => {
      const next = states.get(key(counts.map((m, j) => (j === group ? m + 1 : m))));
      if (next !== undefined) b.edge(id, groups[group].set, next);
    });
  });
  const zero = states.get(key(groups.map(() => 0)));
  return b.build(zero, [...targets.keys()].map((k) => states.get(k)));
}

function hasCycle(g) {
  // iterative depth-first search: 1 while on the stack, 2 when finished
  const mark = new Uint8Array(g.size);
  for (let root = 0; root < g.size; root++) {
    if (mark[root]) continue;
    const stack = [[root, 0]];
    mark[root] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [s, i] = top;
      if (i === g.edges[s].length) {
        mark[s] = 2;
        stack.pop();
        continue;
      }
      top[1]++;
      const to = g.edges[s][i].to;
      if (mark[to] === 1) return true;
      if (mark[to] === 0) {
        mark[to] = 1;
        stack.push([to, 0]);
      }
    }
  }
  return false;
}
