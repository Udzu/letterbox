// shared test helpers

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
export function randomAst(rand, depth, { chars = DEFAULT_CHARS, logic = true } = {}) {
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
  const sub = () => randomAst(rand, depth - 1, { chars, logic });
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
  ])();
}

