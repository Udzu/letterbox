import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES, HEADINGS, bounds, clean, expand, parseAngle, parseRules, trace } from "../src/lsystems/lsystem.js";

const rules = (...rows) => parseRules(rows.map(([symbol, output, weight = ""]) => ({ symbol, output, weight }))).rules;

test("parseRules groups rules by symbol, with default weights", () => {
  const { rules, errors } = parseRules([
    { symbol: "F", output: "F+F", weight: "" },
    { symbol: " ", output: " ", weight: "" }, // blank row
    { symbol: "F", output: "F - F", weight: "2.5" },
    { symbol: "X", output: "", weight: "" },
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(rules.get("F"), { outputs: ["F+F", "F-F"], weights: [1, 2.5] });
  assert.deepEqual(rules.get("X"), { outputs: [""], weights: [1] });
});

test("parseRules reports bad rows", () => {
  const { errors } = parseRules([
    { symbol: "", output: "F", weight: "" },
    { symbol: "FF", output: "F", weight: "" },
    { symbol: "F", output: "F", weight: "0" },
    { symbol: "F", output: "F", weight: "x" },
    { symbol: "🌲", output: "F", weight: "" },
  ]);
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^Rule 1 has no symbol/);
  assert.match(errors[1], /^Rule 2: .*single character/);
  assert.match(errors[2], /^Rule 3: .*positive/);
});

test("parseAngle", () => {
  assert.equal(parseAngle("4"), 4);
  assert.equal(parseAngle(" 14.4 "), 14.4);
  assert.equal(parseAngle(""), null);
  assert.equal(parseAngle("0"), null);
  assert.equal(parseAngle("-3"), null);
  assert.equal(parseAngle("abc"), null);
});

test("clean removes whitespace", () => {
  assert.equal(clean(" F + F\t- F "), "F+F-F");
});

test("expand applies rules and keeps constants", () => {
  const r = rules(["A", "AB"], ["B", "A"]);
  assert.deepEqual(expand("A", r, 0), { result: "A", iterations: 0 });
  assert.deepEqual(expand("A", r, 4), { result: "ABAABABA", iterations: 4 });
  assert.equal(expand("A+C", r, 1).result, "AB+C");
  assert.equal(expand("FX", rules(["F", ""], ["X", "-FX++FY-"]), 1).result, "-FX++FY-");
});

test("expand chooses between rules by weight", () => {
  const r = rules(["F", "a", "1"], ["F", "b", "3"]);
  assert.equal(expand("F", r, 1, { random: () => 0.2 }).result, "a");
  assert.equal(expand("F", r, 1, { random: () => 0.3 }).result, "b");
  assert.equal(expand("F", r, 1, { random: () => 0.999 }).result, "b");
  const values = [0, 0.5];
  assert.equal(expand("FF", r, 1, { random: () => values.shift() }).result, "ab");
});

test("expand stops before exceeding the limit", () => {
  const r = rules(["F", "FF"]);
  assert.deepEqual(expand("F", r, 10, { limit: 100 }), { result: "F".repeat(64), iterations: 6 });
  assert.deepEqual(expand("F", r, 6, { limit: 64 }), { result: "F".repeat(64), iterations: 6 });
});

test("expand handles symbols outside the BMP", () => {
  assert.equal(expand("🌲x", rules(["🌲", "F🌲"]), 2).result, "FF🌲x");
});

test("trace turns clockwise on screen with +, and uses the stack", () => {
  const lines = [];
  const round = (n) => Math.round(n * 1e9) / 1e9 + 0;
  const count = trace("F+F[-G-F]F]", 4, HEADINGS.right, (...xy) => lines.push(xy.map(round)));
  assert.equal(count, 4);
  assert.deepEqual(lines, [
    [0, 0, 1, 0], // right
    [1, 0, 1, 1], // + turns clockwise: down, as y points down
    [2, 1, 2, 0], // G moved right without drawing, then - turned to face up
    [1, 1, 1, 2], // ] returned to (1, 1) facing down; the extra ] is ignored
  ]);
});

test("bounds covers drawn lines only", () => {
  const box = bounds("GGF", 4, HEADINGS.up);
  assert.deepEqual(Object.values(box).map((n) => Math.round(n * 1e9) / 1e9 + 0), [0, -3, 0, -2, 1]);
  assert.equal(bounds("G+G", 4, 0), null);
});

test("examples are valid and draw something", () => {
  for (const example of EXAMPLES) {
    const { rules, errors } = parseRules(example.rules);
    assert.deepEqual(errors, [], example.name);
    assert.ok(parseAngle(example.angle), example.name);
    const { result, iterations } = expand(example.axiom, rules, example.iterations);
    assert.equal(iterations, example.iterations, example.name);
    assert.ok(bounds(result, parseAngle(example.angle), HEADINGS[example.heading]), example.name);
  }
});
