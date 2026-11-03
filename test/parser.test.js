import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, format, PatternError } from "../src/patterns/parser.js";
import { randomAst, seededRandom, stripSpans } from "./helpers.js";

// compact s-expression view of an AST, ignoring spans
function show(node) {
  switch (node.type) {
    case "empty": return "ε";
    case "char": return String.fromCodePoint(node.cp);
    case "any": return ".";
    case "class": {
      const ranges = node.ranges.map(([lo, hi]) =>
        lo === hi ? String.fromCodePoint(lo) : `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`);
      return `[${node.negated ? "^" : ""}${ranges.join(" ")}]`;
    }
    case "repeat": return `(repeat ${node.min} ${node.max ?? "∞"} ${show(node.node)})`;
    case "not": return `(not ${show(node.node)})`;
    case "spatial": return `(${node.op} ${show(node.left)} ${show(node.right)})`;
    default: return `(${node.type} ${node.items.map(show).join(" ")})`;
  }
}

const PARSES = [
  // atoms
  ["", "ε"],
  ["a", "a"],
  ["é", "é"],
  ["😀", "😀"],
  [" ", " "],
  ["'", "'"],
  [".", "."],
  ["()", "ε"],
  ["((a))", "a"],
  // escapes
  ["\\*", "*"],
  ["\\\\", "\\"],
  ["\\'", "'"],
  ["\\n", "\n"],
  ["\\u{e9}", "é"],
  ["\\u{1F600}", "😀"],
  // classes
  ["[abc]", "[a b c]"],
  ["[a-z]", "[a-z]"],
  ["[^a-z0-9]", "[^a-z 0-9]"],
  ["[-a]", "[- a]"],
  ["[a-]", "[a -]"],
  ["[^-]", "[^-]"],
  ["[]", "[]"],
  ["[^]", "[^]"],
  ["[\\]\\\\]", "[] \\]"],
  ["[\\^a]", "[^ a]"],
  ["[a^]", "[a ^]"],
  ["[.*+]", "[. * +]"],
  ["[\\u{e0}-\\u{ff}]", "[à-ÿ]"],
  ["[😀-😂]", "[😀-😂]"],
  // repetition
  ["a*", "(repeat 0 ∞ a)"],
  ["a+", "(repeat 1 ∞ a)"],
  ["a?", "(repeat 0 1 a)"],
  ["a{3}", "(repeat 3 3 a)"],
  ["a{3,}", "(repeat 3 ∞ a)"],
  ["a{3,5}", "(repeat 3 5 a)"],
  ["a{0}", "(repeat 0 0 a)"],
  ["ab*", "(concat a (repeat 0 ∞ b))"],
  ["(ab)*", "(repeat 0 ∞ (concat a b))"],
  ["(a*)?", "(repeat 0 1 (repeat 0 ∞ a))"],
  // concatenation and alternation
  ["abc", "(concat a b c)"],
  ["a|b|c", "(alt a b c)"],
  ["ab|cd", "(alt (concat a b) (concat c d))"],
  ["a|", "(alt a ε)"],
  ["|a", "(alt ε a)"],
  ["a||b", "(alt a ε b)"],
  ["a()b", "(concat a ε b)"],
  // conjunction and negation
  ["a&b&c", "(and a b c)"],
  ["ab&c|d", "(alt (and (concat a b) c) d)"],
  ["a|b&c", "(alt a (and b c))"],
  ["!a", "(not a)"],
  ["!ab", "(not (concat a b))"],
  ["!a*", "(not (repeat 0 ∞ a))"],
  ["!a&b", "(and (not a) b)"],
  ["a&!b", "(and a (not b))"],
  ["!a|b", "(alt (not a) b)"],
  ["!!a", "(not (not a))"],
  ["!(a|b)", "(not (alt a b))"],
  ["a(!b)", "(concat a (not b))"],
  ["!()", "(not ε)"],
  // spatial operators
  ["a<b", "(< a b)"],
  ["ab<cd", "(< (concat a b) (concat c d))"],
  ["a*<b+", "(< (repeat 0 ∞ a) (repeat 1 ∞ b))"],
  ["a<b<c", "(< (< a b) c)"],
  ["a<(b<c)", "(< a (< b c))"],
  ["(a<b)^c", "(^ (< a b) c)"],
  ["a<b|c", "(alt (< a b) c)"],
  ["a<b&c", "(and (< a b) c)"],
  ["!a<b", "(not (< a b))"],
  ["a-b-c", "(- (- a b) c)"],
  ["a-b", "(- a b)"],
  ["a_-b", "(_- a b)"],
  ["a->>b", "(->> a b)"],
  ["a->^b", "(->^ a b)"],
  ["a-<^b", "(-<^ a b)"],
  ["a_-##b", "(_-## a b)"],
  ["a##b", "(## a b)"],
  ["a>^b", "(>^ a b)"],
  ["()<a", "(< ε a)"],
  ["a\\-b", "(concat a - b)"],
  ["[a-z]-[a-c]", "(- [a-z] [a-c])"],
];

for (const [pattern, expected] of PARSES) {
  test(`parse ${JSON.stringify(pattern)}`, () => {
    assert.equal(show(parse(pattern)), expected);
  });
}

