// Compile a pattern AST into an NFA, using Thompson's construction for the regular
// expression basics and NFA operations for & and !.
//
// build(node, from) adds the node's fragment starting at the existing state `from` and
// returns its end state. Two invariants keep this sound while sharing states:
// - no fragment adds edges *into* `from` (loops always go back to a fresh state), and
// - the returned end state has no outgoing edges yet, unless it is `from` itself.

import { CharSet } from "./charset.js";
import { Builder, complement, intersect } from "./nfa.js";

export function compile(ast) {
  const b = new Builder();
  const start = b.state();
  const end = build(b, ast, start);
  return b.build(start, [end]);
}

function build(b, node, from) {
  switch (node.type) {
    case "empty":
      return from;
    case "char":
      return step(b, from, CharSet.of(node.cp));
    case "any":
      return step(b, from, CharSet.ALL);
    case "class": {
      const set = CharSet.from(node.ranges.map(([lo, hi]) => [lo, hi]));
      return step(b, from, node.negated ? set.complement() : set);
    }
    case "concat":
      return node.items.reduce((at, item) => build(b, item, at), from);
    case "alt": {
      const end = b.state();
      for (const item of node.items) b.edge(build(b, item, from), null, end);
      return end;
    }
    case "repeat":
      return repeat(b, node.node, node.min, node.max, from);
    case "and": {
      const nfa = node.items.map(compile).reduce(intersect);
      return embed(b, nfa, from);
    }
    case "not":
      return embed(b, complement(compile(node.node)), from);
    default:
      throw new Error(`Unknown node type ${node.type}`);
  }
}

function step(b, from, label) {
  const end = b.state();
  b.edge(from, label, end);
  return end;
}

function repeat(b, node, min, max, from) {
  let at = from;
  const required = max === null && min > 0 ? min - 1 : min;
  for (let i = 0; i < required; i++) at = build(b, node, at);
  if (max === null) return min > 0 ? plus(b, node, at) : star(b, node, at);
  for (let i = min; i < max; i++) {
    const end = build(b, node, at);
    b.edge(at, null, end); // skip this copy
    at = end;
  }
  return at;
}

// from → loop ⟲ node, loop → end
function star(b, node, from) {
  const loop = b.state();
  b.edge(from, null, loop);
  b.edge(build(b, node, loop), null, loop);
  const end = b.state();
  b.edge(loop, null, end);
  return end;
}

// from → loop → node, back to loop or on to end
function plus(b, node, from) {
  const loop = b.state();
  b.edge(from, null, loop);
  const last = build(b, node, loop);
  b.edge(last, null, loop);
  const end = b.state();
  b.edge(last, null, end);
  return end;
}

function embed(b, nfa, from) {
  const { start, accepting } = b.embed(nfa);
  b.edge(from, null, start);
  const end = b.state();
  for (const s of accepting) b.edge(s, null, end);
  return end;
}
