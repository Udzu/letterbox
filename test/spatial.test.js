import { test } from "node:test";
import assert from "node:assert/strict";
import { compile, matches } from "../src/patterns/index.js";
import { SPLITS } from "../src/patterns/compile.js";
import { equivalent } from "../src/patterns/nfa.js";
import { format, SPATIAL_OPS } from "../src/patterns/parser.js";
import { randomAst, seededRandom } from "./helpers.js";

// all strings over the alphabet up to the given length
function strings(alphabet, maxLength) {
  let level = [""];
  const out = [""];
  for (let n = 1; n <= maxLength; n++) {
    level = level.flatMap((s) => alphabet.map((c) => s + c));
    out.push(...level);
  }
  return out;
}

// labellings of n positions accepted by a split pattern, as L/R strings
function labellings(split, n) {
  const re = new RegExp(`^(?:${split})$`);
  return strings(["L", "R"], n).filter((s) => s.length === n && re.test(s));
}

// does w match "A op B" for a separating operator, by trying every labelling?
function weaves(a, b, split, w) {
  const chars = [...w];
  return labellings(split, chars.length).some((labels) => {
    const part = (side) => chars.filter((_, i) => labels[i] === side).join("");
    return matches(a, part("L")) && matches(b, part("R"));
  });
}

// does w match "A -op B" (mirrored: "A ~-op B")? Tries every b up to a length, combined with
// w in every way the split allows
function unweaves(a, b, split, w, bs) {
  const chars = [...w];
  for (const removed of bs) {
    if (!matches(b, removed)) continue;
    const others = [...removed];
    for (const labels of labellings(split, chars.length + others.length)) {
      if ([...labels].filter((c) => c === "L").length !== chars.length) continue;
      let i = 0;
      let j = 0;
      const combined = [...labels].map((c) => (c === "L" ? chars[i++] : others[j++])).join("");
      if (matches(a, combined)) return true;
    }
  }
  return false;
}

function oracle(op, a, b, w, bs) {
  if (op in SPLITS) return weaves(a, b, SPLITS[op], w);
  const mirrored = op.startsWith("~-");
  const split = SPLITS[op.slice(mirrored ? 2 : 1)];
  return unweaves(a, b, mirrored ? split.replace(/[LR]/g, (c) => (c === "L" ? "R" : "L")) : split, w, bs);
}

const EXAMPLES = [
  // [pattern, matching, not matching]
  ["o+<l+", ["loooll", "lool", "ol", "lo"], ["o", "oo", "lolo", "olo"]],
  ["o+<<l+", ["lol", "looll"], ["ol", "lo", "o"]],
  ["o+>l+", ["olo", "ol", "lo"], ["l", "oo"]],
  ["o+>>l+", ["olo", "oollo"], ["ol", "lo"]],
  ["()<<l+", ["ll"], ["l", ""]],
  ["the^A+", ["tAAhAe", "Athe", "theA"], ["the", "tAe"]],
  ["the>^A+", ["tAAhAe", "thAe"], ["Athe", "theA"]],
  ["A+<^the", ["tAAhAe"], ["Athe"]],
  ["U+##w+", ["UwUwU", "UwUw", "Uw"], ["wUwU", "UwwU", "U"]],
  ["U+#w+", ["UwUwU", "wUwU", "wUw"], ["UwwU"]],
  ["(the|a)-.", ["th", ""], ["the", "t"]],
  ["(the|a)~-.", ["he", ""], ["th"]],
  ["lo+l->o+", ["ll", "lol"], ["l", "lo"]],
  ["lo+l->>o+", ["ll"], ["l"]],
  ["lo+l-<l", ["lo", "ol", "loo"], ["o", "l", "lol"]],
  ["lo+l-<ll", ["o", "oo"], ["lo", "l"]],
  ["lo+l-<<l", [], ["o", "lo", "ol"]], // one l can't be on both sides
  ["lo+l-<<ll", ["o", "oo"], ["lo"]],
  ["Madrid-^..", ["Mdrd", "Mdid", "drid"], ["Madrid", "Mad"]],
  ["(me)+-#..", ["mm", "ee"], ["me"]],
  ["abcd-##..", ["ac"], ["bd"]],
  ["abcd~-##..", ["bd"], ["ac"]],
  ["abcd->^..", ["ad"], ["ab", "cd"]],
  ["abcd-<^..", ["bc"], ["ad"]],
  ["a-b-c", [], ["a", ""]],
  ["abc-c-b", ["a"], ["ab"]],
];

for (const [pattern, accepted, rejected] of EXAMPLES) {
  test(`spatial ${pattern}`, () => {
    const nfa = compile(pattern);
    for (const s of accepted) assert.ok(matches(nfa, s), `should match ${JSON.stringify(s)}`);
    for (const s of rejected) assert.ok(!matches(nfa, s), `should not match ${JSON.stringify(s)}`);
  });
}

