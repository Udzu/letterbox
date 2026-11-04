// shared test helpers

import { MODIFIERS, SPATIAL_OPS, parse, sliceError } from "../src/patterns/parser.js";
import { formatShorthand } from "../src/patterns/shorthands.js";

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

const RANDOM_SPLITS = ["L*R*", "R+L+R+L+R*", "(LLR)*", "(LR+)*L", "[LR]*", "!(L*R*)"];
const splitAst = (split) => stripSpans(parse(split));

// random ASTs in normal form: associative nodes are flattened and have 2+ items

export function randomAst(rand, depth, { chars = DEFAULT_CHARS, logic = true, spatial = logic, modifiers = false, shorthands = false } = {}) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const cp = () => pick(chars).codePointAt(0);
  // a few cheap properties, so tests stay fast
  const shorthand = () => {
    const name = pick(["d", "w", "s", "p"]);
    const property = name === "p" ? { property: pick(["L", "Lu", "Script=Latin"]) } : {};
    return { name, negated: rand() < 0.5, ...property };
  };
  const leaf = () => pick([
    () => ({ type: "empty" }),
    () => ({ type: "char", cp: cp() }),
    () => ({ type: "any" }),
    () => {
      const ranges = Array.from({ length: Math.floor(rand() * 3) }, () => {
        const [x, y] = [cp(), cp()].sort((p, q) => p - q);
        return rand() < 0.5 ? [x, x] : [x, y];
      });
      const extra = shorthands && rand() < 0.3 ? { shorthands: [shorthand()] } : {};
      return { type: "class", negated: rand() < 0.5, ranges, ...extra };
    },
    ...(shorthands ? [() => ({ type: "shorthand", ...shorthand() })] : []),
  ])();
  if (depth === 0) return leaf();
  const sub = () => randomAst(rand, depth - 1, { chars, logic, spatial, modifiers, shorthands });
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
      // anagrams need a finite pattern, which a concatenation of leaves always is
      if (flag === "a") return { type: "modifier", flag, count: null, node: { type: "concat", items: [leaf(), leaf(), leaf()] } };
      const counts = flag === "t" ? [null, 1, 2, 3] : [null, 1, 2, -1, ...(flag === "c" ? [0, 13, 30, "-"] : [])];
      const count = MODIFIERS[flag].count === "none" ? null : pick(counts);
      return { type: "modifier", flag, count, node: sub() };
    }] : []),
    ...(modifiers ? [() => ({ type: "split", unweave: rand() < 0.5, split: splitAst(pick(RANDOM_SPLITS)), left: sub(), right: sub() })] : []),
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
    case "class": {
      const shorthands = (node.shorthands ?? []).map(jsShorthand).join("");
      return `[${node.negated ? "^" : ""}${node.ranges.map(([lo, hi]) => `${ch(lo)}-${ch(hi)}`).join("")}${shorthands}]`;
    }
    case "shorthand": return node.name === "s" ? `[${jsShorthand(node)}]` : formatShorthand(node);
    case "repeat": return `(?:${toRegExp(node.node)}){${node.min},${node.max ?? ""}}`;
    case "concat": return node.items.map((n) => `(?:${toRegExp(n)})`).join("");
    case "alt": return `(?:${node.items.map(toRegExp).join("|")})`;
    default: throw new Error(node.type);
  }
}

// JavaScript's \s includes Unicode spaces, so ASCII whitespace is written out; there's no
// way to write \S inside a class with the u flag, but the v flag allows a nested class
function jsShorthand(sh) {
  if (sh.name !== "s") return formatShorthand(sh);
  return sh.negated ? "[^\\t-\\r ]" : "\\t-\\r ";
}
