import { test } from "node:test";
import assert from "node:assert/strict";
import { ExprError, evaluate, parse, toHTML } from "../src/numbers/expr.js";
import { solve, solveSteps } from "../src/numbers/solver.js";

const ALL_OPS = { concat: true, pow: true, fact: true, sqrt: true, root: true, dot: true, rec: true };
const FOURS = { numbers: [4, 4, 4, 4], rules: { all: true }, ops: ALL_OPS };
const value = (text, puzzle = FOURS) => evaluate(parse(text), puzzle);
const error = (text, puzzle = FOURS) => {
  try {
    value(text, puzzle);
  } catch (e) {
    if (e instanceof ExprError) return e.message;
    throw e;
  }
  return null;
};

test("evaluates the four fours examples exactly", () => {
  assert.deepEqual(value("4/.4~*4/4"), [9, 1]);
  assert.deepEqual(value(".4V4*4/4"), [32, 1]);
  assert.deepEqual(value("VVV(4^4!)*4/4"), [64, 1]);
  assert.deepEqual(value("44/.44~"), [99, 1]);
  assert.deepEqual(value("4.4~*4-4"), [124, 9]);
});

test("parses precedence: ! then roots then ^ (right to left) then unary minus", () => {
  const p = { numbers: [2, 3, 2, 3, 4], rules: {}, ops: ALL_OPS };
  assert.deepEqual(value("2^3^2", p), [512, 1]);
  assert.deepEqual(value("-2^2", p), [-4, 1]);
  assert.deepEqual(value("V4^3", p), [8, 1]); // (√4)³
  assert.deepEqual(value("3!^2", p), [36, 1]);
  assert.deepEqual(value("2V4^3", p), [8, 1]); // (²√4)³
  assert.equal(error("2V3!^2", p), "Root is irrational"); // (²√(3!))², not ²√(3!²)
  assert.deepEqual(value("2^-2", p), [1, 4]);
  assert.deepEqual(value("2 × 3 − 2 ÷ 3", p), [16, 3]);
});

test("checks the numbers used", () => {
  assert.equal(error("4+4"), "All the numbers must be used");
  assert.equal(error("4+4+4+4+4"), "Uses numbers that aren't available");
  assert.equal(error("45*4/4"), "45 isn't made from the numbers");
  const ordered = { numbers: [1, 2, 3], rules: { order: true, all: true }, ops: ALL_OPS };
  assert.deepEqual(value("12+3", ordered), [15, 1]);
  assert.equal(error("21+3", ordered), "The numbers must be used in order");
  assert.equal(error("1+(3-2)", ordered), "The numbers must be used in order");
  // a box with 44 can be used as is, even without concatenation
  assert.deepEqual(value("44+4", { numbers: [44, 4], rules: {}, ops: {} }), [48, 1]);
  assert.equal(error("44+4", { numbers: [4, 4, 4], rules: {}, ops: {} }), "Concatenation isn't allowed");
  // decimal points only between numbers
  assert.equal(error("2.5", { numbers: [25], rules: {}, ops: ALL_OPS }), "2.5 isn't made from the numbers");
  assert.deepEqual(value("2.5", { numbers: [2, 5], rules: {}, ops: ALL_OPS }), [5, 2]);
});

test("checks the rules and operations", () => {
  assert.equal(error("V8*V2", { numbers: [8, 2], rules: {}, ops: ALL_OPS }), "Square root is irrational");
  assert.equal(error("4/.4*4/4", { ...FOURS, ops: { ...ALL_OPS, dot: false } }), "Decimals aren't allowed");
  assert.equal(error("4!+4-4-4", { ...FOURS, ops: {} }), "! isn't allowed");
  assert.equal(error("(4+4+4)/4", { ...FOURS, rules: { integers: true } }), null);
  assert.equal(error("4/(4+4)*4", { ...FOURS, rules: { integers: true } }), "Fractions aren't allowed");
  assert.equal(error("4/(4-4)+4"), "Division by zero");
  assert.equal(error("4^4^4^4"), "Too large to calculate exactly");
  assert.deepEqual(value("VVV(((4+4!)/4)^4!)"), [343, 1]);
});

test("renders maths", () => {
  assert.equal(toHTML(parse("4*(4-4)/.4~")), '4 × (4 − 4) ÷ .<span class="rec">4</span>');
  assert.equal(toHTML(parse("(4+4)^4")), "(4 + 4)<sup>4</sup>");
  assert.equal(toHTML(parse("V(4+4)")), '<span class="radical">√<span class="radicand">4 + 4</span></span>');
  assert.equal(toHTML(parse("4-(4-4)")), "4 − (4 − 4)");
});

