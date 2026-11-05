import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches } from "../src/patterns/index.js";
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
  // in PCRE the lookahead would see the b after the group
  assert.ok(matches(compile("a(?=b)b"), "ab"));
  assert.ok(!matches(compile("(a(?=b))b"), "ab"));
  assert.ok(!matches(compile("b(?<=ab)"), "ab") && !matches(compile("a(b(?<=ab))"), "ab"));
  // operands of other operators are sequences of their own
  assert.ok(matches(compile("(?=.*a).*<xx"), "xbax"));
  assert.ok(!matches(compile("(?=.*a).*<xx"), "xbbx"));
  assert.ok(matches(compile("(?r:(?=ab).*)"), "cba"));
});

test("lookarounds with modifiers and names", () => {
  assert.ok(matches(compile("(?i:(?=.*A)[a-z]+)"), "cat"));
  // a vowel not followed by another
  const vowels = compile("(?<v>[aeiou])(?!(?&v))[a-z]");
  assert.ok(matches(vowels, "ab"));
  assert.ok(!matches(vowels, "ae"));
});
