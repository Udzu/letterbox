// Explaining a match: which part of a pattern matched which characters of a string.
//
// explainer(ast, options) returns a function that takes a string the pattern matches and
// finds one way the pattern's syntax tree produces it. The result is a tree of
// { node, cells, children, name? }, where cells are the characters the node matched, each
// { col, ch }: col is the string's column it's shown in and ch the character the node
// matched there. That differs from the string's own character under (?c:...), and under
// (?r:...), (?R:...), (?t:...) and (?a:...), whose inner strings are shown in their own
// order. Some operators match characters that aren't in the string, such as the B that
// (?z:A/B/C) cuts out of A, or the part of a word that a slice skips; these get extra
// "synthetic" columns, placed next to the characters around them.
//
// Each node's explanation is found from its own automaton (compiled on first use) by
// trying the ways the node's operator could divide its characters between its operands,
// keeping the first where every operand matches its part. Concatenations and repeats try
// the longest first part first, as greedy regexes do; the separating and subtraction
// operators search for a split, with the fewest removed characters. Inside !P nothing can
// be explained, so !P, @ and single characters are leaves.
//
// layout(tree, pattern) turns a tree into rows for display (see there).

import { CharSet } from "./charset.js";
import { compile, definitions, SPLITS } from "./compile.js";
import { mirrorSet, shiftSet } from "./letters.js";
import { parse } from "./parser.js";
import { lazyDfa } from "./wordlist.js";

// steps (automaton moves and search states) allowed for one explanation
export const BUDGET = 300000;

export class TooComplexToExplain extends Error {
  constructor() {
    super("Too complex to explain");
    this.name = "TooComplexToExplain";
  }
}

const L = "L".codePointAt(0);
const R = "R".codePointAt(0);

// ast must be the parsed (NFC) pattern; options are compile's { words }, and { nfa } is the
// whole pattern's automaton if it's already compiled
export function explainer(ast, { words, nfa } = {}) {
  const names = definitions(ast);
  const automata = new Map(); // node → [dfa, dfa ignoring case]
  if (nfa) automata.set(ast, [lazyDfa(nfa), null]);
  const ctx = { names, words, automata, steps: 0, splits: new Map() };
  return (string) => {
    ctx.steps = 0;
    ctx.serial = 0;
    const cells = [...string].map((c, i) => ({ col: { key: [i], ch: c.codePointAt(0), synthetic: false }, ch: c.codePointAt(0) }));
    if (!matches(ctx, ast, cells, false)) return null;
    return explain(ctx, ast, cells, false);
  };
}

function tick(ctx, n = 1) {
  ctx.steps += n;
  if (ctx.steps > BUDGET) throw new TooComplexToExplain();
}

function automaton(ctx, node, caseless) {
  let pair = ctx.automata.get(node);
  if (!pair) ctx.automata.set(node, (pair = [null, null]));
  const i = caseless ? 1 : 0;
  pair[i] ??= lazyDfa(compile(node, { words: ctx.words, names: ctx.names, caseless }));
  return pair[i];
}

// run a lazy DFA over code points, returning its state (or dead)
function walk(ctx, dfa, from, chars) {
  let d = from;
  for (const ch of chars) {
    tick(ctx);
    d = dfa.step(d, ch);
    if (d === dfa.dead) break;
  }
  return d;
}

function matches(ctx, node, cells, caseless) {
  const dfa = automaton(ctx, node, caseless);
  return dfa.accepts(walk(ctx, dfa, dfa.start, cells.map((c) => c.ch)));
}

// a split, given as a pattern or its AST (whose names are separate from the pattern's)
function splitAutomaton(ctx, split) {
  if (!ctx.splits.has(split)) ctx.splits.set(split, lazyDfa(compile(typeof split === "string" ? parse(split) : split)));
  return ctx.splits.get(split);
}

