// Shortest and longest match lengths, read directly off the NFA without ε-moves.
//
// That NFA is trimmed, so every state lies on some accepting path and every edge reads one
// character. The shortest match is then a breadth-first search from the start, and the
// longest is unbounded exactly when there's a cycle, and otherwise the longest path.

import { removeEpsilons } from "./nfa.js";

// Returns { min, max }: both null if nothing matches, and max Infinity if unbounded.
export function matchLengths(nfa) {
  const g = removeEpsilons(nfa);
  if (g.accepting.size === 0) return { min: null, max: null };
  return { min: shortest(g), max: longest(g) };
}

function shortest(g) {
  const depth = new Map([[g.start, 0]]);
  const queue = [g.start];
  for (let i = 0; i < queue.length; i++) {
    const s = queue[i];
    if (g.accepting.has(s)) return depth.get(s);
    for (const { to } of g.edges[s]) {
      if (!depth.has(to)) {
        depth.set(to, depth.get(s) + 1);
        queue.push(to);
      }
    }
  }
  return null; // unreachable for a trimmed NFA with an accepting state
}

// depth-first search for a topological order, giving up on finding a cycle
function longest(g) {
  const UNSEEN = 0, ACTIVE = 1, DONE = 2;
  const state = new Array(g.size).fill(UNSEEN);
  const order = []; // states in reverse topological order
  const stack = [[g.start, 0]];
  state[g.start] = ACTIVE;
  while (stack.length) {
    const top = stack[stack.length - 1];
    const [s, i] = top;
    if (i === g.edges[s].length) {
      state[s] = DONE;
      order.push(s);
      stack.pop();
      continue;
    }
    top[1]++;
    const to = g.edges[s][i].to;
    if (state[to] === ACTIVE) return Infinity;
    if (state[to] === UNSEEN) {
      state[to] = ACTIVE;
      stack.push([to, 0]);
    }
  }
  // longest path from each state to the end of an accepting path
  const best = new Array(g.size).fill(-Infinity);
  for (const s of order) {
    if (g.accepting.has(s)) best[s] = 0;
    for (const { to } of g.edges[s]) best[s] = Math.max(best[s], best[to] + 1);
  }
  return best[g.start];
}

// a short description for the page, e.g. "Match lengths: 3 to 8"
export function describeLengths({ min, max }) {
  if (min === null) return "Nothing matches";
  if (max === 0) return "Only the empty string matches";
  if (min === max) return `Match length: ${min}`;
  if (max === Infinity) return `Match lengths: ${min} or more`;
  return `Match lengths: ${min} to ${max}`;
}
