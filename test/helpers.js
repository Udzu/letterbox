// shared test helpers

import { MODIFIERS, SPATIAL_OPS, sliceError } from "../src/patterns/parser.js";

export const DEFAULT_CHARS = ["a", "b", "é", "😀", " ", "'", "*", "\\", "-", "]", "^", "[", "|", "\n", "\x00", "!"];

// deterministic pseudo-random numbers in [0, 1)
export function seededRandom(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

export function stripSpans(node) {
  if (Array.isArray(node)) return node.map(stripSpans);
  if (node === null || typeof node !== "object") return node;
  return Object.fromEntries(Object.entries(node).filter(([k]) => k !== "span").map(([k, v]) => [k, stripSpans(v)]));
}

// random ASTs in normal form: associative nodes are flattened and have 2+ items
export function randomAst(rand, depth, { chars = DEFAULT_CHARS, logic = true, spatial = logic, modifiers = false } = {}) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const cp = () => pick(chars).codePointAt(0);
  const leaf = () => pick([
    () => ({ type: "empty" }),
    () => ({ type: "char", cp: cp() }),
    () => ({ type: "any" }),
    () => {
      const ranges = Array.from({ length: Math.floor(rand() * 3) }, () => {
        const [x, y] = [cp(), cp()].sort((p, q) => p - q);
        return rand() < 0.5 ? [x, x] : [x, y];
      });
      return { type: "class", negated: rand() < 0.5, ranges };
    },
  ])();
  if (depth === 0) return leaf();
  const sub = () => randomAst(rand, depth - 1, { chars, logic, spatial, modifiers });
  const items = (type) => {
    const out = [];
    for (let i = 0, n = 2 + Math.floor(rand() * 2); i < n; i++) {
      const item = sub();
      out.push(...(item.type === type ? item.items : [item]));
    }
    return { type, items: out };
  };
  return pick([
    leaf,
    () => {
      const min = Math.floor(rand() * 3);
      return { type: "repeat", node: sub(), min, max: pick([null, min, min + 2]) };
    },
    () => items("concat"),
    () => items("alt"),
    ...(logic ? [() => ({ type: "not", node: sub() }), () => items("and")] : []),
    ...(spatial ? [() => ({ type: "spatial", op: pick(SPATIAL_OPS), left: sub(), right: sub() })] : []),
    ...(modifiers ? [() => {
      const flag = pick(Object.keys(MODIFIERS).filter((f) => !MODIFIERS[f].parts));
      const count = MODIFIERS[flag].count === "none" ? null : pick([null, 1, 2, -1, ...(flag === "c" ? [0, 13, 30] : [])]);
      return { type: "modifier", flag, count, node: sub() };
    }] : []),
    ...(modifiers ? [() => ({ type: "replace", strict: rand() < 0.5, node: sub(), find: sub(), insert: sub() })] : []),
    ...(modifiers ? [() => {
      for (;;) {
        const [start, stop, step] = [[null, 0, 1, 2, -1, -2], [null, 0, 1, 3, -1], [null, 1, 2, 3]].map(pick);
        if (!sliceError(start, stop, step)) return { type: "slice", start, stop, step, node: sub() };
      }
    }] : []),
  ])();
}

// conversion of an AST without & or ! into an equivalent JS RegExp
export function toRegExp(node) {
  const ch = (cp) => `\\u{${cp.toString(16)}}`;
  switch (node.type) {
    case "empty": return "(?:)";
    case "char": return ch(node.cp);
    case "any": return "[^]";
    case "class":
      return `[${node.negated ? "^" : ""}${node.ranges.map(([lo, hi]) => `${ch(lo)}-${ch(hi)}`).join("")}]`;
    case "repeat": return `(?:${toRegExp(node.node)}){${node.min},${node.max ?? ""}}`;
    case "concat": return node.items.map((n) => `(?:${toRegExp(n)})`).join("");
    case "alt": return `(?:${node.items.map(toRegExp).join("|")})`;
    default: throw new Error(node.type);
  }
}
