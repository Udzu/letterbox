import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches } from "../src/patterns/index.js";
import { compile as compileAst } from "../src/patterns/compile.js";
import { CharSet } from "../src/patterns/charset.js";
import { caseClass, caseClose, shiftSet } from "../src/patterns/letters.js";
import { equivalent } from "../src/patterns/nfa.js";
import { randomAst, seededRandom, toRegExp } from "./helpers.js";

const EXAMPLES = [
  // [pattern, matching, not matching]
  ["(?i:abc)", ["abc", "ABC", "aBc"], ["abd", "ab"]],
  ["(?i:k)", ["k", "K", "K"], ["x"]],
  ["(?i:i)", ["i", "I"], ["ı", "İ"]],
  ["(?i:ß)", ["ß", "ẞ"], ["SS", "ss"]],
  ["(?i:σ)", ["σ", "Σ", "ς"], []],
  ["(?i:!a)", ["b", "", "aa"], ["a", "A"]],
  ["(?i:[^a])", ["b"], ["a", "A"]],
  ["(?i:[a-c])", ["B"], ["D"]],
  ["(?i:a)b", ["Ab"], ["AB"]],
  ["(?r:abc)", ["cba"], ["abc"]],
  ["(?r:ab*)", ["a", "bba"], ["ab"]],
  ["(?r:😀é)", ["é😀"], []],
  ["(?c3:abz)", ["dec"], ["abz"]],
  ["(?c13:Hello world)", ["Uryyb jbeyq"], ["Hello world"]],
  ["(?c-1:a)", ["z"], ["b"]],
  ["(?c26:a)", ["a"], ["b"]],
  ["(?c1:[x-z])", ["y", "z", "a"], ["x", "b"]],
  ["(?c1:é)", ["é"], []],
  ["(?c:ab)", ["bc", "za", "yz"], ["ab", "ac"]],
  ["(?R1:abc)", ["cab"], ["abc", "bca"]],
  ["(?R-1:abc)", ["bca"], ["abc", "cab"]],
  ["(?R2:abc)", ["bca"], ["abc", "cab"]],
  ["(?R:abc)", ["bca", "cab"], ["abc", "acb"]],
  ["(?R3:the)", [], ["the", "het"]],
  ["(?R:a)", [], ["a", ""]],
  ["(?R2:abab)", ["abab"], ["baba"]],
  ["(?R:cat|dog)", ["atc", "tca", "ogd", "gdo"], ["cat", "dog", "act"]],
  ["(?R:[a-z]+ing)", ["ingest", "ingsink", "ngsinki"], ["sing"]],
  ["(?i:(?R1:abc))", ["CAB"], []],
];

for (const [pattern, yes, no] of EXAMPLES) {
  test(`modifier ${pattern}`, () => {
    const nfa = compile(pattern);
    for (const s of yes) assert.ok(matches(nfa, s), `${pattern} should match ${s}`);
    for (const s of no) assert.ok(!matches(nfa, s), `${pattern} shouldn't match ${s}`);
  });
}

const chars = (s) => [...s];
const shiftChar = (c, n) => {
  for (const base of ["a", "A"].map((x) => x.codePointAt(0))) {
    const i = c.codePointAt(0) - base;
    if (i >= 0 && i < 26) return String.fromCodePoint(base + (((i + n) % 26) + 26) % 26);
  }
  return c;
};
const shiftString = (s, n) => chars(s).map((c) => shiftChar(c, n)).join("");
const rotations = (s, count) => {
  // the strings uv where s is vu, with the lengths the modifier requires
  const cs = chars(s);
  const splits = count === null ? cs.slice(1).map((_, i) => i + 1) : count > 0 ? [count] : [cs.length + count];
  return splits.filter((k) => k >= 1 && k < cs.length).map((k) => [...cs.slice(k), ...cs.slice(0, k)].join(""));
};

function oracle(flag, count, inner, s) {
  switch (flag) {
    case "r": return matches(inner, chars(s).reverse().join(""));
    case "c":
      if (count !== null) return matches(inner, shiftString(s, -count));
      return Array.from({ length: 25 }, (_, i) => i + 1).some((n) => matches(inner, shiftString(s, -n)));
    case "R": return rotations(s, count).some((t) => matches(inner, t));
    default: throw new Error(flag);
  }
}

const ALPHABET = ["a", "b", "z", "A", "Z", "😀"];
const AST_CHARS = ["a", "b", "z", "B", "😀"];