const ERRORS = [
  // [pattern, message fragment, span]
  ["*", "Nothing to repeat", [0, 1]],
  ["a|+", "Nothing to repeat", [2, 3]],
  ["a**", "Parenthesise a repetition", [2, 3]],
  ["a*?", "Parenthesise a repetition", [2, 3]],
  ["a{2}{3}", "Parenthesise a repetition", [4, 5]],
  ["a{", "Expected a number", [1, 3]],
  ["a{x}", "Expected a number", [1, 3]],
  ["a{,3}", "Expected a number", [1, 3]],
  ["a{2", "Expected }", [1, 3]],
  ["a{2,1}", "larger than maximum", [1, 6]],
  ["a{1001}", "at most 1000", [2, 6]],
  ["(a", "Missing )", [0, 1]],
  ["a)", "Unmatched )", [1, 2]],
  ["[ab", "Missing ]", [0, 1]],
  ["[z-a]", "out of order", [1, 4]],
  ["[[]", "[ is reserved", [1, 2]],
  ["\\", "can't end with", [0, 1]],
  ["\\d", "Unknown escape", [0, 2]],
  ["\\ ", "Unknown escape", [0, 2]],
  ["\\u", "Expected {", [0, 2]],
  ["\\u{}", "Invalid code point", [0, 4]],
  ["\\u{110000}", "Invalid code point", [0, 10]],
  ["\\u{d800}", "Invalid code point", [0, 8]],
  ["\\u{12", "Missing }", [0, 5]],
  ["a=b", "= is reserved", [1, 2]],
  ["a~b", "~ is reserved", [1, 2]],
  ["a_b", "_ is reserved", [1, 2]],
  ["_", "_ is reserved", [0, 1]],
  // spatial operators
  ["<a", "Missing operand before <", [0, 1]],
  ["a|->b", "Missing operand before ->", [2, 4]],
  ["a<", "Missing operand after <", [1, 2]],
  ["a<<|b", "Missing operand after <<", [1, 3]],
  ["a<b^c", "Parenthesise to mix < and ^", [3, 4]],
  ["a-b->c", "Parenthesise to mix - and ->", [3, 5]],
  ["a<!b", "Parenthesise ! after <", [2, 3]],
  ["a<b!c", "Parenthesise ! inside a sequence", [3, 4]],
  ["$", "$ is reserved", [0, 1]],
  ["😀,", ", is reserved", [2, 3]],
  ["(?i:a)", "Group modifiers", [1, 2]],
  ["&a", "Missing operand before &", [0, 1]],
  ["a&", "Missing operand after &", [1, 2]],
  ["a&|b", "Missing operand after &", [1, 2]],
  ["!", "Missing operand after !", [0, 1]],
  ["!|a", "Missing operand after !", [0, 1]],
  ["a!b", "Parenthesise !", [1, 2]],
];

for (const [pattern, fragment, span] of ERRORS) {
  test(`error ${JSON.stringify(pattern)}`, () => {
    assert.throws(() => parse(pattern), (e) => {
      assert.ok(e instanceof PatternError, `expected PatternError, got ${e}`);
      assert.match(e.message, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.deepEqual(e.span, span);
      return true;
    });
  });
}

test("spans", () => {
  const ast = parse("ab|(cd)*");
  assert.deepEqual(ast.span, [0, 8]);
  assert.deepEqual(ast.items[0].span, [0, 2]);
  assert.deepEqual(ast.items[0].items[1].span, [1, 2]);
  assert.deepEqual(ast.items[1].span, [3, 8]); // repeat includes the parentheses
  assert.deepEqual(ast.items[1].node.span, [4, 6]); // the group's contents don't
  assert.deepEqual(parse("😀a").items[1].span, [2, 3]); // UTF-16 offsets
});

const FORMATS = [
  // [pattern, canonical form]
  ["((a))", "a"],
  ["(ab)c", "abc"],
  ["a(b|c)", "a(b|c)"],
  ["(a|b)|c", "a|b|c"],
  ["a(b*)", "ab*"],
  ["(ab)*", "(ab)*"],
  ["(a*)*", "(a*)*"],
  ["a{0,}", "a*"],
  ["a{1,}", "a+"],
  ["a{0,1}", "a?"],
  ["a{2,2}", "a{2}"],
  ["a()b", "a()b"],
  ["()*", "()*"],
  ["a|()", "a|"],
  ["(a&b)c", "(a&b)c"],
  ["(a|b)&c", "(a|b)&c"],
  ["(!a)&b", "!a&b"],
  ["!(a&b)", "!(a&b)"],
  ["a(!b)", "a(!b)"],
  ["(!a)*", "(!a)*"],
  ["\\*\\'", "\\*'"],
  ["\\u{41}\\u{0}", "A\\u{0}"],
  ["\\t", "\\t"],
  ["[\\]\\\\\\^\\-\\[]", "[\\]\\\\\\^\\-\\[]"],
  ["[a-z.]", "[a-z.]"],
  ["(a<b)<c", "a<b<c"],
  ["a<(b<c)", "a<(b<c)"],
  ["(a<b)^c", "(a<b)^c"],
  ["(ab)<(cd)", "ab<cd"],
  ["(a<b)c", "(a<b)c"],
  ["(a<b)*", "(a<b)*"],
  ["!(a<b)", "!a<b"],
  ["(!a)<b", "(!a)<b"],
  ["a<(b|c)", "a<(b|c)"],
];

for (const [pattern, canonical] of FORMATS) {
  test(`format ${JSON.stringify(pattern)}`, () => {
    const ast = parse(pattern);
    assert.equal(format(ast), canonical);
    assert.deepEqual(stripSpans(parse(canonical)), stripSpans(ast));
  });
}

test("format round-trips every parsed pattern", () => {
  for (const [pattern] of PARSES) {
    const ast = parse(pattern);
    assert.deepEqual(stripSpans(parse(format(ast))), stripSpans(ast), pattern);
  }
});

test("format round-trips random ASTs", () => {
  const rand = seededRandom(1);
  for (let i = 0; i < 2000; i++) {
    const ast = randomAst(rand, 4);
    const pattern = format(ast);
    assert.deepEqual(stripSpans(parse(pattern)), ast, pattern);
  }
});
