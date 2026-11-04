// Compile a pattern AST into an NFA, using Thompson's construction for the regular
// expression basics and NFA operations for & and !.
//
// Modifiers:
//   (?i:A)   case-insensitive: every character comparison inside A ignores case, so (?i:!a)
//            matches neither a nor A (see letters.js)
//   (?r:A)   A reversed
//   (?cn:A)  A with its ASCII letters shifted n places along the alphabet, as in a Caesar
//            cipher; (?c:A) is any of the shifts from 1 to 25
//   (?Rn:A)  A rotated n characters right (or left if n is negative); (?R:A) is any
//            rotation that changes where the string starts (see rotate.js)
//   (?tn:A)  A with two characters n apart swapped, so (?t1:A) swaps adjacent ones; (?t:A)
//            swaps any two (see transpose.js)
//   (?a:A)   anagrams of strings in A, which must be finite (see anagram.js)
//   (?[m:n:s]:A)  slices of strings in A, as in Python but strict: a string too short for
//            the slice gives nothing (see sliceError in parser.js)
//   (?z:A/B/C)  A with one substring matching B replaced by one matching C; (?Z:A/B/C)
//            doesn't replace at either end (see replace.js)
//   (?w:S/A/B)  A and B combined by a custom split S, a pattern over L and R, as the
//            separating operators are; (?u:S/A/B) is A with B removed by S, as the
//            subtraction operators are (see weave.js)
//
// build(node, from) adds the node's fragment starting at the existing state `from` and
// returns its end state. Two invariants keep this sound while sharing states:
// - no fragment adds edges *into* `from` (loops always go back to a fresh state), and
// - the returned end state has no outgoing edges yet, unless it is `from` itself.

import { anagram } from "./anagram.js";
import { CharSet } from "./charset.js";
import { caseClose, shiftSet } from "./letters.js";
import { Builder, complement, intersect, mapLabels, minimize, removeEpsilons, reverse, trim } from "./nfa.js";
import { parse, PatternError } from "./parser.js";
import { replace } from "./replace.js";
import { atLeast, exactly, rotate } from "./rotate.js";
import { shorthandSet } from "./shorthands.js";
import { transpose } from "./transpose.js";
import { unweave, weave } from "./weave.js";

// Split patterns for the separating operators: which positions of a combined string come
// from the left operand (L) and which from the right (R). See weave.js.
export const SPLITS = {
  "": "L*R*", //      AB    A then B
  "<": "R*L*R*", //   A<B   A inside B
  ">": "L*R*L*", //   A>B   A outside B
  "<<": "R+L*R+", //  A<<B  A strictly inside B
  ">>": "L+R*L+", //  A>>B  A strictly outside B
  "^": "[LR]*", //    A^B   A interleaved with B
  "<^": "R[LR]*R", // A<^B  A interleaved strictly inside B
  ">^": "L[LR]*L", // A>^B  A interleaved strictly outside B
  "#": "(LR)*L?|(RL)*R?", // A#B  A alternating with B
  "##": "(LR)*L?", // A##B  A alternating with B, A first
};

// How each spatial operator token is built: A op B weaves A and B with SPLITS[op], while
// A-op B removes B from A (w matches if w op b is in A for some b in B), and A_-op B is
// the mirror image (b op w is in A).
export function spatialOp(op) {
  if (op in SPLITS) return { construct: weave, split: SPLITS[op] };
  if (op.startsWith("-")) return { construct: unweave, split: SPLITS[op.slice(1)] };
  if (op.startsWith("_-")) return { construct: unweave, split: swap(SPLITS[op.slice(2)]) };
  throw new Error(`Unknown spatial operator ${op}`);
}

function swap(split) {
  return split.replace(/[LR]/g, (c) => (c === "L" ? "R" : "L"));
}

const splitCache = new Map();
function splitDfa(split) {
  if (!splitCache.has(split)) splitCache.set(split, minimize(compile(parse(split))));
  return splitCache.get(split);
}

