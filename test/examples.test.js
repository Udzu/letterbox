import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches } from "../src/patterns/index.js";
import { compile as compileAst } from "../src/patterns/compile.js";
import { examples, pickChar } from "../src/patterns/examples.js";
import { CharSet } from "../src/patterns/charset.js";
import { randomAst, seededRandom } from "./helpers.js";

function check(pattern, options = {}) {
  const nfa = compile(pattern);
  const result = examples(nfa, { random: seededRandom(1), ...options });
  for (const s of result.examples) {
    assert.ok(matches(nfa, s), `${JSON.stringify(s)} should match ${pattern}`);
    assert.ok(!/[\n\r]/.test(s), `${JSON.stringify(s)} contains a line break`);
    assert.notEqual(s, "");
  }
  assert.equal(new Set(result.examples).size, result.examples.length, "duplicates");
  return result;
}

test("examples match and are distinct", () => {
  for (const pattern of [
    "[^a]*", ".", "(.|..)*", "(a|b|c|d|e|f|g)*x", "[a-z]{3,8}", "o+<l+",
    "the^A+", "Madrid-^..", "!(.*a.*)", ".{3}&.*e.*", "[\\u{4e00}-\\u{9fff}]+", "[a-z]{1000}",
  ]) {
    const { examples: found } = check(pattern);
    assert.equal(found.length, 5, pattern);
  }
});

test("the first example is a shortest one", () => {
  assert.equal(check("a+b+").examples[0], "ab");
  assert.equal(check("(cat|horse|ox)s?").examples[0], "ox");
  assert.equal(check("[a-z]{1000}").examples[0].length, 1000);
  // the empty string isn't shown, so a shortest non-empty one comes first instead
  assert.equal(check("(he)*").examples[0], "he");
  assert.equal(check("x?(abc|de)?").examples[0], "x");
  assert.equal(check("(a{3})*").examples[0], "aaa");
});

test("finite and empty languages", () => {
  assert.deepEqual(check("a|b|c").examples.sort(), ["a", "b", "c"]);
  assert.deepEqual(check("their|her|his|xyr").examples.sort(), ["her", "his", "their", "xyr"]);
  assert.deepEqual(check("[]"), { examples: [], matchesEmpty: false });
  assert.deepEqual(check("a&b"), { examples: [], matchesEmpty: false });
  assert.deepEqual(check(""), { examples: [], matchesEmpty: true });
  assert.equal(check("a*").matchesEmpty, true);
  assert.equal(check("a+").matchesEmpty, false);
});

test("examples avoid what can't be shown", () => {
  assert.deepEqual(check("a\\nb").examples, []); // needs a line break
  assert.deepEqual(check("a(\\n|b)").examples, ["ab"]);
  // e + combining acute normalises to é, which doesn't match, so it must be filtered out
  for (const s of check(".\\u{301}").examples) assert.equal([...s].length, 2);
});

test("existing strings are excluded", () => {
  assert.deepEqual(check("a|b|c", { exclude: new Set(["a", "c"]) }).examples, ["b"]);
});

test("characters come from readable pools", () => {
  const rand = seededRandom(2);
  for (let i = 0; i < 50; i++) {
    assert.match(String.fromCodePoint(pickChar(CharSet.ALL, rand)), /^[a-z]$/);
    assert.match(String.fromCodePoint(pickChar(CharSet.of(97).complement(), rand)), /^[b-z]$/);
  }
  // other large sets show their variety, including characters outside the pools
  const picked = Array.from({ length: 200 }, () => String.fromCodePoint(pickChar(CharSet.from([[65, 90], [0x4e00, 0x9fff]]), rand)));
  assert.ok(picked.every((c) => /^[A-Z\u4e00-\u9fff]$/.test(c)));
  assert.ok(picked.some((c) => /^[A-Z]$/.test(c)) && picked.some((c) => /^[\u4e00-\u9fff]$/.test(c)));
  const upper = compile("\\p{Lu}").edges.flat().find((e) => e.label).label;
  const capitals = new Set(Array.from({ length: 300 }, () => pickChar(upper, rand)));
  assert.ok([...capitals].some((cp) => cp > 0x7f), "some non-ASCII capitals");
  assert.ok([...capitals].some((cp) => cp < 0x7f), "and some ASCII ones");
  assert.ok([...capitals].every((cp) => upper.has(cp)));
  // explicitly mentioned characters are preferred some of the time
  const cs = new Set(check("c.t", { count: 30 }).examples.map((s) => s[1]));
  assert.ok(cs.has("c") || cs.has("t"));
  assert.ok([...cs].some((c) => c !== "c" && c !== "t"));
});

test("same seed, same examples", () => {
  const nfa = compile("[a-z]+(ing|ed)");
  assert.deepEqual(examples(nfa, { random: seededRandom(9) }), examples(nfa, { random: seededRandom(9) }));
});

test("random patterns give matching examples quickly", () => {
  const rand = seededRandom(31);
  const start = performance.now();
  for (let i = 0; i < 300; i++) {
    const nfa = compileAst(randomAst(rand, 3, { chars: ["a", "b", "😀"], modifiers: true }));
    for (const s of examples(nfa, { random: rand }).examples) assert.ok(matches(nfa, s));
  }
  assert.ok(performance.now() - start < 5000, "too slow");
});