function explain(ctx, node, cells, caseless) {
  tick(ctx);
  const tree = (children = [], extra = {}) => ({ node, cells, children, ...extra });
  const sub = (child, part, ci = caseless) => explain(ctx, child, part, ci);
  switch (node.type) {
    case "empty":
    case "char":
    case "any":
    case "class":
    case "shorthand":
    case "words":
    case "not":
      return tree();
    case "define":
      return tree([sub(node.node, cells)]);
    case "ref": {
      const entry = ctx.names.get(node.name);
      return tree([sub(entry.node, cells, entry.caseless)], { name: node.name });
    }
    case "alt":
      return tree([sub(node.items.find((item) => matches(ctx, item, cells, caseless)), cells)]);
    case "and":
      return tree(node.items.map((item) => sub(item, cells)));
    case "concat": {
      const parts = splitConcat(ctx, node.items, cells, caseless);
      return tree(parts.map((part, i) => sub(node.items[i], part)));
    }
    case "repeat": {
      const parts = splitRepeat(ctx, node, cells, caseless);
      return tree(parts.map((part) => sub(node.node, part)));
    }
    case "spatial": {
      const { op } = node;
      if (op in SPLITS) {
        const [left, right] = weaveSearch(ctx, splitAutomaton(ctx, SPLITS[op]), node, cells, caseless);
        return tree([sub(node.left, left), sub(node.right, right)]);
      }
      const split = op.startsWith("-") ? SPLITS[op.slice(1)] : swap(SPLITS[op.slice(2)]);
      const [whole, removed] = unweaveSearch(ctx, splitAutomaton(ctx, split), node.left, node.right, cells, caseless);
      return tree([sub(node.left, whole), sub(node.right, removed)]);
    }
    case "split": {
      const split = splitAutomaton(ctx, node.split);
      if (!node.unweave) {
        const [left, right] = weaveSearch(ctx, split, node, cells, caseless);
        return tree([sub(node.left, left), sub(node.right, right)]);
      }
      const [whole, removed] = unweaveSearch(ctx, split, node.left, node.right, cells, caseless);
      return tree([sub(node.left, whole), sub(node.right, removed)]);
    }
    case "slice": {
      const [whole] = unweaveSearch(ctx, splitAutomaton(ctx, sliceSplit(node)), node.node, null, cells, caseless);
      return tree([sub(node.node, whole)]);
    }
    case "replace":
      return tree(replaceSearch(ctx, node, cells, caseless).map(([child, part]) => sub(child, part)));
    case "modifier":
      return tree([modifier(ctx, node, cells, caseless)]);
    default:
      throw new Error(`Unknown node type ${node.type}`);
  }
}

function modifier(ctx, node, cells, caseless) {
  const inner = node.node;
  const sub = (part, ci = caseless) => explain(ctx, inner, part, ci);
  switch (node.flag) {
    case "i":
      return sub(cells, true);
    case "r":
      return sub(reorder(cells, [...cells].reverse()));
    case "c": {
      if (node.count === "-") return sub(cells.map(({ col, ch }) => ({ col, ch: mirrorSet(CharSet.of(ch)).ranges[0][0] })));
      // the string's letters shifted back are what the inner pattern matched
      const shifts = node.count === null ? Array.from({ length: 25 }, (_, i) => i + 1) : [node.count];
      for (const n of shifts) {
        const shifted = cells.map(({ col, ch }) => ({ col, ch: shiftSet(CharSet.of(ch), -n).ranges[0][0] }));
        if (matches(ctx, inner, shifted, caseless)) return sub(shifted);
      }
      break;
    }
    case "R": {
      // the string is vu, and the inner pattern matched uv
      const n = cells.length;
      const count = node.count;
      const ks = count === null ? Array.from({ length: Math.max(n - 1, 0) }, (_, i) => i + 1) : [count > 0 ? count : n + count];
      for (const k of ks) {
        if (k < 1 || k > n - 1) continue;
        const rotated = reorder(cells, [...cells.slice(k), ...cells.slice(0, k)]);
        if (matches(ctx, inner, rotated, caseless)) return sub(rotated);
      }
      break;
    }
    case "t": {
      // the string is x b m a y, and the inner pattern matched x a m b y
      const n = cells.length;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (node.count !== null && j - i !== node.count) continue;
          const swapped = [...cells];
          [swapped[i], swapped[j]] = [cells[j], cells[i]];
          const moved = reorder(cells, swapped);
          if (matches(ctx, inner, moved, caseless)) return sub(moved);
        }
      }
      break;
    }
    case "a":
      return sub(anagramSearch(ctx, inner, cells, caseless));
  }
  throw new Error(`No explanation for modifier ${node.flag}`);
}

