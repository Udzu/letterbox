import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches } from "../src/patterns/index.js";
import { equivalent } from "../src/patterns/nfa.js";
import { format } from "../src/patterns/parser.js";
import { randomAst, seededRandom } from "./helpers.js";

const same = (p, q) => assert.ok(equivalent(compile(p), compile(q)), `${p} ≡ ${q}`);

test("named patterns match the pattern again, not the same text", () => {
  const nfa = compile("(?<c>[^aeiou])(?<v>[aeiou])(?&c)");
  for (const s of ["cat", "dog", "tot"]) assert.ok(matches(nfa, s), s);
  for (const s of ["ewe", "ca", "cats"]) assert.ok(!matches(nfa, s), s);
  same("(?<v>[aeiou]){0}(?<c>[^aeiou]){0}(?&c)(?&v)(?&c)", "[^aeiou][aeiou][^aeiou]");
  same("(?&v)x(?<v>ab|c)", "(ab|c)x(ab|c)");
  same("(?<a>(?<b>x|y)(?&b))(?&a)", "(x|y){4}");
});

test("modifiers apply where a name is defined", () => {
  same("(?i:(?<v>a))(?&v)", "[aA]{2}");
  same("(?<v>a)(?i:(?&v))", "aa");
  same("(?r:(?<v>ab))(?&v)", "baab");
  same("(?w:(?<s>L)R(?&s)/ab/x)", "axb");
});

test("naming a pattern doesn't change what it matches", () => {
  // (?<v>A){0}B(?&v)(?&v) is the same as B(A)(A), for random A and B
  const rand = seededRandom(37);
  for (let i = 0; i < 100; i++) {
    const a = format(randomAst(rand, 2, { chars: ["a", "b"], modifiers: true, shorthands: true }));
    const b = format(randomAst(rand, 2, { chars: ["a", "b"], modifiers: true }));
    same(`(?<v>${a}){0}(${b})(?&v)(?&v)`, `(${b})(${a})(${a})`);
    same(`(?<v>${a})&(?&v)`, a);
    same(`!(?<v>${a})|(?&v)`, ".*");
  }
});
