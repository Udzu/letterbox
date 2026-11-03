import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches, PatternError } from "../src/patterns/index.js";
import { compile as compileAst } from "../src/patterns/compile.js";
import {
  closure, complement, determinize, intersect, matches as nfaMatches, minimize, removeEpsilons, reverse, trim,
} from "../src/patterns/nfa.js";
import { randomAst, seededRandom } from "./helpers.js";

const CASES = [
  // [pattern, accepted, rejected]
  ["", [""], ["a"]],
  ["a", ["a"], ["", "b", "aa", "A"]],
  ["abc", ["abc"], ["", "ab", "abcd", "acb"]],
  [".", ["a", "😀", "\n", "é"], ["", "ab"]],
  ["[a-c]", ["a", "b", "c"], ["d", "", "ab"]],
  ["[^a-c]", ["d", "😀"], ["a", "c", ""]],
  ["[]", [], ["", "a"]],
  ["[^]", ["a", "😀"], ["", "ab"]],
  ["😀+", ["😀", "😀😀"], ["", "😀a"]],
  ["a|bc", ["a", "bc"], ["", "b", "abc"]],
  ["a|", ["a", ""], ["aa"]],
  ["a*", ["", "a", "aaaa"], ["b", "ab"]],
  ["a+", ["a", "aaa"], [""]],
  ["a?", ["", "a"], ["aa"]],
  ["a{3}", ["aaa"], ["aa", "aaaa"]],
  ["a{2,}", ["aa", "aaaaa"], ["a"]],
  ["a{2,3}", ["aa", "aaa"], ["a", "aaaa"]],
  ["a{0}", [""], ["a"]],
  ["(ab)*", ["", "ab", "abab"], ["a", "aba"]],
  ["(a*b*)*", ["", "ab", "ba", "bbaab"], ["c"]],
  ["a*b*", ["", "aab", "bb"], ["ba"]],
  ["(ab*)*", ["", "a", "ab", "aab", "abba"], ["b", "ba"]],
  ["(a|b*)+c", ["c", "ac", "bbac"], ["", "ab"]],
  ["(a?){3}", ["", "a", "aaa"], ["aaaa"]],
  // conjunction and negation
  ["a*&(aa)*", ["", "aa", "aaaa"], ["a", "aaa"]],
  [".{3}&.*a.*", ["abc", "bca", "aaa"], ["bcd", "ab", "abcd"]],
  ["a&b", [], ["a", "b", ""]],
  ["!a", ["", "b", "aa", "😀"], ["a"]],
  ["!.*a.*", ["", "bcd"], ["a", "bab"]],
  ["!(a|b)*", ["c", "abc"], ["", "abab"]],
  ["!!a", ["a"], ["", "b"]],
  ["!a&.", ["b", "😀"], ["a", "", "bb"]],
  ["x(!a)y", ["xy", "xby", "xaay"], ["xay"]],
  // normalisation
  ["é", ["é", "é"], ["e"]],
];

for (const [pattern, accepted, rejected] of CASES) {
  test(`matches ${JSON.stringify(pattern)}`, () => {
    const nfa = compile(pattern);
    for (const s of accepted) assert.ok(matches(nfa, s), `should match ${JSON.stringify(s)}`);
    for (const s of rejected) assert.ok(!matches(nfa, s), `should not match ${JSON.stringify(s)}`);
  });
}

test("Thompson construction shares states", () => {
  assert.equal(compile("abc").size, 4);
  assert.equal(compile("a|b").size, 4);
  assert.equal(compile("a()b").size, 3);
  assert.equal(compile("").size, 1);
});

test("oversized patterns are rejected", () => {
  assert.throws(() => compile("(a{1000}){1000}"), (e) => e instanceof PatternError && /too complex/.test(e.message));
});