// The inner string of a reversal or rotation, shown in its own order: the same columns,
// with the characters moved, so it reads as the inner pattern matched it.
function reorder(cells, moved) {
  return cells.map(({ col }, i) => ({ col, ch: moved[i].ch }));
}

// (?a:A): an order of the cells that A matches, found by choosing one character at a time.
// Cells with the same character are interchangeable, so the search tracks how many of each
// are left, and the cells are then used in their original order.
function anagramSearch(ctx, node, cells, caseless) {
  const dfa = automaton(ctx, node, caseless);
  const chars = [...new Set(cells.map((c) => c.ch))];
  const left = chars.map((ch) => cells.filter((c) => c.ch === ch).length);
  const path = search(
    ctx,
    [dfa.start, ...left],
    (state) => state.join(","),
    ([d, ...counts]) => chars.flatMap((ch, i) => {
      if (counts[i] === 0) return [];
      const next = dfa.step(d, ch);
      return next === dfa.dead ? [] : [[ch, [next, ...counts.map((n, j) => (j === i ? n - 1 : n))]]];
    }),
    ([d, ...counts]) => counts.every((n) => n === 0) && dfa.accepts(d),
  );
  if (!path) throw new Error("No anagram found");
  const unused = new Map(chars.map((ch) => [ch, cells.filter((c) => c.ch === ch)]));
  return reorder(cells, path.map((ch) => unused.get(ch).shift()));
}

// Divide cells between concatenated items, giving each item as much as possible in turn.
function splitConcat(ctx, items, cells, caseless) {
  const n = cells.length;
  const failed = new Set();
  const go = (i, start) => {
    if (i === items.length - 1) return matches(ctx, items[i], cells.slice(start), caseless) ? [cells.slice(start)] : null;
    const key = i * (n + 1) + start;
    if (failed.has(key)) return null;
    for (let end = n; end >= start; end--) {
      const part = cells.slice(start, end);
      if (!matches(ctx, items[i], part, caseless)) continue;
      const rest = go(i + 1, end);
      if (rest) return [part, ...rest];
    }
    failed.add(key);
    return null;
  };
  return go(0, 0);
}

// Divide cells into repetitions, each as long as possible. Only the required repetitions
// can be empty.
function splitRepeat(ctx, { node, min, max }, cells, caseless) {
  const n = cells.length;
  const failed = new Set();
  const go = (count, start) => {
    if (start === n && count >= min) return [];
    if (max !== null && count >= max) return null;
    const key = `${max === null ? Math.min(count, min) : count},${start}`;
    if (failed.has(key)) return null;
    for (let end = n; end >= start + (count < min ? 0 : 1); end--) {
      const part = cells.slice(start, end);
      if (!matches(ctx, node, part, caseless)) continue;
      const rest = go(count + 1, end);
      if (rest) return [part, ...rest];
    }
    failed.add(key);
    return null;
  };
  return go(0, 0);
}

function swap(split) {
  return split.replace(/[LR]/g, (c) => (c === "L" ? "R" : "L"));
}

// Breadth-first search for a path to a goal, from a start state, given each state's moves
// as [move, next state]. States are compared by key. Returns the moves, or null.
function search(ctx, start, key, moves, isGoal) {
  const seen = new Set([key(start)]);
  const queue = [{ state: start, back: null, move: null }];
  for (let i = 0; i < queue.length; i++) {
    tick(ctx);
    const entry = queue[i];
    if (isGoal(entry.state)) {
      const path = [];
      for (let e = entry; e.back; e = e.back) path.push(e.move);
      return path.reverse();
    }
    for (const [move, next] of moves(entry.state)) {
      const k = key(next);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push({ state: next, back: entry, move });
    }
  }
  return null;
}

