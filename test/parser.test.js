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
    case "words": return "@";
    case "class": {
      const ranges = node.ranges.map(([lo, hi]) =>
        lo === hi ? String.fromCodePoint(lo) : `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`);
      return `[${node.negated ? "^" : ""}${ranges.join(" ")}]`;
    }
    case "repeat": return `(repeat ${node.min} ${node.max ?? "∞"} ${show(node.node)})`;
    case "not": return `(not ${show(node.node)})`;
    case "spatial": return `(${node.op} ${show(node.left)} ${show(node.right)})`;
    case "modifier": return `(?${node.flag}${node.count ?? ""} ${show(node.node)})`;
    case "replace": return `(${node.strict ? "Z" : "z"} ${show(node.node)} ${show(node.find)} ${show(node.insert)})`;
    case "split": return `(${node.unweave ? "u" : "w"} ${show(node.split)} ${show(node.left)} ${show(node.right)})`;
    case "slice": return `([${[node.start, node.stop, node.step].map((n) => n ?? "_").join(" ")}] ${show(node.node)})`;
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
  // modifiers
  ["(?i:ab)", "(?i (concat a b))"],
  ["(?r:a|b)", "(?r (alt a b))"],
  ["(?c3:a)", "(?c3 a)"],
  ["(?c-3:a)", "(?c-3 a)"],
  ["(?c0:a)", "(?c0 a)"],
  ["(?c:a)", "(?c a)"],
  ["(?R2:abc)", "(?R2 (concat a b c))"],
  ["(?R-2:abc)", "(?R-2 (concat a b c))"],
  ["(?R:abc)", "(?R (concat a b c))"],
  ["(?i:)", "(?i ε)"],
  ["(?i:a)*", "(repeat 0 ∞ (?i a))"],
  ["x(?i:(?r:a))", "(concat x (?i (?r a)))"],
  ["(?i:a)<b", "(< (?i a) b)"],
  ["(?[1:-1]:abc)", "([1 -1 _] (concat a b c))"],
  ["(?[:]:a)", "([_ _ _] a)"],
  ["(?[::2]:a)", "([_ _ 2] a)"],
  ["(?[1::]:a)", "([1 _ _] a)"],
  ["(?[-3:-1:2]:a)", "([-3 -1 2] a)"],
  ["(?[2:2]:a)", "([2 2 _] a)"],
  ["(?[1:-5]:a)", "([1 -5 _] a)"],
  ["(?z:London/o/u)", "(z (concat L o n d o n) o u)"],
  ["(?Z:a/b/c)", "(Z a b c)"],
  ["(?z://)", "(z ε ε ε)"],
  ["(?z:a|b/c&d/!e)", "(z (alt a b) (and c d) (not e))"],
  ["(?z:a\\/b/c/d)", "(z (concat a / b) c d)"],
  ["(?z:(?z:a/b/c)/d/e)", "(z (z a b c) d e)"],
  ["(?w:L*R*/a/b)", "(w (concat (repeat 0 ∞ L) (repeat 0 ∞ R)) a b)"],
  ["(?u:[LR]|!L/a/b)", "(u (alt [L R] (not L)) a b)"],
  ["(?w:./a/b)", "(w . a b)"],
  ["(?w:[^L]//)", "(w [^L] ε ε)"],
  ["@", "@"],
  ["@ @", "(concat @   @)"],
  ["@&(?r:@)", "(and @ (?r @))"],
  ["\\@", "@"],
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
  ["(?", "Missing modifier", [0, 2]],
  ["(?s:a)", "PCRE flag, which isn't supported: for a cipher shift", [0, 3]],
  ["(?m:a)", "(?m is a PCRE flag", [0, 3]],
  ["(?-i:a)", "(?- is a PCRE flag", [0, 3]],
  ["(?:a)", "not (?:...)", [0, 3]],
  ["(?=a)", "Unknown modifier (?=", [0, 3]],
  ["(?é:a)", "Unknown modifier (?é", [0, 3]],
  ["(?i)", "Expected : after (?i, as in (?i:abc)", [0, 3]],
  ["(?ia:b)", "Expected : after (?i", [0, 3]],
  ["(?R)", "Expected : after (?R, as in (?R2:abc)", [0, 3]],
  ["(?c3)", "Expected : after (?c3", [0, 4]],
  ["(?i2:a)", "(?i:...) doesn't take a number", [3, 4]],
  ["(?c-:a)", "Expected a number after (?c", [3, 4]],
  ["(?c1001:a)", "at most 1000", [3, 7]],
  ["(?R0:a)", "can't be 0", [3, 4]],
  ["(?R-0:a)", "can't be 0", [3, 5]],
  ["(?i:a", "Missing ) to close (", [0, 1]],
  ["(?[]:a)", "Expected : in slice", [0, 3]],
  ["(?[1]:a)", "Expected : in slice", [0, 4]],
  ["(?[x:]:a)", "Expected : in slice", [0, 3]],
  ["(?[1:2:3:4]:a)", "Expected ] to close slice", [0, 8]],
  ["(?[1:2]a)", "Expected : after slice", [0, 7]],
  ["(?[::0]:a)", "step can't be 0", [0, 7]],
  ["(?[::-1]:a)", "can't be negative: use (?r:...)", [0, 8]],
  ["(?[-2:3]:a)", "negative start and a non-negative stop", [0, 8]],
  ["(?[3:2]:a)", "start is after its stop", [0, 7]],
  ["(?[-1:-2]:a)", "start is after its stop", [0, 9]],
  ["(?[-:]:a)", "Expected a number in slice", [3, 4]],
  ["(?[1001:]:a)", "at most 1000", [3, 7]],
  ["a/b", "/ is reserved: write \\/", [1, 2]],
  ["(a/b)", "/ is reserved", [2, 3]],
  ["(?z:(a/b)/c/d)", "/ is reserved", [6, 7]],
  ["(?z:a)", "needs three parts", [0, 6]],
  ["(?z:a/b)", "needs three parts", [0, 8]],
  ["(?Z:a/b/c/d)", "(?Z:...) has three parts", [9, 10]],
  ["(?z:a/b/c", "Missing ) to close (", [0, 1]],
  ["(?z2:a/b/c)", "doesn't take a number", [3, 4]],
  ["(?w:l/a/b)", "only use the characters L and R", [4, 5]],
  ["(?u:LR*a/a/b)", "only use the characters L and R", [7, 8]],
  ["(?w:[L-R]/a/b)", "only use the characters L and R", [4, 9]],
  ["(?w:(?i:x)/a/b)", "only use the characters L and R", [8, 9]],
  ["(?w:L/a)", "needs three parts, as in (?w:L+R+L+/the/[a-z]+)", [0, 8]],
  ["(?u:L)", "needs three parts, as in (?u:(LLR)*/abcdef/.*)", [0, 6]],
  ["(?w:L@/a/b)", "only use the characters L and R", [5, 6]],
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
  ["((?i:a))", "(?i:a)"],
  ["(?i:(a))", "(?i:a)"],
  ["(?i:a|b)c", "(?i:a|b)c"],
  ["(?R-1:a)*", "(?R-1:a)*"],
  ["(?[1::]:a)", "(?[1:]:a)"],
  ["(?[::1]:a|b)", "(?[::1]:a|b)"],
  ["(?z:(a|b)/(c)/(d|))", "(?z:a|b/c/d|)"],
  ["(?z:a/()/(d))", "(?z:a//d)"],
  ["(?w:(L|R)/(a)/b*)", "(?w:L|R/a/b*)"],
  ["(@)+\\@", "@+\\@"],
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
    const ast = randomAst(rand, 4, { modifiers: true });
    const pattern = format(ast);
    assert.deepEqual(stripSpans(parse(pattern)), ast, pattern);
  }
});
