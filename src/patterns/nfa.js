// Nondeterministic finite automata over Unicode code points.
//
// States are integers 0..size-1, with one start state and a set of accepting states.
// edges[s] lists the edges leaving s as { label, to }, where label is a CharSet, or null
// for an ε-move. Edges are independent: a character can follow any edge whose label
// contains it. NFAs are treated as immutable; operations return new ones.

import { CharSet, partition } from "./charset.js";

export const MAX_STATES = 50000;

// The limit that new automata use unless given one. It's raised while compiling a pattern
// that uses a word list, whose automaton alone can have tens of thousands of states.
let stateLimit = MAX_STATES;
// a limit for working with an existing automaton, allowing for its size
export function limitFor(nfa) {
  return Math.max(MAX_STATES, 4 * nfa.size);
}

export function withStateLimit(limit, f) {
  const previous = stateLimit;
  stateLimit = limit;
  try {
    return f();
  } finally {
    stateLimit = previous;
  }
}

export class TooManyStatesError extends Error {
  constructor(limit = stateLimit) {
    super(`The automaton needs more than ${limit} states`);
    this.name = "TooManyStatesError";
  }
}

// Automata known to be deterministic (no ε-moves, and disjoint labels on the edges leaving
// each state), so that determinising them again can be skipped. Only automata built to be
// deterministic are marked: determinize's results, the word list's automaton, and what
// trim and product make from marked ones.
const KNOWN_DFAS = new WeakSet();
export function markDeterministic(nfa) {
  KNOWN_DFAS.add(nfa);
  return nfa;
}

export class NFA {
  constructor(start, accepting, edges) {
    this.start = start;
    this.accepting = accepting;
    this.edges = edges;
  }

  get size() {
    return this.edges.length;
  }

  // true if there are no ε-moves and the edges leaving each state have disjoint labels
  isDeterministic() {
    return this.edges.every((es) =>
      es.every((e, i) => e.label !== null && es.slice(i + 1).every((f) => f.label.intersect(e.label).isEmpty())),
    );
  }
}

export class Builder {
  constructor(limit = stateLimit) {
    this.edges = [];
    this.limit = limit;
  }

  state() {
    if (this.edges.length >= this.limit) throw new TooManyStatesError(this.limit);
    this.edges.push([]);
    return this.edges.length - 1;
  }

  // label is a CharSet, or null for ε; edges with empty labels are dropped
  edge(from, label, to) {
    if (label !== null && label.isEmpty()) return;
    this.edges[from].push({ label, to });
  }

  // copy an NFA in, returning the new numbers of its start and accepting states
  embed(nfa) {
    const offset = this.edges.length;
    for (let i = 0; i < nfa.size; i++) this.state();
    nfa.edges.forEach((es, s) => {
      for (const { label, to } of es) this.edge(s + offset, label, to + offset);
    });
    return { start: nfa.start + offset, accepting: [...nfa.accepting].map((s) => s + offset) };
  }

  // parallel edges to the same state are merged into one, and duplicate ε-moves dropped
  build(start, accepting) {
    const edges = this.edges.map((es, s) => {
      if (es.length === 1) {
        const [{ label, to }] = es;
        return label === null && to === s ? [] : [Object.freeze({ label, to })];
      }
      // keys: to for labelled edges, -1 - to for ε-moves
      const merged = new Map();
      for (const { label, to } of es) {
        if (label === null && to === s) continue; // ε self-loops do nothing
        const key = label === null ? -1 - to : to;
        const existing = merged.get(key);
        if (!existing) merged.set(key, { label, to });
        else if (label !== null) existing.label = existing.label.union(label);
      }
      return [...merged.values()].map((e) => Object.freeze(e));
    });
    return new NFA(start, new Set(accepting), edges);
  }
}