// A separating operator or custom split: which cells go to the left operand (L) and which to
// the right (R), so that the split accepts the labelling and each operand its cells.
function weaveSearch(ctx, split, { left, right }, cells, caseless) {
  const a = automaton(ctx, left, caseless);
  const b = automaton(ctx, right, caseless);
  const n = cells.length;
  const path = search(
    ctx,
    [0, split.start, a.start, b.start],
    (state) => state.join(","),
    ([i, s, p, q]) => {
      if (i === n) return [];
      const out = [];
      const ch = cells[i].ch;
      const sl = split.step(s, L);
      if (sl !== split.dead) {
        const p2 = a.step(p, ch);
        if (p2 !== a.dead) out.push(["L", [i + 1, sl, p2, q]]);
      }
      const sr = split.step(s, R);
      if (sr !== split.dead) {
        const q2 = b.step(q, ch);
        if (q2 !== b.dead) out.push(["R", [i + 1, sr, p, q2]]);
      }
      return out;
    },
    ([i, s, p, q]) => i === n && split.accepts(s) && a.accepts(p) && b.accepts(q),
  );
  if (!path) throw new Error("No split found");
  return [cells.filter((_, i) => path[i] === "L"), cells.filter((_, i) => path[i] === "R")];
}

// A subtraction, custom unweave or slice: the cells are the L part of a string of `whole`,
// whose R part (characters not in the string) is a string of `removed` (or anything, if
// it's null). Returns [whole's cells, removed's cells], where the removed characters are
// new synthetic cells.
function unweaveSearch(ctx, split, whole, removed, cells, caseless) {
  const a = automaton(ctx, whole, caseless);
  const b = removed ? automaton(ctx, removed, caseless) : null;
  const n = cells.length;
  const path = search(
    ctx,
    [0, split.start, a.start, b ? b.start : 0],
    (state) => state.join(","),
    ([i, s, p, q]) => {
      const out = [];
      const sl = split.step(s, L);
      if (i < n && sl !== split.dead) {
        const p2 = a.step(p, cells[i].ch);
        if (p2 !== a.dead) out.push([null, [i + 1, sl, p2, q]]);
      }
      const sr = split.step(s, R);
      if (sr !== split.dead) {
        for (const ch of sharedChars(ctx, a, p, b, q)) {
          const p2 = a.step(p, ch);
          const q2 = b ? b.step(q, ch) : 0;
          if (p2 !== a.dead && (!b || q2 !== b.dead)) out.push([ch, [i, sr, p2, q2]]);
        }
      }
      return out;
    },
    ([i, s, p, q]) => i === n && split.accepts(s) && a.accepts(p) && (!b || b.accepts(q)),
  );
  if (!path) throw new Error("No removal found");
  const wholeCells = [];
  const removedCells = [];
  let i = 0;
  for (const ch of path) {
    if (ch === null) {
      wholeCells.push(cells[i++]);
    } else {
      const cell = synthetic(ctx, ch, wholeCells.at(-1), cells[i]);
      wholeCells.push(cell);
      removedCells.push(cell);
    }
  }
  return [wholeCells, removedCells];
}

