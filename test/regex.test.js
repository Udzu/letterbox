import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches } from "../src/patterns/index.js";
import { compile as compileAst } from "../src/patterns/compile.js";
import { mergeEquivalent, removeEpsilons, equivalent } from "../src/patterns/nfa.js";
import { toRegex, UNLIMITED } from "../src/patterns/regex.js";
import { randomAst, seededRandom } from "./helpers.js";

const regexOf = (pattern, limits) => toRegex(compile(pattern), limits).regex;

const TARGETS = [
  // [pattern, regex]: mostly the original's simplification tests
  ["a|b|b", "^[ab]$"],
  ["a*a*", "^a*$"],
  ["a*aa*", "^a+$"],
  ["(a*)*", "^a*$"],
  ["ab|ac", "^a[bc]$"],
  ["ab|ac|a", "^a[bc]?$"],
  ["ba|ca", "^[bc]a$"],
  ["ba|ca|a", "^[bc]?a$"],
  ["(a*b*c*)*", "^[a-c]*$"],
  ["(aa|a)*", "^a*$"],
  ["(a|b*)*", "^[ab]*$"],
  ["aa*", "^a+$"],
  ["a|aa|aaa", "^a{1,3}$"],
  ["(ab)*", "^(?:ab)*$"],
  ["(ab)*ab", "^(?:ab)+$"],
  ["colou?r", "^colou?r$"],
  ["(a|b)*a(a|b){12}", "^[ab]*a[ab]{12}$"],
  ["[a-z]{4}&!(.*[aeiou].*)", "^[b-df-hj-np-tv-z]{4}$"],
  ["the>^A+", "^t(?:A+h|hA)A*e$"],
  ["lo+l->o+", "^lo*l$"],
  ["(the|a)-.", "^(?:th)?$"],
  ["U+##w+", "^(?:Uw)+U?$"],
  // the NFA can read better than the DFA, even with as many states
  ["the<[a-z]*", "^[a-z]*the[a-z]*$"],
  ["the^[a-z]*", "^[a-z]*t[a-z]*h[a-z]*e[a-z]*$"],
  // a repeat merged with a repeat of itself
  ["[a-z]+&(..)+", "^(?:[a-z]{2})+$"],
  ["(abc){2}(abc)*", "^(?:abc){2,}$"],
  ["x(ab)*ab", "^x(?:ab)+$"],
  // special cases and escaping
  ["", "^$"],
  ["[]", "^(?!)$"],
  [".", "^[\\s\\S]$"],
  ["[^a]", "^[^a]$"],
  ["\\.\\*\\-\\/", "^\\.\\*-\\/$"],
  ["[\\-\\]x]", "^[\\-\\]x]$"],
  ["a\\nb\\t", "^a\\nb\\t$"],
  ["\\u{0}", "^\\x00$"],
  ["\\u{7f}\\u{200b}", "^\\x7f\\u{200b}$"],
  ["é😀", "^é😀$"],
];

for (const [pattern, regex] of TARGETS) {
  test(`regex ${JSON.stringify(pattern)}`, () => {
    assert.equal(regexOf(pattern), regex);
  });
}

test("equivalent patterns give the same regex", () => {
  const pairs = [
    ["(a|b)*", "(a*b*)*"],
    ["a|b|a", "[ab]"],
    ["!!(ab|c)", "ab|c"],
    ["a*&(aa)*", "(aa)*"],
    ["(ab|ac)", "a(b|c)"],
  ];
  for (const [p, q] of pairs) assert.equal(regexOf(p), regexOf(q), `${p} vs ${q}`);
});

const ALPHABET = ["a", "b", "c", "😀", "é", "\n"];
function randomStrings(rand, n) {
  return Array.from({ length: n }, () =>
    Array.from({ length: Math.floor(rand() * 7) }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join(""));
}

test("regexes agree with the patterns, as real JavaScript regexes", () => {
  const rand = seededRandom(51);
  let converted = 0;
  for (let i = 0; i < 400; i++) {
    const nfa = compileAst(randomAst(rand, 3, { chars: ["a", "b", "😀", "-", "]", "^", "\\", "/"], modifiers: true }));
    const result = toRegex(nfa);
    if (!result.regex) continue;
    converted++;
    const re = new RegExp(result.regex, "u");
    for (const s of randomStrings(rand, 40)) {
      assert.equal(re.test(s), matches(nfa, s), `${result.regex} on ${JSON.stringify(s)}`);
    }
  }
  assert.ok(converted > 350, `only ${converted} converted`);
});

test("limits", () => {
  const nfa = compile("(a|b)*a(a|b){5}");
  assert.deepEqual(toRegex(nfa, { dfaStates: 2000, states: 3, length: 2000 }), { tooComplex: "the automaton is too large" });
  assert.deepEqual(toRegex(nfa, { dfaStates: 2000, states: 200, length: 5 }), { tooComplex: "the result is too long" });
  // the DFA here is too large, but the NFA isn't
  assert.equal(toRegex(nfa, { dfaStates: 10, states: 200, length: 2000 }).regex, "^[ab]*a[ab]{5}$");
  assert.ok(toRegex(compile("[a-z]{8}^[a-z]{8}"), UNLIMITED).regex);
});

test("mergeEquivalent keeps the language", () => {
  const rand = seededRandom(53);
  for (let i = 0; i < 200; i++) {
    const g = removeEpsilons(compileAst(randomAst(rand, 3, { chars: ["a", "b"] })));
    const merged = mergeEquivalent(g);
    assert.ok(merged.size <= g.size);
    assert.ok(equivalent(g, merged));
  }
  assert.equal(mergeEquivalent(removeEpsilons(compile("(a|b)*a(a|b){3}"))).size, 5);
});
