import { test } from "node:test";
import assert from "node:assert/strict";
import { compile as compileAst, definitions } from "../src/patterns/compile.js";
import { examples } from "../src/patterns/examples.js";
import { explainer, layout, sliceSplit, TooComplexToExplain } from "../src/patterns/explain.js";
import { compile, matches } from "../src/patterns/index.js";
import { format, parse } from "../src/patterns/parser.js";
import { wordsAutomaton } from "../src/patterns/wordlist.js";
import { randomAst, seededRandom } from "./helpers.js";

const WORDS = ["car", "pet", "carpet", "cat", "dog", "cars", "at", "a"];
const words = wordsAutomaton(WORDS);

// Checks that every node of an explanation matches the characters it's given, and that
// operands that share the string between them do so exactly.
function verify(tree, ast, caseless = false, names = definitions(ast)) {
  const { node, cells, children } = tree;
  const text = String.fromCodePoint(...cells.map((c) => c.ch));
  const nfa = compileAst(node, { words, names, caseless });
  assert.ok(matches(nfa, text), `${format(node)} should match ${JSON.stringify(text)}`);
  const cols = (cs) => cs.map((c) => c.col);
  if (node.type === "concat") assert.deepEqual(cols(children.flatMap((c) => c.cells)), cols(cells));
  if (node.type === "and" || node.type === "alt") for (const c of children) assert.deepEqual(cols(c.cells), cols(cells));
  if (node.type === "spatial" && !node.op.includes("-")) {
    const sorted = (cs) => [...cs].sort((x, y) => x.key[0] - y.key[0]);
    assert.deepEqual(sorted(cols(children.flatMap((c) => c.cells))), sorted(cols(cells)));
  }
  const inner = node.type === "modifier" && node.flag === "i" ? true : caseless;
  for (const child of children) {
    const ci = node.type === "ref" ? names.get(node.name).caseless : inner;
    verify(child, ast, ci, names);
  }
}

function explainAll(pattern, strings) {
  const ast = parse(pattern);
  const explain = explainer(ast, { words });
  return strings.map((s) => {
    const tree = explain(s);
    assert.ok(tree, `${pattern} should explain ${JSON.stringify(s)}`);
    assert.equal(String.fromCodePoint(...tree.cells.map((c) => c.ch)), s);
    verify(tree, ast);
    return tree;
  });
}

// rows as text: the characters in their columns, then the label, indented by depth
function rows(pattern, string) {
  const [tree] = explainAll(pattern, [string]);
  const { columns, rows } = layout(tree, pattern);
  return rows.map((r) => {
    // synthetic columns are bracketed in the top row, and as wide in the others
    const chars = columns.map((c, i) => {
      const ch = r.depth === 0 ? c.ch : r.chars.get(i) ?? " ";
      return c.synthetic ? (r.depth === 0 ? `[${ch}]` : ` ${ch} `) : ch;
    }).join("");
    return `${chars} ${"  ".repeat(r.depth)}${r.label}`.trimEnd();
  });
}

test("rows show which part matched which characters", () => {
  assert.deepEqual(rows("@@", "carpet"), ["carpet @@", "car      @", "   pet   @"]);
  assert.deepEqual(rows("@^@", "cdaotg"), ["cdaotg @^@", "c a t    @", " d o g   @"]);
  assert.deepEqual(rows("(b|c)?(@^@)", "bcdaotg"), [
    "bcdaotg (b|c)?(@^@)", "b         (b|c)?", " cdaotg   @^@", " c a t      @", "  d o g     @",
  ]);
  assert.deepEqual(rows("(ab)*c", "ababc"), ["ababc (ab)*c", "abab    (ab)*", "ab        ab", "  ab      ab"]);
  assert.deepEqual(rows("[a-z]*the[a-z]*", "bathe"), ["bathe [a-z]*the[a-z]*", "ba      [a-z]*"]);
});

test("characters not in the string get their own columns", () => {
  assert.deepEqual(rows("@-s", "car"), ["car[s] @-s", "car s    @"]);
  assert.deepEqual(rows("(?z:@/s/x)", "carx"), ["car[s]x (?z:@/s/x)", "car s     @"]);
  assert.deepEqual(rows("(?[1:]:@)", "at"), ["[c]at (?[1:]:@)", " c at   @"]);
  assert.deepEqual(rows("(?[::2]:@)", "cr"), ["c[a]r (?[::2]:@)", "c a r   @"]);
  // the removed "ar" is "car" sliced, so the slice adds a column of its own
  assert.deepEqual(rows("@-(?[1:]:@)", "c"), [
    "c[c][a][r] @-(?[1:]:@)", "c    a  r    @", "     a  r    (?[1:]:@)", "  c  a  r      @",
  ]);
});