test("solves the four fours, with solutions that check out", () => {
  const solutions = solve(FOURS.numbers, FOURS.rules, ALL_OPS);
  assert.equal(solutions.size, 537);
  assert.equal(solutions.get(343), "VVV(((4+4!)/4)^4!)"); // via 7^24, too big to hold in a double
  assert.equal(solutions.get(166), "(.4^-V4+V.4~)*4!"); // needs a negative exponent
  assert.equal(solutions.get(4), "(4-4)*4+4");
  assert.equal(solutions.get(999), "444/.4~");
  for (const [target, text] of solutions) assert.deepEqual(value(text), [target, 1], text);
});

test("solves Countdown, keeping only whole numbers", () => {
  const puzzle = { numbers: [25, 50, 75, 100, 3, 6], rules: { integers: true }, ops: {} };
  const solutions = solve(puzzle.numbers, puzzle.rules, puzzle.ops);
  assert.equal(solutions.size, 932);
  for (const [target, text] of solutions) assert.deepEqual(value(text, puzzle), [target, 1], text);
});

test("solves in order, using negatives if needed", () => {
  const puzzle = { numbers: [1, 2, 3], rules: { all: true, order: true }, ops: {} };
  const solutions = solve(puzzle.numbers, puzzle.rules, puzzle.ops);
  for (const [target, text] of solutions) assert.deepEqual(value(text, puzzle), [target, 1], text);
  assert.ok(solutions.has(4)); // -1+2+3
});

test("solveSteps gets more exact as limits loosen, ending exact", () => {
  const steps = [...solveSteps([4, 4, 4, 4], { all: true }, ALL_OPS)];
  assert.deepEqual(steps.map((s) => s.solutions.size), [516, 530, 537, 537]);
  assert.deepEqual(steps.map((s) => s.exact), [false, false, false, true]);
});

test("without 'use all', prefers solutions using fewer numbers", () => {
  const solutions = solve([0, 2, 2], {}, ALL_OPS);
  assert.equal(solutions.get(1), "0!"); // not 2/2, though ÷ is simpler than !
  assert.equal(solve([2, 2, 3], {}, ALL_OPS).get(6), "3!");
});

test("recurring decimals: brackets for the recurring digits, or ~ for all of them", () => {
  const p = { numbers: [2, 3, 4], rules: {}, ops: ALL_OPS };
  assert.deepEqual(value(".2(4)", p), [11, 45]);
  assert.deepEqual(value(".(4)", p), [4, 9]);
  assert.deepEqual(value(".4~", p), [4, 9]);
  assert.deepEqual(value(".(24)", p), value(".24~", p));
  assert.deepEqual(value(".2(34)", p), [116, 495]);
  assert.deepEqual(value("4.2(3)", p), [127, 30]);
  assert.equal(error(".2(34)", { numbers: [23, 4], rules: {}, ops: ALL_OPS }), ".2(34) isn't made from the numbers");
  assert.equal(error(".2(4)~", p), "Use either brackets or ~ for recurring digits");
  assert.equal(error("2(4)", p), "Unexpected (");
  assert.equal(toHTML(parse(".2(34)")), '.2<span class="rec">34</span>');
  // the solver uses them too, and its solutions check out
  const puzzle = { numbers: [2, 4, 9], rules: { all: true }, ops: ALL_OPS };
  const solutions = solve(puzzle.numbers, puzzle.rules, puzzle.ops);
  assert.equal(solutions.get(176), ".2(4)*(V9)!!"); // 11/45 × 720
  for (const [target, text] of solutions) assert.deepEqual(value(text, puzzle), [target, 1], text);
});

test("@ joins whole numbers' digits, shown as ‖", () => {
  const ops = { ...ALL_OPS, cat: true };
  const p = { numbers: [0, 2, 3, 4, 4], rules: {}, ops };
  assert.deepEqual(value("4!@V4", { ...FOURS, rules: {}, ops }), [242, 1]);
  assert.deepEqual(value("2^3@4", p), [84, 1]); // (2³)‖4
  assert.deepEqual(value("2*3@4", p), [68, 1]); // 2 × (3‖4)
  assert.deepEqual(value("-2@3", p), [-23, 1]);
  assert.deepEqual(value("4@0", p), [40, 1]);
  assert.equal(error("0@4", p), "‖ can't start with 0");
  assert.equal(error("2@.4", p), "‖ joins whole numbers that aren't negative");
  assert.equal(error("2@4", { ...p, ops: ALL_OPS }), "‖ isn't allowed");
  assert.equal(toHTML(parse("2^3@(4@4)")), "2<sup>3</sup> ‖ (4 ‖ 4)");
  // the solver uses it, and its solutions check out
  const puzzle = { numbers: [4, 4, 4, 4], rules: { all: true }, ops };
  const solutions = solve(puzzle.numbers, puzzle.rules, ops);
  assert.ok(solutions.size > 700);
  for (const [target, text] of solutions) assert.deepEqual(value(text, puzzle), [target, 1], text);
  const ordered = { numbers: [1, 2, 3], rules: { all: true, order: true }, ops: { cat: true } };
  for (const [target, text] of solve(ordered.numbers, ordered.rules, ordered.ops)) {
    assert.deepEqual(value(text, ordered), [target, 1], text);
  }
});
