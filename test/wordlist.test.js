import { test } from "node:test";
import assert from "node:assert/strict";
import { compile as compileAst } from "../src/patterns/compile.js";
import { compile, PatternError } from "../src/patterns/index.js";
import { determinize, intersect, matches, minimize, removeEpsilons, reverse, withStateLimit } from "../src/patterns/nfa.js";
import { matcher, parseWords, wordsAutomaton } from "../src/patterns/wordlist.js";
import { randomAst, seededRandom } from "./helpers.js";

test("parseWords", () => {
  assert.deepEqual(parseWords("cat\ndog\r\n\nbig cat\n cat \ncat\n"), ["cat", "dog", "big cat", " cat "]);
  assert.deepEqual(parseWords("café\ncafé"), ["café"]); // normalised, then deduplicated
  assert.deepEqual(parseWords(""), []);
  assert.deepEqual(parseWords("\r\n\r\n"), []);
});

test("parseWords skips # lines at the top, but not later", () => {
  assert.deepEqual(parseWords("# note\r\n\r\n# more\ncat\n#tag\n"), ["cat", "#tag"]);
  assert.deepEqual(parseWords("cat\n# not a comment\n"), ["cat", "# not a comment"]);
  assert.deepEqual(parseWords("# only a note\n"), []);
});

test("matcher agrees with matches", () => {
  const rand = seededRandom(29);
  const alphabet = ["a", "b", "é", "😀"];
  const strings = Array.from({ length: 200 }, () =>
    Array.from({ length: Math.floor(rand() * 7) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join(""));
  for (let i = 0; i < 300; i++) {
    const nfa = compileAst(randomAst(rand, 3, { chars: ["a", "b", "😀"], modifiers: true }));
    const test = matcher(nfa);
    // twice, so the second pass uses the remembered DFA states
    for (let pass = 0; pass < 2; pass++) {
      for (const s of strings) assert.equal(test(s), matches(nfa, s), JSON.stringify(s));
    }
  }
});

const WORDS = ["cat", "cats", "act", "acts", "tac", "dog", "god", "dogs", "do", "a", "big cat", "Cat", "😀s"];

test("wordsAutomaton is the minimal DFA of the words", () => {
  const w = wordsAutomaton(WORDS);
  assert.ok(w.isDeterministic());
  for (const word of WORDS) assert.ok(matches(w, word), word);
  for (const s of ["", "ca", "catss", "dogss", "big", "CAT", "😀"]) assert.ok(!matches(w, s), s);
  assert.equal(w.size, minimize(w).size);
  assert.equal(wordsAutomaton([]).accepting.size, 0);
  const rand = seededRandom(31);
  for (let i = 0; i < 50; i++) {
    const words = Array.from({ length: 1 + Math.floor(rand() * 30) }, () =>
      Array.from({ length: Math.floor(rand() * 5) }, () => "abc"[Math.floor(rand() * 3)]).join(""));
    const w = wordsAutomaton(words);
    assert.equal(w.size, minimize(w).size, words.join(","));
    for (const word of words) assert.ok(matches(w, word));
  }
});

test("@ matches the word list", () => {
  const words = wordsAutomaton(WORDS);
  const yes = (p, s) => assert.ok(matches(compile(p, { words }), s), `${p} should match ${s}`);
  const no = (p, s) => assert.ok(!matches(compile(p, { words }), s), `${p} shouldn't match ${s}`);
  yes("@", "cat");
  no("@", "CAT");
  yes("(?i:@)", "CAT");
  yes("@&(?r:@)", "dog");
  no("@&(?r:@)", "cats");
  yes("@&(@-.)", "cat");
  no("@&(@-.)", "tac");
  yes("@ @", "dog cat");
  yes("@{2}", "doga");
  yes("!@", "cow");
  no("!@", "cat");
  yes("\\@", "@");
  yes("(?R1:@)&@", "tac"); // cat rotated right by 1
  assert.throws(() => compile("a|@"), (e) => e instanceof PatternError && /No word list loaded/.test(e.message) && e.span[0] === 2);
});

test("the word list's automaton is reused rather than determinised again", () => {
  const words = wordsAutomaton(WORDS);
  assert.equal(compile("@", { words }), words);
  assert.equal(determinize(words), words);
  // complementing it only adds a dead state, and still gives the right answers
  const yes = (p, s) => assert.ok(matches(compile(p, { words }), s), `${p} should match ${s}`);
  const no = (p, s) => assert.ok(!matches(compile(p, { words }), s), `${p} shouldn't match ${s}`);
  yes("[a-z]+&!@", "cow");
  no("[a-z]+&!@", "cat");
  yes("@&!(c.*)", "dog");
  no("@&!(c.*)", "cat");
  yes("@&@", "cat");
  // ε-free versions are remembered
  const nfa = compile("@ @", { words });
  assert.equal(removeEpsilons(nfa), removeEpsilons(nfa));
});

test("intersect only builds pairs that share a character", () => {
  // the reversed list is nondeterministic, which made the product huge before
  const w = wordsAutomaton(WORDS);
  const both = withStateLimit(100, () => intersect(w, reverse(w)));
  for (const word of ["a", "god", "dog", "tac", "cat"]) assert.ok(matches(both, word), word);
  assert.ok(!matches(both, "cats"));
});
