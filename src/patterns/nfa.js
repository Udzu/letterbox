// Nondeterministic finite automata over Unicode code points.
//
// States are integers 0..size-1, with one start state and a set of accepting states.
// edges[s] lists the edges leaving s as { label, to }, where label is a CharSet, or null
// for an ε-move. Edges are independent: a character can follow any edge whose label
// contains it. NFAs are treated as immutable; operations return new ones.

import { CharSet, partition } from "./charset.js";

export const MAX_STATES = 50000;

export class TooManyStatesError extends Error {
  constructor() {
    super(`The automaton needs more than ${MAX_STATES} states`);
    this.name = "TooManyStatesError";
  }
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
  constructor() {
    this.edges = [];
  }

  state() {
    if (this.edges.length >= MAX_STATES) throw new TooManyStatesError();
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
      const merged = new Map();
      for (const { label, to } of es) {
        if (label === null && to === s) continue; // ε self-loops do nothing
        const key = label === null ? `ε${to}` : `${to}`;
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
  const reverse = nfa.edges.map(() => []);
  nfa.edges.forEach((es, s) => {
    for (const { to } of es) reverse[to].push(s);
  });
  const live = new Set(nfa.accepting);
  const stack = [...live];
  while (stack.length) {
    for (const s of reverse[stack.pop()]) {
      if (!live.has(s)) {
        live.add(s);
        stack.push(s);
      }
    }
  }
  const order = new Map([[nfa.start, 0]]);
  const queue = [nfa.start];
  for (let i = 0; i < queue.length; i++) {
    for (const { to } of nfa.edges[queue[i]]) {
      if (live.has(to) && !order.has(to)) {
        order.set(to, order.size);
        queue.push(to);
      }
    }
  }
  const b = new Builder();
  for (let i = 0; i < queue.length; i++) b.state();
  for (const s of queue) {
    for (const { label, to } of nfa.edges[s]) if (order.has(to)) b.edge(order.get(s), label, order.get(to));
  }
  return b.build(0, queue.filter((s) => nfa.accepting.has(s)).map((s) => order.get(s)));
}

// equivalent NFA with no ε-moves
export function removeEpsilons(nfa) {
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
export function determinize(nfa, { complete = false } = {}) {
  const b = new Builder();
  const ids = new Map();
  const sets = [];
  // states with only ε-moves contribute nothing beyond their closure, so leave them out of
  // state sets; otherwise e.g. a fresh start state makes the start set unique
  const matters = nfa.edges.map((es, s) => nfa.accepting.has(s) || es.some((e) => e.label !== null));
  const id = (closed) => {
    const states = new Set([...closed].filter((s) => matters[s]));
    const key = [...states].sort((x, y) => x - y).join(",");
    if (!ids.has(key)) {
      ids.set(key, b.state());
      sets.push(states);
    }
    return ids.get(key);
  };
  let dead = null;
  const deadState = () => {
    if (dead === null) {
      dead = b.state();
      sets.push(new Set());
      b.edge(dead, CharSet.ALL, dead);
    }
    return dead;
  };
  const start = id(closure(nfa, [nfa.start]));
  for (let i = 0; i < sets.length; i++) {
    if (i === dead) continue;
    const edges = [...sets[i]].flatMap((s) => nfa.edges[s].filter((e) => e.label !== null));
    let covered = CharSet.EMPTY;
    for (const { set, members } of partition(edges.map((e) => e.label))) {
      b.edge(i, set, id(closure(nfa, members.map((m) => edges[m].to))));
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
  return b.build(start, accepting);
}

// accepts exactly the strings the NFA rejects
export function complement(nfa) {
  const dfa = determinize(nfa, { complete: true });
  const accepting = [];
  for (let s = 0; s < dfa.size; s++) if (!dfa.accepting.has(s)) accepting.push(s);
  return trim(new NFA(dfa.start, new Set(accepting), dfa.edges));
}

// accepts the strings both NFAs accept (product construction)
export function intersect(a, c) {
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
        if (f.label !== null) b.edge(i, e.label.intersect(f.label), id(e.to, f.to));
      }
    }
    for (const f of c.edges[q]) if (f.label === null) b.edge(i, null, id(p, f.to));
  }
  const accepting = [];
  pairs.forEach(([p, q], i) => {
    if (a.accepting.has(p) && c.accepting.has(q)) accepting.push(i);
  });
  return trim(b.build(start, accepting));
}

// accepts the reverse of every string the NFA accepts
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
export function minimize(nfa) {
  return trim(determinize(reverse(determinize(reverse(nfa)))));
}