// options: { caseless } makes every character comparison case-insensitive, and { words }
// is the word list's automaton, which @ matches (see wordsAutomaton in wordlist.js)
export function compile(ast, options = {}) {
  if (!options.names) options = { ...options, names: definitions(ast) };
  const b = new Builder();
  const start = b.state();
  const end = build(b, ast, start, options);
  return b.build(start, [end]);
}

function build(b, node, from, options) {
  // a character or class's set, before any negation
  const chars = (set) => (options.caseless ? caseClose(set) : set);
  switch (node.type) {
    case "empty":
      return from;
    case "char":
      return step(b, from, chars(CharSet.of(node.cp)));
    case "any":
      return step(b, from, CharSet.ALL);
    case "define":
    case "ref":
      return embed(b, named(node.name, options), from);
    case "words": {
      if (!options.words) throw new PatternError("No word list loaded: load one below to use @", ...node.span);
      return embed(b, options.caseless ? mapLabels(options.words, caseClose) : options.words, from);
    }
    case "class": {
      // a negated shorthand like \D inside a class is the complement of its (case-closed) set
      const shorthands = (node.shorthands ?? []).map((sh) => shorthand(sh, chars));
      const set = shorthands.reduce((x, y) => x.union(y), chars(CharSet.from(node.ranges.map(([lo, hi]) => [lo, hi]))));
      return step(b, from, node.negated ? set.complement() : set);
    }
    case "shorthand":
      return step(b, from, shorthand(node, chars));
    case "concat":
      return node.items.reduce((at, item) => build(b, item, at, options), from);
    case "alt": {
      const end = b.state();
      for (const item of node.items) b.edge(build(b, item, from, options), null, end);
      return end;
    }
    case "repeat":
      return repeat(b, node.node, node.min, node.max, from, options);
    case "and": {
      const nfa = node.items.map((n) => compile(n, options)).reduce(intersect);
      return embed(b, nfa, from);
    }
    case "not":
      return embed(b, complement(compile(node.node, options)), from);
    case "spatial": {
      return embed(b, subtract(node.op, compile(node.left, options), compile(node.right, options)), from);
    }
    case "modifier":
      return modifier(b, node, from, options);
    case "slice":
      return embed(b, slice(compile(node.node, options), node), from);
    case "split": {
      // modifiers like (?i:...) apply to the operands, but not to the split
      const split = minimize(intersect(compile(node.split), splitAlphabet()));
      const construct = node.unweave ? unweave : weave;
      const nfa = construct(removeEpsilons(compile(node.left, options)), removeEpsilons(compile(node.right, options)), split);
      return embed(b, nfa, from);
    }
    case "replace": {
      const [a, find, insert] = [node.node, node.find, node.insert].map((n) => removeEpsilons(compile(n, options)));
      return embed(b, replace(a, find, insert, node.strict), from);
    }
    default:
      throw new Error(`Unknown node type ${node.type}`);
  }
}

// with (?i:...), \W is everything that doesn't match \w case-insensitively, as in JavaScript
function shorthand(sh, chars) {
  const set = chars(shorthandSet({ ...sh, negated: false }));
  return sh.negated ? set.complement() : set;
}

// Named patterns (see the parser) are compiled once, with the modifiers where they're
// defined, as in PCRE, so a name always means the same thing. This finds each definition
// and whether it's inside (?i:...); names are checked to be unique and not to refer to
// themselves when parsing.
export function definitions(ast) {
  const names = new Map();
  const visit = (node, caseless) => {
    if (node.type === "define") names.set(node.name, { node: node.node, caseless, nfa: null });
    if (node.type === "modifier" && node.flag === "i") caseless = true;
    // a custom split's split part isn't affected by modifiers
    if (node.type === "split") visit(node.split, false);
    for (const child of [node.node, node.left, node.right, node.find, node.insert, ...(node.items ?? [])]) {
      if (child) visit(child, caseless);
    }
  };
  visit(ast, false);
  return names;
}

function named(name, options) {
  const entry = options.names.get(name);
  entry.nfa ??= compile(entry.node, { ...options, caseless: entry.caseless });
  return entry.nfa;
}

function step(b, from, label) {
  const end = b.state();
  b.edge(from, label, end);
  return end;
}

