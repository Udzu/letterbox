// Replacement: (?z:A/B/C) matches xcy where xby is in A, b is in B and c is in C. That is, a
// string of A with one substring matching B replaced by one matching C. The strict form
// (?Z:A/B/C) also needs x and y to be non-empty, so the replacement isn't at either end.
//
// The construction reads x with A, then c with C while A waits, then removes b by moving A
// and B together on ε-moves (where their labels share a character), then reads y with A.
// States are created only as they're reached.

import { Builder } from "./nfa.js";

// a, b and c must have no ε-moves
export function replace(a, b, c, strict) {
  const builder = new Builder();
  const ids = new Map();
  const states = [];
  // phases: "x" (p, non-empty), "c" (p, r), "b" (p, q), "y" (p, non-empty)
  const id = (phase, p, other) => {
    const key = `${phase},${p},${other}`;
    if (!ids.has(key)) {
      ids.set(key, builder.state());
      states.push([phase, p, other]);
    }
    return ids.get(key);
  };
  const start = id("x", a.start, 0);
  const accepting = [];
  for (let i = 0; i < states.length; i++) {
    const [phase, p, other] = states[i];
    switch (phase) {
      case "x":
        for (const e of a.edges[p]) builder.edge(i, e.label, id("x", e.to, 1));
        if (!strict || other) builder.edge(i, null, id("c", p, c.start));
        break;
      case "c":
        for (const e of c.edges[other]) builder.edge(i, e.label, id("c", p, e.to));
        if (c.accepting.has(other)) builder.edge(i, null, id("b", p, b.start));
        break;
      case "b":
        for (const e of a.edges[p]) {
          for (const f of b.edges[other]) {
            if (!e.label.intersect(f.label).isEmpty()) builder.edge(i, null, id("b", e.to, f.to));
          }
        }
        if (b.accepting.has(other)) builder.edge(i, null, id("y", p, 0));
        break;
      case "y":
        for (const e of a.edges[p]) builder.edge(i, e.label, id("y", e.to, 1));
        if (a.accepting.has(p) && (!strict || other)) accepting.push(i);
        break;
    }
  }
  return builder.build(start, accepting);
}