// all states reachable from the given ones by ε-moves
export function closure(nfa, states) {
  const seen = new Set(states);
  const stack = [...seen];
  while (stack.length) {
    const s = stack.pop();
    for (const { label, to } of nfa.edges[s]) {
      if (label === null && !seen.has(to)) {
        seen.add(to);
        stack.push(to);
      }
    }
  }
  return seen;
}

// the states the NFA can be in after reading the string (by code point), including
// ε-moves; empty if it gets stuck
export function run(nfa, string) {
  let current = closure(nfa, [nfa.start]);
  for (const ch of string) {
    const cp = ch.codePointAt(0);
    const next = [];
    for (const s of current) {
      for (const { label, to } of nfa.edges[s]) if (label !== null && label.has(cp)) next.push(to);
    }
    if (next.length === 0) return new Set();
    current = closure(nfa, next);
  }
  return current;
}

// does the NFA accept the whole string?
export function matches(nfa, string) {
  for (const s of run(nfa, string)) if (nfa.accepting.has(s)) return true;
  return false;
}

// Remove states that can't be reached from the start or can't reach an accepting state.
// States are renumbered in breadth-first order from the start, which becomes 0.
export function trim(nfa) {
  const n = nfa.size;
  const reverse = nfa.edges.map(() => []);
  nfa.edges.forEach((es, s) => {
    for (const { to } of es) reverse[to].push(s);
  });
  const live = new Uint8Array(n);
  const stack = [...nfa.accepting];
  for (const s of stack) live[s] = 1;
  while (stack.length) {
    for (const s of reverse[stack.pop()]) {
      if (!live[s]) {
        live[s] = 1;
        stack.push(s);
      }
    }
  }
  const order = new Int32Array(n).fill(-1);
  order[nfa.start] = 0;
  const queue = [nfa.start];
  for (let i = 0; i < queue.length; i++) {
    for (const { to } of nfa.edges[queue[i]]) {
      if (live[to] && order[to] < 0) {
        order[to] = queue.length;
        queue.push(to);
      }
    }
  }
  const b = new Builder();
  for (let i = 0; i < queue.length; i++) b.state();
  for (const s of queue) {
    for (const { label, to } of nfa.edges[s]) if (order[to] >= 0) b.edge(order[s], label, order[to]);
  }
  const result = b.build(0, queue.filter((s) => nfa.accepting.has(s)).map((s) => order[s]));
  return KNOWN_DFAS.has(nfa) ? markDeterministic(result) : result;
}

// equivalent NFA with no ε-moves, remembered since several views of a pattern need it
const withoutEpsilons = new WeakMap();
export function removeEpsilons(nfa) {
  if (!withoutEpsilons.has(nfa)) withoutEpsilons.set(nfa, removeEpsilonsUncached(nfa));
  return withoutEpsilons.get(nfa);
}
function removeEpsilonsUncached(nfa) {
  const b = new Builder();
  for (let i = 0; i < nfa.size; i++) b.state();
  const accepting = [];
  for (let s = 0; s < nfa.size; s++) {
    const reach = closure(nfa, [s]);
    for (const t of reach) {
      if (nfa.accepting.has(t)) accepting.push(s);
      for (const { label, to } of nfa.edges[t]) if (label !== null) b.edge(s, label, to);
    }
  }
  return trim(b.build(nfa.start, accepting));
}