function modifier(b, node, from, options) {
  const { flag, count } = node;
  switch (flag) {
    case "i":
      return build(b, node.node, from, { ...options, caseless: true });
    case "r":
      return embed(b, reverse(compile(node.node, options)), from);
    case "c": {
      const inner = compile(node.node, options);
      const shifts = count === null ? Array.from({ length: 25 }, (_, i) => i + 1) : [count];
      const end = b.state();
      for (const n of shifts) b.edge(embed(b, mapLabels(inner, (set) => shiftSet(set, n)), from), null, end);
      return end;
    }
    case "R": {
      const inner = trim(removeEpsilons(compile(node.node, options)));
      const [v, u] = count === null ? [atLeast(1), atLeast(1)] : count > 0 ? [exactly(count), atLeast(1)] : [atLeast(1), exactly(-count)];
      return embed(b, rotate(inner, v, u), from);
    }
    case "t":
      return embed(b, transpose(removeEpsilons(compile(node.node, options)), count), from);
    case "a": {
      const anagrams = anagram(compile(node.node, options));
      if (!anagrams) throw new PatternError("Anagrams need a pattern with finitely many strings", ...node.span);
      return embed(b, anagrams, from);
    }
    default:
      throw new Error(`Unknown modifier ${flag}`);
  }
}

// A slice is the middle part y of strings xyz in A, with conditions on the lengths of x, y
// and z, then (with a step) every s-th character of y. Each case is built from subtraction
// and intersection.
function slice(a, { start, stop, step }) {
  const length = (n) => compile(parse(`.{${n}}`));
  const anything = compile(parse(".*"));
  const fromEnd = (x, y) => subtract("-", x, y); //   x with y removed from the end
  const fromStart = (x, y) => subtract("_-", x, y); // x with y removed from the start
  let middle;
  if (start === null || start >= 0) {
    const rest = fromStart(a, length(start ?? 0));
    if (stop === null) middle = rest;
    else if (stop >= 0) middle = intersect(fromEnd(rest, anything), length(stop - (start ?? 0)));
    else middle = fromEnd(rest, length(-stop));
  } else {
    // a negative start: y's length is fixed, and the rest of the string is before it
    const rest = stop === null ? a : fromEnd(a, length(-stop));
    middle = intersect(fromStart(rest, anything), length(-start + (stop ?? 0)));
  }
  if (step === null || step === 1) return middle;
  // keep the first of every `step` characters: the others are removed, wherever they are
  const split = `(LR{${step - 1}})*(LR{0,${step - 2}})?`;
  return unweave(removeEpsilons(middle), removeEpsilons(anything), splitDfa(split));
}

let alphabet = null;
function splitAlphabet() {
  return (alphabet ??= compile(parse("[LR]*")));
}

function subtract(op, x, y) {
  const { construct, split } = spatialOp(op);
  return construct(removeEpsilons(x), removeEpsilons(y), splitDfa(split));
}

function repeat(b, node, min, max, from, options) {
  let at = from;
  const required = max === null && min > 0 ? min - 1 : min;
  for (let i = 0; i < required; i++) at = build(b, node, at, options);
  if (max === null) return min > 0 ? plus(b, node, at, options) : star(b, node, at, options);
  for (let i = min; i < max; i++) {
    const end = build(b, node, at, options);
    b.edge(at, null, end); // skip this copy
    at = end;
  }
  return at;
}

// from → loop ⟲ node, loop → end
function star(b, node, from, options) {
  const loop = b.state();
  b.edge(from, null, loop);
  b.edge(build(b, node, loop, options), null, loop);
  const end = b.state();
  b.edge(loop, null, end);
  return end;
}

// from → loop → node, back to loop or on to end
function plus(b, node, from, options) {
  const loop = b.state();
  b.edge(from, null, loop);
  const last = build(b, node, loop, options);
  b.edge(last, null, loop);
  const end = b.state();
  b.edge(last, null, end);
  return end;
}

function embed(b, nfa, from) {
  const { start, accepting } = b.embed(nfa);
  b.edge(from, null, start);
  const end = b.state();
  for (const s of accepting) b.edge(s, null, end);
  return end;
}
