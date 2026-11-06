// Generating example strings that an NFA matches.
//
// Examples come from random walks on the NFA without ε-moves, which is cheap to build (unlike
// a DFA, which can be exponentially larger), of two kinds, two uniform walks to each free one:
// - Uniform walks pick a length they can reach, and then a path of exactly that length
//   uniformly at random, by weighting each step by how many paths of the remaining length
//   lead on from it (counted per edge, not per character, so that a branch like . doesn't
//   swamp one like a). Strings with several paths are a little more likely than others.
// - Free walks pick each step uniformly from the options, until they reach a target length,
//   then head for the nearest accepting state. These favour early choices (in lo+l>\*, the *
//   mostly lands at the start or the end), but they keep small branches like cat in
//   cat|(a|b)+ visible, which uniform walks almost never pick.
// Characters are picked from readable pools first (see pickChar), and newlines are never
// used, since examples are shown one per line.

import { CharSet, MAX_CP } from "./charset.js";
import { matches, removeEpsilons } from "./nfa.js";

// characters an example can never contain: line breaks, and surrogates (not real characters)
const FORBIDDEN = CharSet.from([[0x0a, 0x0a], [0x0d, 0x0d], [0xd800, 0xdfff]]);
const ALLOWED = FORBIDDEN.complement();
// a label without the forbidden characters (most labels have none, so are kept as they are)
const usableLabel = (label) => (label.intersect(FORBIDDEN).isEmpty() ? label : label.intersect(ALLOWED));
const range = (lo, hi) => [lo.codePointAt(0), hi.codePointAt(0)];
const POOLS = [
  CharSet.from([range("a", "z")]),
  CharSet.from([range("A", "Z"), range("0", "9"), range(" ", " ")]),
  CharSet.from([range("!", "~")]),
  CharSet.from([range("À", "ÿ")]).minus(CharSet.of(0xd7, 0xf7)), // Latin-1 letters, not × ÷
  CharSet.from([[0x100, 0x24f]]), // Latin Extended-A and B
  CharSet.from([[0x370, 0x4ff]]), // Greek and Cyrillic
];
// characters beyond the pools, which large sets also pick from (not × and ÷, which the
// Latin-1 pool leaves out on purpose, or ASCII control characters)
const BEYOND_POOLS = CharSet.from([[0x500, MAX_CP]]);
const PRINTABLE = /^[\p{L}\p{N}\p{P}\p{S}]$/u;
const SMALL_LABEL = 64; // labels this small contribute their characters to the preferred pool
const LENGTH_SPREAD = 10; // walks aim for up to this many characters more than the shortest

// Returns { examples, matchesEmpty }: up to `count` distinct non-empty examples not in
// `exclude`, and whether the empty string matches (it's left out, since a blank line would
// be invisible). Fewer examples are returned if the NFA matches few (showable) strings.
export function examples(nfa, { count = 5, random = Math.random, exclude = new Set(), attempts = count * 20 } = {}) {
  const g = removeEpsilons(nfa);
  const matchesEmpty = g.accepting.has(g.start);
  const usable = g.edges.map((es) => es.map((e) => usableLabel(e.label)));
  // the characters of small labels, gathered once (labels repeat a lot, as in word lists)
  const small = new Set(g.edges.flat().map((e) => e.label).filter((label) => label.size() <= SMALL_LABEL));
  const preferred = CharSet.from([...small].flatMap((label) => label.ranges.map(([lo, hi]) => [lo, hi]))).intersect(ALLOWED);
  const dist = distances(g, usable);

  const found = [];
  const seen = new Set(exclude);
  const add = (s) => {
    const normalized = s.normalize("NFC");
    // normalisation can merge characters (e plus a combining accent becomes é), so check
    if (normalized !== "" && !seen.has(normalized) && matches(g, normalized)) {
      seen.add(normalized);
      found.push(normalized);
    }
  };
  // the shortest non-empty example's length, since the empty string isn't shown
  const shortest = Math.min(...g.edges[g.start].map((e, i) => (usable[g.start][i].isEmpty() ? Infinity : 1 + dist[e.to])));
  if (shortest === Infinity) return { examples: found, matchesEmpty };

  // start with a shortest example, then random ones of the lengths that are possible
  add(shortestWalk(g, usable, dist, shortest, preferred));
  const paths = pathCounts(g, usable, shortest + LENGTH_SPREAD);
  const lengths = paths.map((level, n) => n).filter((n) => n > 0 && paths[n][g.start] > 0);
  for (let i = 0; i < attempts && found.length < count; i++) {
    // two uniform walks for every free one, in the order U F U U F U …, so that a batch of
    // five has two free walks when the shortest example is already known
    if (i % 3 !== 1 && lengths.length > 0) {
      add(uniformWalk(g, usable, paths, lengths[Math.floor(random() * lengths.length)], random, preferred));
    } else {
      const s = freeWalk(g, usable, dist, shortest + Math.floor(random() * (LENGTH_SPREAD + 1)), random, preferred);
      if (s !== null) add(s);
    }
  }
  return { examples: found, matchesEmpty };
}

// paths[n][s] is proportional to the number of paths of exactly n characters from state s to
// an accepting state, along edges with a usable character. Each level is scaled so its
// largest count is 1, since only ratios within a level matter and long paths can be very
// numerous.
function pathCounts(g, usable, maxLength) {
  // the usable edges as flat arrays: state s's targets are targets[first[s]..first[s + 1]]
  const n = g.edges.length;
  const first = new Int32Array(n + 1);
  const list = [];
  g.edges.forEach((es, s) => {
    first[s] = list.length;
    es.forEach((e, i) => {
      if (!usable[s][i].isEmpty()) list.push(e.to);
    });
  });
  first[n] = list.length;
  const targets = Int32Array.from(list);
  const paths = [Float64Array.from(g.edges, (_, s) => (g.accepting.has(s) ? 1 : 0))];
  for (let length = 1; length <= maxLength; length++) {
    const prev = paths[length - 1];
    const level = new Float64Array(n);
    let max = 0;
    for (let s = 0; s < n; s++) {
      let total = 0;
      for (let k = first[s]; k < first[s + 1]; k++) total += prev[targets[k]];
      level[s] = total;
      if (total > max) max = total;
    }
    if (max > 0) for (let s = 0; s < n; s++) level[s] /= max;
    paths.push(level);
  }
  return paths;
}