// Subset construction. With complete, every state has an edge for every character,
// adding a non-accepting "dead" state if needed (which complementing relies on).
// maxStates limits the DFA's size, throwing TooManyStatesError if it's exceeded
export function determinize(nfa, { complete = false, maxStates = stateLimit } = {}) {
  if (KNOWN_DFAS.has(nfa)) return complete ? completeDfa(nfa, maxStates) : nfa;
  const b = new Builder(maxStates);
  const ids = new Map();
  const sets = [];
  // states with only ε-moves contribute nothing beyond their closure, so leave them out of
  // state sets; otherwise e.g. a fresh start state makes the start set unique
  const matters = nfa.edges.map((es, s) => nfa.accepting.has(s) || es.some((e) => e.label !== null));
  // the ε-closure of some states, as the sorted states that matter, using stamps rather than
  // a Set to mark the states seen
  const stamp = new Int32Array(nfa.size);
  let generation = 0;
  const closed = (from) => {
    generation++;
    const stack = [];
    const out = [];
    for (const s of from) {
      if (stamp[s] !== generation) {
        stamp[s] = generation;
        stack.push(s);
      }
    }
    while (stack.length) {
      const s = stack.pop();
      if (matters[s]) out.push(s);
      for (const { label, to } of nfa.edges[s]) {
        if (label === null && stamp[to] !== generation) {
          stamp[to] = generation;
          stack.push(to);
        }
      }
    }
    return Int32Array.from(out).sort();
  };
  const id = (states) => {
    const key = states.length === 1 ? states[0] : states.join(",");
    let i = ids.get(key);
    if (i === undefined) {
      ids.set(key, (i = b.state()));
      sets.push(states);
    }
    return i;
  };
  let dead = null;
  const deadState = () => {
    if (dead === null) {
      dead = b.state();
      sets.push(new Int32Array(0));
      b.edge(dead, CharSet.ALL, dead);
    }
    return dead;
  };
  const start = id(closed([nfa.start]));
  for (let i = 0; i < sets.length; i++) {
    if (i === dead) continue;
    const edges = [];
    for (const s of sets[i]) for (const e of nfa.edges[s]) if (e.label !== null) edges.push(e);
    let covered = CharSet.EMPTY;
    for (const { set, members } of partition(edges.map((e) => e.label))) {
      b.edge(i, set, id(closed(members.map((m) => edges[m].to))));
      if (complete) covered = covered.union(set);
    }
    if (complete && !covered.isAll()) b.edge(i, covered.complement(), deadState());
  }
  const accepting = [];
  sets.forEach((states, i) => {
    for (const s of states) {
      if (nfa.accepting.has(s)) {
        accepting.push(i);
        break;
      }
    }
  });
  return markDeterministic(b.build(start, accepting));
}

// a known DFA with edges for every character, adding a dead state if needed
function completeDfa(nfa, maxStates) {
  const b = new Builder(maxStates);
  for (let i = 0; i < nfa.size; i++) b.state();
  let dead = null;
  nfa.edges.forEach((es, s) => {
    let covered = CharSet.EMPTY;
    for (const { label, to } of es) {
      b.edge(s, label, to);
      covered = covered.union(label);
    }
    if (!covered.isAll()) {
      if (dead === null) {
        dead = b.state();
        b.edge(dead, CharSet.ALL, dead);
      }
      b.edge(s, covered.complement(), dead);
    }
  });
  return markDeterministic(b.build(nfa.start, nfa.accepting));
}

// accepts exactly the strings the NFA rejects
export function complement(nfa) {
  const dfa = determinize(nfa, { complete: true });
  const accepting = [];
  for (let s = 0; s < dfa.size; s++) if (!dfa.accepting.has(s)) accepting.push(s);
  return trim(new NFA(dfa.start, new Set(accepting), dfa.edges));
}

// accepts the strings both NFAs accept (product construction)
// The product only has the pairs of states reachable together, so it's much smaller when
// the operands are deterministic: each string then reaches one pair, rather than every
// combination of the states each operand could be in. So operands are determinised first,
// unless that would make them much larger.
export function intersect(x, y) {
  return product(cheaplyDeterministic(x), cheaplyDeterministic(y));
}

function cheaplyDeterministic(nfa) {
  if (KNOWN_DFAS.has(nfa)) return nfa;
  try {
    return trim(determinize(nfa, { maxStates: Math.max(1000, 2 * nfa.size) }));
  } catch (e) {
    if (e instanceof TooManyStatesError) return nfa;
    throw e;
  }
}

