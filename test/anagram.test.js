import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches, PatternError } from "../src/patterns/index.js";
import { compile as compileAst } from "../src/patterns/compile.js";
import { anagram } from "../src/patterns/anagram.js";
import { matchLengths } from "../src/patterns/lengths.js";
import { randomAst, seededRandom } from "./helpers.js";

const sorted = (s) => [...s].sort().join("");

// all strings over the alphabet up to the given length
function strings(alphabet, max) {
  const out = [""];
  for (let i = 0; i < out.length; i++) {
    if ([...out[i]].length < max) for (const c of alphabet) out.push(out[i] + c);
  }
  return out;
}

test("anagrams of words", () => {
  const nfa = compile("(?a:listen)");
  for (const s of ["listen", "silent", "enlist", "tinsel", "inlets"]) assert.ok(matches(nfa, s), s);
  for (const s of ["", "list", "listens", "silents", "lisstn"]) assert.ok(!matches(nfa, s), s);
  assert.equal(nfa.size, 66); // the 64 counts, plus the states compile adds around it
});

test("anagrams with classes and alternatives", () => {
  const vowels = compile("(?a:[aeiou]{2}t)");
  for (const s of ["eat", "tea", "ate", "oot", "tai"]) assert.ok(matches(vowels, s), s);
  for (const s of ["ett", "eatt", "tt", "et"]) assert.ok(!matches(vowels, s), s);
  const either = compile("(?a:ab|ccc)");
  for (const s of ["ab", "ba", "ccc"]) assert.ok(matches(either, s), s);
  for (const s of ["abc", "cc", "a"]) assert.ok(!matches(either, s), s);
  assert.ok(matches(compile("(?a:)"), ""));
  assert.ok(!matches(compile("(?a:[])"), ""));
  assert.ok(matches(compile("(?i:(?a:Ab))"), "BA"));
});

test("sub-anagrams and other idioms", () => {
  const sub = compile("(?a:listen-^.*)");
  for (const s of ["", "list", "silent", "nest", "tin"]) assert.ok(matches(sub, s), s);
  for (const s of ["lists", "tent", "silents"]) assert.ok(!matches(sub, s), s);
  const containing = compile("(?a:cat)^.*");
  for (const s of ["tack", "attic", "cat"]) assert.ok(matches(containing, s), s);
  for (const s of ["tick", "ca"]) assert.ok(!matches(containing, s), s);
});

test("anagrams of an infinite pattern are an error", () => {
  assert.throws(() => compile("x(?a:ab*)"), (e) => e instanceof PatternError && /finitely many/.test(e.message) && e.span[0] === 1 && e.span[1] === 9);
  assert.throws(() => compile("(?a:!a)"), PatternError);
});

test("anagrams of random finite patterns", () => {
  const rand = seededRandom(3);
  const alphabet = ["a", "b", "é"];
  const all = strings(alphabet, 4);
  let checked = 0;
  for (let i = 0; i < 400 && checked < 100; i++) {
    const ast = randomAst(rand, 3, { chars: alphabet, modifiers: true });
    let inner;
    try {
      inner = compileAst(ast);
    } catch {
      continue;
    }
    const { max } = matchLengths(inner);
    if (max === null || max > 4) continue;
    const result = anagram(inner);
    assert.ok(result);
    const keys = new Set(all.filter((s) => matches(inner, s)).map(sorted));
    for (const s of all) assert.equal(matches(result, s), keys.has(sorted(s)), `anagram of ${JSON.stringify(ast)} on ${s}`);
    checked++;
  }
  assert.ok(checked >= 50, `only ${checked} checked`);
});

test("anagrams with too many states", () => {
  assert.throws(() => compile("(?a:abcdefghijklmnopqrstuvwxyz)"), /too complex/);
});
