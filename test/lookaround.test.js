import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches, PatternError } from "../src/patterns/index.js";
import { seededRandom } from "./helpers.js";

// At the top level, lookarounds mean what they do in JavaScript (and PCRE), anchored at both
// ends. The patterns here use the same syntax in both.
const SAME_AS_JS = [
  "(?=.*a)(?=.*b)[a-c]+",
  "(?!.*ab)[a-c]*",
  "[a-c]*(?<=ab)",
  "[a-c]*(?<!b)",
  "a(?=b)[a-c]*",
  "[a-c](?!a)[a-c]",
  "(?<=a)",
  "a(?<=a)b(?<!bb)c*",
  "(?=a|bb)(?!b)[a-c]{1,3}",
  "[a-c]+(?<=a[a-c])(?=)",
];

function randomStrings(rand, n) {
  return Array.from({ length: n }, () =>
    Array.from({ length: Math.floor(rand() * 6) }, () => "abc"[Math.floor(rand() * 3)]).join(""));
}

test("top-level lookarounds agree with JavaScript", () => {
  const rand = seededRandom(17);
  for (const pattern of SAME_AS_JS) {
    const nfa = compile(pattern);
    const re = new RegExp(`^(?:${pattern})$`, "su");
    for (const s of ["", ...randomStrings(rand, 300)]) {
      assert.equal(matches(nfa, s), re.test(s), `${pattern} on ${JSON.stringify(s)}`);
    }
  }
});

test("lookarounds only see their own sequence", () => {
  // in PCRE the lookahead would see the b after the group, so at the end of a group it's
  // an error (see the parser tests)
  assert.ok(matches(compile("a(?=b)b"), "ab"));
  assert.throws(() => compile("(a(?=b))b"), PatternError);
  assert.ok(!matches(compile("b(?<=ab)"), "ab") && !matches(compile("a(b(?<=ab))"), "ab"));
  // operands of other operators are sequences of their own
  assert.ok(matches(compile("(?=.*a).*<xx"), "xbax"));
  assert.ok(!matches(compile("(?=.*a).*<xx"), "xbbx"));
  assert.ok(matches(compile("(?r:(?=ab).*)"), "cba"));
});

// Word boundaries, also as in JavaScript at the top level. The strings here include spaces,
// so there are non-word characters for \b to find.
const BOUNDARIES_SAME_AS_JS = [
  "\\b[a ]*",
  "[a ]*\\b",
  "[a ]*\\b[a ]*",
  "[a ]*\\B[a ]*",
  "a\\b[a ]*\\Ba",
  "\\B[a ]+\\b",
  "[a ]*\\b a\\b[a ]*",
];

test("word boundaries agree with JavaScript", () => {
  const rand = seededRandom(23);
  for (const pattern of BOUNDARIES_SAME_AS_JS) {
    const nfa = compile(pattern);
    const re = new RegExp(`^(?:${pattern})$`, "su");
    for (let i = 0; i < 300; i++) {
      const s = Array.from({ length: Math.floor(rand() * 6) }, () => "a "[Math.floor(rand() * 2)]).join("");
      assert.equal(matches(nfa, s), re.test(s), `${pattern} on ${JSON.stringify(s)}`);
    }
  }
});

test("word boundaries only see their own sequence", () => {
  assert.ok(matches(compile(".*\\bcat.*"), "the cat"));
  assert.ok(!matches(compile(".*\\bcat.*"), "concat"));
  assert.ok(matches(compile("x \\b(cat|dog)"), "x dog"));
  assert.ok(!matches(compile("x\\b(cat|dog)"), "xdog"));
  // inside a group, it only sees the parts of the group either side of it
  assert.ok(matches(compile("(a\\b b)x"), "a bx"));
});

test("lookarounds with modifiers and names", () => {
  assert.ok(matches(compile("(?i:(?=.*A)[a-z]+)"), "cat"));
  // a vowel not followed by another
  const vowels = compile("(?<v>[aeiou])(?!(?&v))[a-z]");
  assert.ok(matches(vowels, "ab"));
  assert.ok(!matches(vowels, "ae"));
});
