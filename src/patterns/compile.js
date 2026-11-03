// Compile a pattern AST into an NFA, using Thompson's construction for the regular
// expression basics and NFA operations for & and !.
//
// build(node, from) adds the node's fragment starting at the existing state `from` and
// returns its end state. Two invariants keep this sound while sharing states:
// - no fragment adds edges *into* `from` (loops always go back to a fresh state), and
// - the returned end state has no outgoing edges yet, unless it is `from` itself.

import { CharSet } from "./charset.js";
import { Builder, complement, intersect, minimize, removeEpsilons } from "./nfa.js";
import { parse } from "./parser.js";
import { unweave, weave } from "./weave.js";

// Split patterns for the separating operators: which positions of a combined string come
// from the left operand (L) and which from the right (R). See weave.js.
export const SPLITS = {
  "": "L*R*", //      AB    A then B
  "<": "R*L*R*", //   A<B   A inside B
  ">": "L*R*L*", //   A>B   A outside B
  "<<": "R+L*R+", //  A<<B  A strictly inside B
  ">>": "L+R*L+", //  A>>B  A strictly outside B
  "^": "[LR]*", //    A^B   A interleaved with B
  "<^": "R[LR]*R", // A<^B  A interleaved strictly inside B
  ">^": "L[LR]*L", // A>^B  A interleaved strictly outside B
  "#": "(LR)*L?|(RL)*R?", // A#B  A alternating with B
  "##": "(LR)*L?", // A##B  A alternating with B, A first
};

// How each spatial operator token is built: A op B weaves A and B with SPLITS[op], while
// A-op B removes B from A (w matches if w op b is in A for some b in B), and A_-op B is
// the mirror image (b op w is in A).
export function spatialOp(op) {
  if (op in SPLITS) return { construct: weave, split: SPLITS[op] };
  if (op.startsWith("-")) return { construct: unweave, split: SPLITS[op.slice(1)] };
  if (op.startsWith("_-")) return { construct: unweave, split: swap(SPLITS[op.slice(2)]) };
  throw new Error(`Unknown spatial operator ${op}`);
}

function swap(split) {
  return split.replace(/[LR]/g, (c) => (c === "L" ? "R" : "L"));
}

const splitCache = new Map();
function splitDfa(split) {
  if (!splitCache.has(split)) splitCache.set(split, minimize(compile(parse(split))));
  return splitCache.get(split);
}

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
    case "spatial": {
      const { construct, split } = spatialOp(node.op);
      const nfa = construct(removeEpsilons(compile(node.left)), removeEpsilons(compile(node.right)), splitDfa(split));
      return embed(b, nfa, from);
    }
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