test("every operator agrees with the brute-force definition", () => {
  const rand = seededRandom(17);
  const ws = strings(["a", "b"], 4);
  const bs = strings(["a", "b", "c"], 3);
  // right operands with only short strings, so trying every b up to length 3 is exhaustive
  const FINITE = ["a", "b", ".", "ab", "a|bb", "", "[ab]{2}", "a?b?", "[]", "[^a]", ".a?"];
  for (const op of SPATIAL_OPS) {
    for (let i = 0; i < 12; i++) {
      const left = format(randomAst(rand, 3, { chars: ["a", "b"], logic: false }));
      const right = op in SPLITS
        ? format(randomAst(rand, 2, { chars: ["a", "b"], logic: false }))
        : FINITE[Math.floor(rand() * FINITE.length)];
      const pattern = `(${left})${op}(${right})`;
      const nfa = compile(pattern);
      const a = compile(left);
      const b = compile(right);
      for (const w of ws) {
        assert.equal(matches(nfa, w), oracle(op, a, b, w, bs), `${pattern} on ${JSON.stringify(w)}`);
      }
    }
  }
});

test("identities between operators", () => {
  const rand = seededRandom(23);
  const ws = strings(["a", "b"], 5);
  const same = [
    ["(A)>(B)", "(B)<(A)"],
    ["(A)>>(B)", "(B)<<(A)"],
    ["(A)>^(B)", "(B)<^(A)"],
    ["(A)^(B)", "(B)^(A)"],
    ["(A)#(B)", "(A)##(B)|(B)##(A)"],
  ];
  const subsets = [
    ["(A)<<(B)", "(A)<(B)"],
    ["(A)>>(B)", "(A)>(B)"],
    ["(A)<^(B)", "(A)^(B)"],
    ["(A)##(B)", "(A)^(B)"],
    ["(A)(B)", "(A)>(B)"],
    ["(A)<(B)", "(A)^(B)"],
  ];
  for (let i = 0; i < 40; i++) {
    const A = format(randomAst(rand, 3, { chars: ["a", "b"], logic: false }));
    const B = format(randomAst(rand, 3, { chars: ["a", "b"], logic: false }));
    const fill = (p) => compile(p.replaceAll("A", A).replaceAll("B", B));
    for (const [p, q] of same) {
      const [m, n] = [fill(p), fill(q)];
      for (const w of ws) assert.equal(matches(m, w), matches(n, w), `${p} vs ${q} with A=${A}, B=${B} on ${w}`);
    }
    for (const [p, q] of subsets) {
      const [m, n] = [fill(p), fill(q)];
      for (const w of ws) if (matches(m, w)) assert.ok(matches(n, w), `${p} ⊆ ${q} with A=${A}, B=${B} on ${w}`);
    }
  }
});

test("custom splits generalise the separating and subtraction operators", () => {
  const rand = seededRandom(23);
  for (let i = 0; i < 40; i++) {
    const A = format(randomAst(rand, 2, { chars: ["a", "b"], logic: false }));
    const B = format(randomAst(rand, 2, { chars: ["a", "b"], logic: false }));
    for (const op of SPATIAL_OPS) {
      const mirrored = op.startsWith("~-");
      const base = op.slice(mirrored ? 2 : op.startsWith("-") ? 1 : 0);
      let split = SPLITS[base];
      if (mirrored) split = split.replace(/[LR]/g, (c) => (c === "L" ? "R" : "L"));
      const custom = `(?${op === base ? "w" : "u"}:${split}/${A}/${B})`;
      assert.ok(equivalent(compile(`(${A})${op}(${B})`), compile(custom)), `(${A})${op}(${B}) ≡ ${custom}`);
    }
  }
});

test("custom splits", () => {
  const same = (p, q) => assert.ok(equivalent(compile(p), compile(q)), `${p} ≡ ${q}`);
  same("(?u:(LRR)*(LR?)?/[a-z]*/.*)", "(?[::3]:[a-z]*)");
  same("(?w:.*/a/b)", "a^b");
  same("(?w:[]/a/b)", "[]");
  same("(?w:L*|R*/a*/b*)", "a*|b*");
  same("(?w:L*&R*/a*/b*)", "");
  same("(?i:(?w:L*R*/a/b))", "(?i:ab)");
  const yes = (p, s) => assert.ok(matches(compile(p), s), `${p} should match ${s}`);
  const no = (p, s) => assert.ok(!matches(compile(p), s), `${p} shouldn't match ${s}`);
  yes("(?w:L+R+L+/the/[a-z]+)", "tithe");
  no("(?w:L+R+L+/the/[a-z]+)", "the");
  yes("(?w:(LR+)*L/cat/[a-z]+)", "cxxaxt");
  no("(?w:(LR+)*L/cat/[a-z]+)", "caxt");
  yes("(?u:(LLR)*/abcdef/.*)", "abde");
});

