// Separating and subtraction operators, as products of two NFAs with a "split" DFA.
//
// A split DFA reads a string over {L, R} that says, for each position of a combined string,
// whether its character belongs to the left operand (L) or the right one (R). For example
// concatenation is L*R*, containment (A inside B) is R*L*R* and interleaving is [LR]*.
//
// weave(A, B, split) matches w if some labelling of w's positions accepted by the split has
// its L characters spelling a string in A and its R characters spelling one in B.
//
// unweave(A, B, split) matches w if for some b in B, some combination of w (as L) and b
// (as R) accepted by the split is in A. That is, A with B removed according to the split.
//
// The results aren't trimmed, so they can be shown before and after trimming.

import { Builder } from "./nfa.js";

const L = "L".codePointAt(0);
const R = "R".codePointAt(0);

function product(a, b, split, step) {
  const builder = new Builder();
  const ids = new Map();
  const triples = [];
  const id = (p, q, s) => {
    const key = (p * b.size + q) * split.size + s;
    if (!ids.has(key)) {
      ids.set(key, builder.state());
      triples.push([p, q, s]);
    }
    return ids.get(key);
  };
  const start = id(a.start, b.start, split.start);
  for (let i = 0; i < triples.length; i++) {
    const [p, q, s] = triples[i];
    // the operands' own ε-moves don't consume anything or affect the split
    for (const e of a.edges[p]) if (e.label === null) builder.edge(i, null, id(e.to, q, s));
    for (const f of b.edges[q]) if (f.label === null) builder.edge(i, null, id(p, f.to, s));
    for (const g of split.edges[s]) {
      if (g.label === null) builder.edge(i, null, id(p, q, g.to));
      else step(builder, i, p, q, g, id);
    }
  }
  const accepting = [];
  triples.forEach(([p, q, s], i) => {
    if (a.accepting.has(p) && b.accepting.has(q) && split.accepting.has(s)) accepting.push(i);
  });
  return builder.build(start, accepting);
}

export function weave(a, b, split) {
  return product(a, b, split, (builder, i, p, q, g, id) => {
    if (g.label.has(L)) {
      for (const e of a.edges[p]) if (e.label !== null) builder.edge(i, e.label, id(e.to, q, g.to));
    }
    if (g.label.has(R)) {
      for (const f of b.edges[q]) if (f.label !== null) builder.edge(i, f.label, id(p, f.to, g.to));
    }
  });
}

export function unweave(a, b, split) {
  return product(a, b, split, (builder, i, p, q, g, id) => {
    // L: a character of w, which A reads too
    if (g.label.has(L)) {
      for (const e of a.edges[p]) if (e.label !== null) builder.edge(i, e.label, id(e.to, q, g.to));
    }
    // R: a removed character, which A and B both read but w doesn't
    if (g.label.has(R)) {
      for (const e of a.edges[p]) {
        if (e.label === null) continue;
        for (const f of b.edges[q]) {
          if (f.label !== null && !e.label.intersect(f.label).isEmpty()) builder.edge(i, null, id(e.to, f.to, g.to));
        }
      }
    }
  });
}