// conversion of an AST without & or ! into an equivalent JS RegExp
function toRegExp(node) {
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

const ALPHABET = ["a", "b", "é", "😀"];
const AST_CHARS = ["a", "b", "😀"];

function randomStrings(rand, n) {
  return Array.from({ length: n }, () =>
    Array.from({ length: Math.floor(rand() * 6) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join(""));
}

test("matching agrees with RegExp", () => {
  const rand = seededRandom(3);
  for (let i = 0; i < 500; i++) {
    const ast = randomAst(rand, 4, { chars: AST_CHARS, logic: false });
    const nfa = compileAst(ast);
    const re = new RegExp(`^(?:${toRegExp(ast)})$`, "u");
    for (const s of randomStrings(rand, 30)) {
      assert.equal(nfaMatches(nfa, s), re.test(s), `${re} on ${JSON.stringify(s)}`);
    }
  }
});

test("operations preserve or transform the language as expected", () => {
  const rand = seededRandom(5);
  const reversed = (s) => [...s].reverse().join("");
  for (let i = 0; i < 300; i++) {
    const a = compileAst(randomAst(rand, 3, { chars: AST_CHARS }));
    const b = compileAst(randomAst(rand, 3, { chars: AST_CHARS }));
    const variants = {
      trim: trim(a),
      removeEpsilons: removeEpsilons(a),
      determinize: determinize(a),
      complete: determinize(a, { complete: true }),
      minimize: minimize(a),
    };
    const dfa = variants.determinize;
    assert.ok(dfa.isDeterministic());
    assert.ok(variants.minimize.isDeterministic());
    assert.ok(variants.minimize.size <= trim(dfa).size);
    for (const name of ["trim", "removeEpsilons", "determinize", "complete"]) {
      assert.equal(minimize(variants[name]).size, variants.minimize.size, `minimize after ${name}`);
    }
    assert.ok(variants.removeEpsilons.edges.every((es) => es.every((e) => e.label !== null)));
    const notA = complement(a);
    const aAndB = intersect(a, b);
    const revA = reverse(a);
    for (const s of randomStrings(rand, 30)) {
      const inA = nfaMatches(a, s);
      for (const [name, nfa] of Object.entries(variants)) assert.equal(nfaMatches(nfa, s), inA, `${name} on ${s}`);
      assert.equal(nfaMatches(notA, s), !inA, `complement on ${s}`);
      assert.equal(nfaMatches(aAndB, s), inA && nfaMatches(b, s), `intersect on ${s}`);
      assert.equal(nfaMatches(revA, reversed(s)), inA, `reverse on ${s}`);
    }
  }
});

test("minimal DFAs of equivalent patterns have the same size", () => {
  const pairs = [
    ["(a|b)*", "(a*b*)*"],
    ["a|b|a", "[ab]"],
    ["(aa|a)*", "a*"],
    ["a*&(aa)*", "(aa)*"],
    ["!!(ab|c)", "ab|c"],
    ["!(a*)", ".*[^a].*"],
  ];
  for (const [p, q] of pairs) {
    const m = minimize(compile(p));
    const n = minimize(compile(q));
    assert.equal(m.size, n.size, `${p} vs ${q}`);
    assert.equal(m.accepting.size, n.accepting.size, `${p} vs ${q}`);
  }
  assert.equal(minimize(compile("(a|b)*")).size, 1);
  assert.equal(minimize(compile("[]")).size, 1);
  assert.equal(minimize(compile("[]")).accepting.size, 0);
});

test("closure follows ε-moves only", () => {
  const nfa = compile("a*");
  const start = closure(nfa, [nfa.start]);
  assert.ok([...start].some((s) => nfa.accepting.has(s)));
  assert.equal(closure(nfa, []).size, 0);
});

test("run returns the reachable states", async () => {
  const { run } = await import("../src/patterns/nfa.js");
  const nfa = minimize(compile("ab|ac"));
  assert.equal(run(nfa, "a").size, 1);
  assert.equal(run(nfa, "x").size, 0);
  assert.ok(nfa.accepting.has([...run(nfa, "ab")][0]));
});