// (?z:A/B/C): the string is xcy, and xby is in A. Tries x shortest first, then c.
function replaceSearch(ctx, node, cells, caseless) {
  const a = automaton(ctx, node.node, caseless);
  const b = automaton(ctx, node.find, caseless);
  const n = cells.length;
  const chars = cells.map((c) => c.ch);
  let afterX = a.start;
  for (let i = 0; i <= n; i++) {
    if (i > 0) afterX = walk(ctx, a, afterX, [chars[i - 1]]);
    if (afterX === a.dead) break;
    if (node.strict && i === 0) continue;
    for (let j = i; j <= n - (node.strict ? 1 : 0); j++) {
      const c = cells.slice(i, j);
      if (!matches(ctx, node.insert, c, caseless)) continue;
      const y = chars.slice(j);
      const path = search(
        ctx,
        [afterX, b.start],
        (state) => state.join(","),
        ([p, q]) => sharedChars(ctx, a, p, b, q).map((ch) => [ch, [a.step(p, ch), b.step(q, ch)]])
          .filter(([, [p2, q2]]) => p2 !== a.dead && q2 !== b.dead),
        ([p, q]) => b.accepts(q) && a.accepts(walk(ctx, a, p, y)),
      );
      if (!path) continue;
      const x = cells.slice(0, i);
      let prev = x.at(-1);
      const next = c[0] ?? cells[j];
      const found = path.map((ch) => (prev = synthetic(ctx, ch, prev, next)));
      return [[node.node, [...x, ...found, ...cells.slice(j)]], [node.find, found], [node.insert, c]];
    }
  }
  throw new Error("No replacement found");
}

// characters that both automata can read from these states (one per pair of edges), or
// any character the first can read if the second is null
function sharedChars(ctx, a, p, b, q) {
  const labels = (dfa, d) => dfa.states(d).flatMap((s) => dfa.nfa.edges[s]).map((e) => e.label).filter((l) => l !== null);
  const mine = labels(a, p);
  const theirs = b ? labels(b, q) : [CharSet.ALL];
  tick(ctx, mine.length * theirs.length);
  const out = new Set();
  for (const x of mine) {
    for (const y of theirs) {
      const both = x.intersect(y);
      if (!both.isEmpty()) out.add(representative(both));
    }
  }
  return [...out];
}

// a readable member of a set
const READABLE = [[0x61, 0x7a], [0x41, 0x5a], [0x30, 0x39], [0xe0, 0xff], [0x21, 0x7e]].map((r) => CharSet.from([r]));
function representative(set) {
  for (const pool of READABLE) {
    const both = set.intersect(pool);
    if (!both.isEmpty()) return both.ranges[0][0];
  }
  return set.ranges[0][0];
}

// A new synthetic cell, in a column placed just after `prev` (or before `next`). Columns
// sort by key, compared like strings, so a key that extends prev's sorts after it but before
// the column following it.
function synthetic(ctx, ch, prev, next) {
  let key;
  if (prev) key = [...prev.col.key, ctx.serial++];
  else if (next) key = [...next.col.key.slice(0, -1), next.col.key.at(-1) - 0.5, ctx.serial++];
  else key = [-1, ctx.serial++];
  return { col: { key, ch, synthetic: true }, ch };
}

// The split a slice makes of the strings it takes from (see slice in compile.js): R for
// characters dropped from the start or end or skipped by the step, L for those kept.
export function sliceSplit({ start, stop, step }) {
  const s = step ?? 1;
  const middle = s === 1 ? "L*" : `(LR{${s - 1}})*(LR{0,${s - 2}})?`;
  const sized = (k) => `(${middle}&[LR]{${k}})`;
  if (start === null || start >= 0) {
    const a = start ?? 0;
    if (stop === null) return `R{${a}}(${middle})`;
    if (stop >= 0) return `R{${a}}${sized(stop - a)}R*`;
    return `R{${a}}(${middle})R{${-stop}}`;
  }
  return `R*${sized(-start + (stop ?? 0))}R{${stop === null ? 0 : -stop}}`;
}

const compareKeys = (x, y) => {
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};

