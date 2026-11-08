import { test } from "node:test";
import assert from "node:assert/strict";
import { compile as compileAst } from "../src/patterns/compile.js";
import { compile, PatternError } from "../src/patterns/index.js";
import { determinize, equivalent, intersect, matches, minimize, removeEpsilons, reverse, withStateLimit } from "../src/patterns/nfa.js";
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

test("ignoring case throughout is like wrapping the pattern in (?i:...)", () => {
  const words = wordsAutomaton(WORDS);
  const caseless = (p) => compile(p, { words, caseless: true });
  for (const [p, yes, no] of [
    ["@", ["cat", "CATS", "Dog", "BIG cat"], ["cow", "big"]],
    ["@&c.*", ["Cat", "CATS"], ["dog", "ACT"]],
    ["(?<v>a)(?&v)b", ["aAb", "AaB"], ["ab"]],
    ["!a", ["b", "aa"], ["a", "A"]],
    ["\\W", ["-"], ["k", "K", "ſ"]],
  ]) {
    for (const s of yes) assert.ok(matches(caseless(p), s), `${p} should match ${s} ignoring case`);
    for (const s of no) assert.ok(!matches(caseless(p), s), `${p} shouldn't match ${s} ignoring case`);
    assert.ok(equivalent(caseless(p), compile(`(?i:${p})`, { words })), p);
  }
  // errors still point at what was typed
  assert.throws(() => compile("ab(", { caseless: true }), (e) => e instanceof PatternError && e.span[0] === 2);
});

test("ignoring accents throughout is like wrapping the pattern in (?d:...)", () => {
  const words = wordsAutomaton(["Dvořák", "café", "Łódź", "cat", "Straße"]);
  const accentless = (p, caseless = false) => compile(p, { words, accentless: true, caseless });
  for (const [p, yes, no] of [
    ["@", ["Dvorak", "Dvořak", "cafe", "Lodz", "cât", "Straße"], ["dvorak", "Strasse", "cafe!"]],
    ["@&.*a.*", ["Dvorak", "cåt"], ["Lodz"]],
    ["(?<v>e)(?&v)", ["eé", "ëe"], ["e"]],
  ]) {
    for (const s of yes) assert.ok(matches(accentless(p), s), `${p} should match ${s} ignoring accents`);
    for (const s of no) assert.ok(!matches(accentless(p), s), `${p} shouldn't match ${s} ignoring accents`);
    assert.ok(equivalent(accentless(p), compile(`(?d:${p})`, { words })), p);
    assert.ok(equivalent(accentless(p, true), compile(`(?i:(?d:${p}))`, { words })), p);
  }
  assert.ok(matches(accentless("@", true), "DVORAK"));
  assert.ok(!matches(accentless("@"), "DVORAK"));
});

test("the word list ignoring case is made once, and is deterministic", () => {
  const words = wordsAutomaton(WORDS);
  const once = compile("@", { words, caseless: true });
  assert.equal(compile("@", { words, caseless: true }), once);
  assert.equal(compile("(?i:@)", { words }), once);
  assert.ok(once.isDeterministic());
  assert.equal(determinize(once), once);
  // and likewise ignoring accents, or both, which are cached separately
  const accentless = compile("@", { words, accentless: true });
  assert.equal(compile("(?d:@)", { words }), accentless);
  assert.notEqual(accentless, once);
  assert.ok(accentless.isDeterministic());
  const both = compile("(?d:(?i:@))", { words });
  assert.equal(compile("(?i:(?d:@))", { words }), both);
  assert.equal(compile("@", { words, caseless: true, accentless: true }), both);
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