test("modifiers and names", () => {
  assert.deepEqual(rows("(?c1:@)", "dbu"), ["dbu (?c1:@)", "cat   @"]);
  assert.deepEqual(rows("(?c-:@)", "xzg"), ["xzg (?c-:@)", "cat   @"]);
  // reversed and rotated strings are shown in their own order
  assert.deepEqual(rows("(?r:@)", "god"), ["god (?r:@)", "dog   @"]);
  assert.deepEqual(rows("(?r:@^@)", "godtac"), ["godtac (?r:@^@)", "catdog   @^@", "cat        @", "   dog     @"]);
  assert.deepEqual(rows("(?R1:@)", "tca"), ["tca (?R1:@)", "cat   @"]);
  assert.deepEqual(rows("(?a:@)", "tca"), ["tca (?a:@)", "cat   @"]);
  assert.deepEqual(rows("(?t1:@)", "cta"), ["cta (?t1:@)", "cat   @"]);
  assert.deepEqual(rows("(?t:@)", "tac"), ["tac (?t:@)", "cat   @"]);
  // "tc" is "cat" without the a, rearranged
  assert.deepEqual(rows("(?a:@-^.*)", "tc"), ["t[a]c (?a:@-^.*)", "c   t   @-^.*", "c a t     @", "  a       .*"]);
  assert.deepEqual(rows("(?<v>ca)(?&v)t", "cacat"), ["cacat (?<v>ca)(?&v)t", "ca      (?<v>ca)", "  ca    (?&v)"]);
  assert.deepEqual(rows("(?i:CAT)", "cat"), ["cat (?i:CAT)"]);
  assert.deepEqual(rows("!a", "bb"), ["bb !a"]);
});

test("both operands of & are shown", () => {
  assert.deepEqual(rows("@&c.*", "cat"), ["cat @&c.*", "cat   @", "cat   c.*", " at     .*"]);
});

// rows' labels, with the highlighted part in <>
function labels(pattern, string) {
  const [tree] = explainAll(pattern, [string]);
  return layout(tree, pattern).rows.map(({ label, highlight: h }) =>
    h ? `${label.slice(0, h[0])}<${label.slice(...h)}>${label.slice(h[1])}` : label);
}

test("alternations highlight the alternative that matched", () => {
  assert.deepEqual(labels("cat|dog", "dog"), ["cat|<dog>"]);
  assert.deepEqual(labels("ca.|cat", "cat"), ["<ca.>|cat"]);
  assert.deepEqual(labels("(a|bc)+", "abca"), ["(a|bc)+", "<a>|bc", "a|<bc>", "<a>|bc"]);
  // a label is cut around the alternative if it would be cut off
  const long = `${"a".repeat(20)}|${"b".repeat(30)}|cat|dog`;
  assert.deepEqual(labels(long, "cat"), ["…|<cat>|dog"]);
  assert.deepEqual(labels(`cat|${"d".repeat(40)}`, "d".repeat(40)), [`…|<${"d".repeat(27)}>…`]);
  assert.deepEqual(labels(`cat|${"d".repeat(40)}`, "cat"), [`<cat>|${"d".repeat(25)}…`]);
});

test("labels are shortened", () => {
  const pattern = "(?<v>" + "a".repeat(40) + ")b";
  const [tree] = explainAll(pattern, ["a".repeat(40) + "b"]);
  const { rows: [, row] } = layout(tree, pattern);
  assert.equal(row.label, "(?<v>" + "a".repeat(24) + "…");
  assert.equal(row.title, "(?<v>" + "a".repeat(40) + ")");
});

test("strings that don't match aren't explained", () => {
  assert.equal(explainer(parse("a+"))("b"), null);
});

test("slice splits", () => {
  assert.equal(sliceSplit({ start: 1, stop: null, step: null }), "R{1}(L*)");
  assert.equal(sliceSplit({ start: -2, stop: null, step: 2 }), "R*((LR{1})*(LR{0,0})?&[LR]{2})R{0}");
});

test("random patterns are explained correctly", () => {
  const rand = seededRandom(7);
  let explained = 0;
  let tooComplex = 0;
  for (let i = 0; i < 300; i++) {
    const ast = randomAst(rand, 3, { chars: ["a", "b", "😀"], modifiers: true });
    const pattern = format(ast);
    let nfa;
    try {
      nfa = compile(pattern);
    } catch {
      continue;
    }
    const found = examples(nfa, { random: rand, count: 3 }).examples;
    for (const s of found) {
      try {
        explainAll(pattern, [s]);
        explained++;
      } catch (e) {
        if (!(e instanceof TooComplexToExplain)) throw new Error(`${pattern} on ${JSON.stringify(s)}: ${e.stack}`);
        tooComplex++;
      }
    }
  }
  assert.ok(explained > 200, `only ${explained} explained`);
  assert.ok(tooComplex < explained / 20, `${tooComplex} too complex`);
});