// number of characters needed to get from each state to an accepting one, using edges
// that have a usable character
function distances(g, usable) {
  const reverse = g.edges.map(() => []);
  usable.forEach((es, s) => es.forEach((label, i) => {
    if (!label.isEmpty()) reverse[g.edges[s][i].to].push(s);
  }));
  const dist = g.edges.map((_, s) => (g.accepting.has(s) ? 0 : Infinity));
  const queue = [...g.accepting];
  for (let i = 0; i < queue.length; i++) {
    for (const s of reverse[queue[i]]) {
      if (dist[s] === Infinity) {
        dist[s] = dist[queue[i]] + 1;
        queue.push(s);
      }
    }
  }
  return dist;
}

// A shortest non-empty example, of length n: a first step that leaves n − 1 characters to go
// (needed when the start state accepts), then always the first edge that gets closer to an
// accepting state.
function shortestWalk(g, usable, dist, n, preferred) {
  const chars = [];
  const step = (s, i) => {
    chars.push(String.fromCodePoint(pickChar(usable[s][i], () => 0, preferred)));
    return g.edges[s][i].to;
  };
  let s = step(g.start, g.edges[g.start].findIndex((e, i) => !usable[g.start][i].isEmpty() && 1 + dist[e.to] === n));
  while (dist[s] > 0) s = step(s, g.edges[s].findIndex((e, i) => !usable[s][i].isEmpty() && dist[e.to] === dist[s] - 1));
  return chars.join("");
}

// A random path of exactly n characters to an accepting state (there must be one), each step
// weighted by the number of ways to finish from where it leads.
function uniformWalk(g, usable, paths, n, random, preferred) {
  const chars = [];
  for (let s = g.start, left = n; left > 0; left--) {
    const weights = g.edges[s].map((e, i) => (usable[s][i].isEmpty() ? 0 : paths[left - 1][e.to]));
    let r = random() * weights.reduce((x, y) => x + y, 0);
    let i = 0;
    while (i < weights.length - 1 && (r >= weights[i] || weights[i] === 0)) r -= weights[i++];
    chars.push(String.fromCodePoint(pickChar(usable[s][i], random, preferred)));
    s = g.edges[s][i].to;
  }
  return chars.join("");
}

// A walk that goes anywhere until it has `target` characters, then heads for the nearest
// accepting state. Returns null if it can't finish.
function freeWalk(g, usable, dist, target, random, preferred) {
  const chars = [];
  let s = g.start;
  for (;;) {
    const done = chars.length >= target;
    if (done && g.accepting.has(s)) return chars.join("");
    const options = [];
    g.edges[s].forEach((e, i) => {
      const label = usable[s][i];
      if (label.isEmpty() || dist[e.to] === Infinity) return;
      if (done && dist[e.to] !== dist[s] - 1) return;
      options.push([label, e.to]);
    });
    if (options.length === 0) return g.accepting.has(s) ? chars.join("") : null;
    const [label, to] = options[Math.floor(random() * options.length)];
    chars.push(String.fromCodePoint(pickChar(label, random, preferred)));
    s = to;
  }
}

// Pick a readable character from a set: half the time one of the characters the pattern
// mentions explicitly, and otherwise from the pools (a-z, then A-Z 0-9 and space, ASCII
// punctuation, Latin-1 letters, Latin Extended, Greek and Cyrillic), then any printable
// character, then anything.
//
// A set of almost anything, like . or [^a], uses the first pool it overlaps, so examples are
// mostly plain letters. Other large sets, like \p{Lu}, use any pool they overlap, or the rest
// of the set, chosen at random, so their examples show their variety.
export function pickChar(set, random = Math.random, preferred = CharSet.EMPTY) {
  const fromPreferred = set.intersect(preferred);
  if (!fromPreferred.isEmpty() && random() < 0.5) return member(fromPreferred, random);
  const options = POOLS.map((pool) => set.intersect(pool)).filter((s) => !s.isEmpty());
  const anything = set.size() > MAX_CP / 2;
  if (options.length && anything) return member(options[0], random);
  if (options.length) {
    const rest = set.intersect(BEYOND_POOLS);
    const choice = Math.floor(random() * (options.length + (rest.isEmpty() ? 0 : 1)));
    if (choice < options.length) return member(options[choice], random);
    const cp = printableMember(rest, random);
    if (cp !== null) return cp;
    return member(options[0], random);
  }
  if (!fromPreferred.isEmpty()) return member(fromPreferred, random);
  return printableMember(set, random) ?? member(set, random);
}

// most of a large set can be unassigned or unprintable, so sample a few times before giving up
function printableMember(set, random) {
  for (let i = 0; i < 20; i++) {
    const cp = member(set, random);
    if (PRINTABLE.test(String.fromCodePoint(cp))) return cp;
  }
  return null;
}

// a random member of a non-empty set
function member(set, random) {
  let index = Math.floor(random() * set.size());
  for (const [lo, hi] of set.ranges) {
    if (index <= hi - lo) return lo + index;
    index -= hi - lo + 1;
  }
  return Math.min(set.ranges[0][0], MAX_CP); // only reached if random() returned 1
}
