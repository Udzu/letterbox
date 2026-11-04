import { test } from "node:test";
import assert from "node:assert/strict";
import { compile as compileAst } from "../src/patterns/compile.js";
import { matches } from "../src/patterns/nfa.js";
import { matcher, parseWords } from "../src/patterns/wordlist.js";
import { randomAst, seededRandom } from "./helpers.js";

test("parseWords", () => {
  assert.deepEqual(parseWords("cat\ndog\r\n\nbig cat\n cat \ncat\n"), ["cat", "dog", "big cat", " cat "]);
  assert.deepEqual(parseWords("café\ncafé"), ["café"]); // normalised, then deduplicated
  assert.deepEqual(parseWords(""), []);
  assert.deepEqual(parseWords("\r\n\r\n"), []);
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