function product(a, c) {
  const b = new Builder();
  const ids = new Map();
  const pairs = [];
  const id = (p, q) => {
    const key = p * c.size + q;
    if (!ids.has(key)) {
      ids.set(key, b.state());
      pairs.push([p, q]);
    }
    return ids.get(key);
  };
  const start = id(a.start, c.start);
  for (let i = 0; i < pairs.length; i++) {
    const [p, q] = pairs[i];
    for (const e of a.edges[p]) {
      if (e.label === null) {
        b.edge(i, null, id(e.to, q));
        continue;
      }
      for (const f of c.edges[q]) {
        if (f.label === null) continue;
        // only pairs with a shared character are reachable together
        const label = e.label.intersect(f.label);
        if (!label.isEmpty()) b.edge(i, label, id(e.to, f.to));
      }
    }
    for (const f of c.edges[q]) if (f.label === null) b.edge(i, null, id(p, f.to));
  }
  const accepting = [];
  pairs.forEach(([p, q], i) => {
    if (a.accepting.has(p) && c.accepting.has(q)) accepting.push(i);
  });
  const result = b.build(start, accepting);
  if (KNOWN_DFAS.has(a) && KNOWN_DFAS.has(c)) markDeterministic(result);
  return trim(result);
}

// accepts the reverse of every string the NFA accepts
// the same NFA with every character label transformed by f
export function mapLabels(nfa, f) {
  const b = new Builder();
  for (let i = 0; i < nfa.size; i++) b.state();
  nfa.edges.forEach((es, s) => {
    for (const { label, to } of es) b.edge(s, label === null ? null : f(label), to);
  });
  return b.build(nfa.start, nfa.accepting);
}

export function reverse(nfa) {
  const b = new Builder();
  for (let i = 0; i < nfa.size; i++) b.state();
  nfa.edges.forEach((es, s) => {
    for (const { label, to } of es) b.edge(to, label, s);
  });
  const start = b.state();
  for (const s of nfa.accepting) b.edge(start, null, s);
  return b.build(start, [nfa.start]);
}

// minimal DFA (Brzozowski: reverse and determinize twice), with no dead state
export function minimize(nfa, { maxStates = stateLimit } = {}) {
  return trim(determinize(reverse(determinize(reverse(nfa), { maxStates })), { maxStates }));
}

// do the NFAs accept exactly the same strings?
export function equivalent(a, b) {
  return intersect(a, complement(b)).accepting.size === 0 && intersect(b, complement(a)).accepting.size === 0;
}

// Merge states that behave the same way: same acceptance, and edges with the same labels to
// states that behave the same way (a forward bisimulation, found by partition refinement).
// Cheaper than minimising, and keeps the NFA no larger than before, but doesn't always find
// the smallest NFA. Expects an NFA without ε-moves.
export function mergeEquivalent(nfa) {
  let block = nfa.edges.map((_, s) => (nfa.accepting.has(s) ? 1 : 0));
  for (let count = new Set(block).size; ;) {
    const signatures = new Map();
    const next = nfa.edges.map((es, s) => {
      // the labels leading to each block, merged, in a canonical order
      const byBlock = new Map();
      for (const { label, to } of es) {
        const b = block[to];
        byBlock.set(b, byBlock.has(b) ? byBlock.get(b).union(label) : label);
      }
      const key = `${block[s]}|${[...byBlock].sort((x, y) => x[0] - y[0]).map(([b, l]) => `${b}:${l.ranges.join(";")}`).join(" ")}`;
      if (!signatures.has(key)) signatures.set(key, signatures.size);
      return signatures.get(key);
    });
    block = next;
    if (signatures.size === count) break;
    count = signatures.size;
  }
  const b = new Builder();
  const size = Math.max(...block) + 1;
  for (let i = 0; i < size; i++) b.state();
  nfa.edges.forEach((es, s) => {
    for (const { label, to } of es) b.edge(block[s], label, block[to]);
  });
  return trim(b.build(block[nfa.start], [...nfa.accepting].map((s) => block[s])));
}
