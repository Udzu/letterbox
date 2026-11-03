// Rotation: the strings vu for which uv is in A, with conditions on the lengths of u and v.
//
// (?R2:A) rotates right by 2: |v| = 2 and u isn't empty, so "abc" becomes "bca". (?R-2:A)
// rotates left by 2: |u| = 2 and v isn't empty. (?R:A) is any rotation with both non-empty.
// Rotation isn't modular, so a string too short for the rotation doesn't match at all.
//
// The construction guesses the state m that A reaches after reading u, then reads v from m
// to an accepting state, then u from A's start back to m, counting characters as it goes.
// So its states are (m, q, phase, count), created only as they're reached.

import { Builder } from "./nfa.js";

// a length condition: exactly n characters, or at least n (counting saturates at n)
export const exactly = (n) => ({ n, exact: true });
export const atLeast = (n) => ({ n, exact: false });

// `a` must have no ε-moves
export function rotate(a, vLength, uLength) {
  const builder = new Builder();
  const ids = new Map();
  const states = [];
  const id = (m, q, phase, k) => {
    const key = `${m},${q},${phase},${k}`;
    if (!ids.has(key)) {
      ids.set(key, builder.state());
      states.push([m, q, phase, k]);
    }
    return ids.get(key);
  };
  const start = builder.state();
  for (let m = 0; m < a.size; m++) builder.edge(start, null, id(m, m, 0, 0));
  const accepting = [];
  // states are numbered in the order they're created, after the start state
  for (let i = 0; i < states.length; i++) {
    const [m, q, phase, k] = states[i];
    const length = phase === 0 ? vLength : uLength;
    const next = k < length.n ? k + 1 : length.exact ? null : k;
    if (next !== null) {
      for (const e of a.edges[q]) builder.edge(i + 1, e.label, id(m, e.to, phase, next));
    }
    if (k === length.n) {
      // phase 0 has read v and reached the end of uv; phase 1 has read u and is back at m
      if (phase === 0 && a.accepting.has(q)) builder.edge(i + 1, null, id(m, a.start, 1, 0));
      if (phase === 1 && q === m) accepting.push(i + 1);
    }
  }
  return builder.build(start, accepting);
}