function randomStrings(rand, n) {
  return Array.from({ length: n }, () =>
    Array.from({ length: Math.floor(rand() * 6) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join(""));
}

test("r, c and R agree with their definitions", () => {
  const rand = seededRandom(7);
  for (let i = 0; i < 150; i++) {
    const ast = randomAst(rand, 3, { chars: AST_CHARS });
    const inner = compileAst(ast);
    for (const [flag, count] of [["r", null], ["c", 1], ["c", -27], ["c", null], ["R", 1], ["R", -2], ["R", null]]) {
      const nfa = compileAst({ type: "modifier", flag, count, node: ast });
      for (const s of randomStrings(rand, 15)) {
        assert.equal(matches(nfa, s), oracle(flag, count, inner, s), `(?${flag}${count ?? ""}:…) on ${JSON.stringify(s)}`);
      }
    }
  }
});

test("(?i:…) agrees with JavaScript's i flag", () => {
  const rand = seededRandom(9);
  const strings = ["k", "K", "K", "s", "S", "ſ", "ı", "İ", "i", "I"];
  for (let i = 0; i < 300; i++) {
    const ast = randomAst(rand, 3, { chars: [...AST_CHARS, "k", "ſ", "I"], logic: false });
    const nfa = compileAst({ type: "modifier", flag: "i", count: null, node: ast });
    const re = new RegExp(`^(?:${toRegExp(ast)})$`, "iu");
    for (const s of [...randomStrings(rand, 20), ...strings]) {
      assert.equal(matches(nfa, s), re.test(s), `${re} on ${JSON.stringify(s)}`);
    }
  }
});

test("(?i:…) applies to every comparison inside it", () => {
  const rand = seededRandom(11);
  const same = (p, q) => assert.ok(equivalent(compile(p), compile(q)), `${p} ≡ ${q}`);
  same("(?i:!ab)", "!(?i:ab)");
  same("(?i:a&[a-z])", "(?i:a)&(?i:[a-z])");
  same("(?i:ab-b)", "(?i:ab)-(?i:b)");
  same("(?i:a<b)", "(?i:a)<(?i:b)");
  same("(?i:(?i:a))", "(?i:a)");
  same("(?i:(?r:ab))", "(?r:(?i:ab))");
  same("(?i:(?c3:ab))", "(?c3:(?i:ab))");
  for (let i = 0; i < 100; i++) {
    const ast = randomAst(rand, 3, { chars: ["a", "B"], modifiers: true });
    const twice = { type: "modifier", flag: "i", count: null, node: { type: "modifier", flag: "i", count: null, node: ast } };
    assert.ok(equivalent(compileAst({ type: "modifier", flag: "i", count: null, node: ast }), compileAst(twice)));
  }
});

test("identities between modifiers", () => {
  const same = (p, q) => assert.ok(equivalent(compile(p), compile(q)), `${p} ≡ ${q}`);
  same("(?r:(?r:a+b|c))", "a+b|c");
  same("(?c3:(?c-3:a+b|c))", "a+b|c");
  same("(?c13:(?c13:[a-z]+))", "[a-z]+");
  same("(?c0:abc)", "abc");
  same("(?R1:(?R-1:abcd))", "abcd");
  same("(?r:(?R1:abcd))", "(?R-1:(?r:abcd))");
  same("(?R1:[a-z]*)", "[a-z]{2,}");
  same("(?R:abcd)", "(?R1:abcd)|(?R2:abcd)|(?R3:abcd)");
});

test("the case table agrees with JavaScript's iu flags", () => {
  // every class's members match each other
  const classes = new Map();
  for (let cp = 0; cp < 0x20000; cp++) {
    const cls = caseClass(cp);
    if (cls.length > 1) classes.set(cls[0], cls);
  }
  const all = [...classes.values()].flat();
  for (const cls of classes.values()) {
    const re = new RegExp(`^[${cls.map((cp) => `\\u{${cp.toString(16)}}`).join("")}]$`, "iu");
    for (const cp of cls) assert.ok(re.test(String.fromCodePoint(cp)));
    // and no other cased character
    const matched = all.filter((cp) => re.test(String.fromCodePoint(cp)));
    assert.equal(matched.length, cls.length, `class of ${String.fromCodePoint(cls[0])}`);
  }
  // and no character outside a class matches any cased character
  const cased = new RegExp(`^[${all.map((cp) => `\\u{${cp.toString(16)}}`).join("")}]$`, "iu");
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    if (caseClass(cp).length === 1) assert.ok(!cased.test(String.fromCodePoint(cp)), `U+${cp.toString(16)}`);
  }
});

test("caseClose and shiftSet on ranges", () => {
  const set = (s) => CharSet.of(...chars(s).map((c) => c.codePointAt(0)));
  const range = (a, b) => CharSet.from([[a.codePointAt(0), b.codePointAt(0)]]);
  assert.ok(caseClose(range("a", "c")).equals(range("a", "c").union(range("A", "C"))));
  assert.ok(caseClose(CharSet.ALL).isAll());
  assert.ok(caseClose(set("1")).equals(set("1")));
  assert.ok(shiftSet(range("x", "z"), 3).equals(range("a", "c")));
  assert.ok(shiftSet(range("w", "z"), 3).equals(range("z", "z").union(range("a", "c"))));
  assert.ok(shiftSet(range("a", "z"), 5).equals(range("a", "z")));
  assert.ok(shiftSet(set("a").complement(), 1).equals(set("b").complement()));
  assert.ok(shiftSet(set("aZé"), 1).equals(set("bAé")));
  assert.ok(shiftSet(set("a"), -1).equals(set("z")));
  assert.ok(shiftSet(set("a"), 52).equals(set("a")));
});