// Long labels are cut short, never splitting an escape like \u{a0}. A label can have a
// highlighted part, [start, end) in UTF-16 offsets, such as the alternative that matched;
// if that would be cut off, the label is cut around it instead, as in "…|dog|…". Returns
// { label, highlight }, with the highlight's offsets in the shortened label.
const MAX_LABEL = 30;
const TOKEN = /\\u\{[0-9a-f]+\}|\\.|./gsu;
function shortLabel(text, highlight = null) {
  if ([...text].length <= MAX_LABEL) return { label: text, highlight };
  // whole tokens from offset `from`, up to `room` code points
  const take = (from, room) => {
    let out = "";
    for (const token of text.slice(from).match(TOKEN) ?? []) {
      if ([...out].length + [...token].length > room) break;
      out += token;
    }
    return out;
  };
  const clip = (offset, [a, b]) => [Math.max(a - offset, 0), Math.max(b - offset, 0)];
  const head = take(0, MAX_LABEL - 1);
  if (highlight === null || [...text.slice(0, highlight[1])].length <= MAX_LABEL - 1) {
    return { label: `${head}…`, highlight: highlight && clip(0, highlight).map((x) => Math.min(x, head.length)) };
  }
  // start just before the highlighted part, keeping a separator like | before it
  const from = highlight[0] > 0 ? highlight[0] - 1 : 0;
  const body = take(from, MAX_LABEL - 2);
  const label = `…${body}${from + body.length < text.length ? "…" : ""}`;
  return { label, highlight: clip(from - 1, highlight).map((x) => Math.min(x, body.length + 1)) };
}

// nodes that are no more than a character class, such as a|b or (?i:a)
const CLASSES = new Set(["char", "any", "class", "shorthand"]);
function trivial(node) {
  if (node.type === "empty" || node.implicit || CLASSES.has(node.type)) return true;
  if (node.type === "alt") return node.items.every((item) => item.type !== "empty" && trivial(item));
  if (node.type === "modifier" && node.flag !== "R") return trivial(node.node);
  return false;
}
export const MAX_ROWS = 200;

// Rows for showing an explanation: the string's columns (including synthetic ones, in
// order), then one row per node, depth first. A node gets no row if it's no more than a
// character class (like a or a|b), matched nothing, or matched exactly what the row above
// it in the tree did (except for the operands of &, which always get one); its children
// are still shown. Each row has the node's characters by column index, its depth among
// the rows shown, its label (the pattern text, shortened, with the full text as `title`),
// the part of the label to highlight (an alternation's chosen alternative) or null, and
// `group`: which of the top level's rows it's part of, for colouring.
export function layout(tree, pattern) {
  const columns = [];
  const seen = new Set();
  const collect = (t) => {
    for (const { col } of t.cells) {
      if (!seen.has(col)) {
        seen.add(col);
        columns.push(col);
      }
    }
    t.children.forEach(collect);
  };
  collect(tree);
  columns.sort((x, y) => compareKeys(x.key, y.key));
  const index = new Map(columns.map((col, i) => [col, i]));
  const rows = [];
  let truncated = false;
  const same = (x, y) => x.length === y.length && x.every((c, i) => c.col === y[i].col && c.ch === y[i].ch);
  const visit = (t, parent, depth, group, operand = false) => {
    const shown = parent === null ||
      (!trivial(t.node) && t.cells.length > 0 && (operand || !same(t.cells, parent.cells)));
    if (shown) {
      if (rows.length >= MAX_ROWS) {
        truncated = true;
        return;
      }
      if (depth === 1) group = rows.filter((r) => r.depth === 1).length;
      const text = t.name !== undefined ? `(?&${t.name})` : pattern.slice(...t.node.span);
      // an alternation's label highlights the alternative that matched
      const chosen = t.node.type === "alt" ? t.children[0].node.span.map((x) => x - t.node.span[0]) : null;
      const { label, highlight } = shortLabel(text, chosen);
      rows.push({
        depth, group, label, highlight, title: label === text ? null : text,
        chars: new Map(t.cells.map(({ col, ch }) => [index.get(col), String.fromCodePoint(ch)])),
      });
    }
    for (const child of t.children) {
      visit(child, shown ? t : parent, shown ? depth + 1 : depth, group, t.node.type === "and");
    }
  };
  visit(tree, null, 0, null);
  return { columns: columns.map((col) => ({ ch: String.fromCodePoint(col.ch), synthetic: col.synthetic })), rows, truncated };
}
