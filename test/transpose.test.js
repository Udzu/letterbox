import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches, PatternError } from "../src/patterns/index.js";
import { compile as compileAst } from "../src/patterns/compile.js";
import { removeEpsilons } from "../src/patterns/nfa.js";
import { transpose } from "../src/patterns/transpose.js";
import { randomAst, seededRandom } from "./helpers.js";

function strings(alphabet, max) {
  const out = [""];
  for (let i = 0; i < out.length; i++) {
    if ([...out[i]].length < max) for (const c of alphabet) out.push(out[i] + c);
  }
  return out;
}

// the strings that swapping two characters (distance apart, or any) turns s into
function swaps(s, distance) {
  const cs = [...s];
  const out = [];
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      if (distance !== null && j - i !== distance) continue;
      const t = [...cs];
      [t[i], t[j]] = [t[j], t[i]];
      out.push(t.join(""));
    }
  }
  return out;
}

test("transposing words", () => {
  const adjacent = compile("(?t1:the)");
  for (const s of ["hte", "teh"]) assert.ok(matches(adjacent, s), s);
  for (const s of ["the", "eht", "th", "thee"]) assert.ok(!matches(adjacent, s), s);
  assert.ok(matches(compile("(?t2:the)"), "eht"));
  const any = compile("(?t:least)");
  for (const s of ["teasl", "sealt", "elast"]) assert.ok(matches(any, s), s);
  assert.ok(!matches(any, "steal"));
  // swapping equal letters gives the string itself
  assert.ok(matches(compile("(?t1:tool)"), "tool"));
  assert.ok(!matches(compile("(?t1:tool)&!tool"), "tool"));
});

test("transposition distances must be positive", () => {
  for (const p of ["(?t0:a)", "(?t-2:a)"]) assert.throws(() => compile(p), (e) => e instanceof PatternError && /at least 1/.test(e.message));
});

test("transposing random patterns", () => {
  const rand = seededRandom(11);
  const alphabet = ["a", "b", "é"];
  const all = strings(alphabet, 4);
  for (let i = 0; i < 150; i++) {
    const ast = randomAst(rand, 3, { chars: alphabet, modifiers: true });
    let inner;
    try {
      inner = compileAst(ast);
    } catch {
      continue;
    }
    for (const distance of [1, 2, null]) {
      const result = transpose(removeEpsilons(inner), distance);
      for (const s of all) {
        const expected = swaps(s, distance).some((t) => matches(inner, t));
        assert.equal(matches(result, s), expected, `(?t${distance ?? ""}:${JSON.stringify(ast)}) on ${s}`);
      }
    }
  }
});
