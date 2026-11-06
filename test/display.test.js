import { test } from "node:test";
import assert from "node:assert/strict";
import { CharSet, MAX_CP } from "../src/patterns/charset.js";
import { formatLabel, shortLabel, toDot } from "../src/patterns/display.js";
import { compile } from "../src/patterns/index.js";

const cp = (c) => c.codePointAt(0);
const range = (a, b) => [cp(a), cp(b)];

test("formatLabel", () => {
  assert.equal(formatLabel(CharSet.ALL), ".");
  assert.equal(formatLabel(CharSet.of(cp("a"))), "a");
  // single characters aren't escaped, except a dot, which would look like anything
  assert.equal(formatLabel(CharSet.of(cp("*"))), "*");
  assert.equal(formatLabel(CharSet.of(cp("-"))), "-");
  assert.equal(formatLabel(CharSet.of(cp("\\"))), "\\");
  assert.equal(formatLabel(CharSet.of(cp("."))), "[.]");
  assert.equal(formatLabel(CharSet.of(cp(" "))), "␣");
  assert.equal(formatLabel(CharSet.of(cp("␣"))), "\\u{2423}");
  assert.equal(formatLabel(CharSet.of(0x0a)), "\\n");
  assert.equal(formatLabel(CharSet.of(cp("a"), cp("e"))), "[ae]");
  assert.equal(formatLabel(CharSet.from([range("a", "b")])), "[ab]");
  assert.equal(formatLabel(CharSet.from([range("a", "z")])), "[a-z]");
  assert.equal(formatLabel(CharSet.of(cp("a")).complement()), "[^a]");
  assert.equal(formatLabel(CharSet.from([range("a", "z")]).complement()), "[^a-z]");
  assert.equal(formatLabel(CharSet.of(cp("-"), cp("]"))), "[\\-\\]]");
  assert.equal(formatLabel(CharSet.from([[0, 5]])), "[\\u{0}-\\u{5}]");
  assert.equal(formatLabel(CharSet.of(MAX_CP)), "\\u{10ffff}");
  assert.equal(formatLabel(CharSet.of(0x301)), "\\u{301}"); // lone combining accent
  assert.equal(formatLabel(CharSet.of(cp("é"), cp("😀"))), "[é😀]");
});

test("toDot", () => {
  const dot = toDot(compile("a|"));
  assert.match(dot, /^digraph \{/);
  assert.match(dot, /start -> 0;/);
  assert.match(dot, /-> \d+ \[label="a"\];/);
  assert.match(dot, /label="ε", style=dashed/);
  assert.match(dot, /\d+ \[shape=doublecircle/);
  // quotes and backslashes in labels are escaped for DOT
  assert.ok(toDot(compile('\\"')).includes(String.raw`label="\""`));
  assert.ok(toDot(compile("\\\\")).includes(String.raw`label="\\"`));
});

test("shortLabel", () => {
  assert.equal(shortLabel("[a-z]"), "[a-z]");
  const long = formatLabel(compile("\\p{Lu}").edges.flat().find((e) => e.label).label);
  assert.ok(long.length > 100);
  const short = shortLabel(long);
  assert.ok([...short].length <= 24 && short.startsWith("[A-Z") && short.endsWith("…]"), short);
  // escapes are never split
  assert.equal(shortLabel("[\\t-\\r \\xa0\\u{1680}\\u{2000}-\\u{200a}\\u{2028}]"), "[\\t-\\r \\xa0\\u{1680}…]");
  assert.equal(shortLabel("[abcdefghijklmnopqrst\\\\uvwxyz]"), "[abcdefghijklmnopqrst…]");
  // long labels are shortened in the diagram, with the full label as a tooltip
  const dot = toDot(compile("\\p{Lu}"));
  assert.ok(dot.includes(`label="${short}", tooltip="`), dot);
  assert.ok(!toDot(compile("[a-z]")).includes("tooltip"));
});
