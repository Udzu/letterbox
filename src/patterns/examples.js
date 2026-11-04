// Generating example strings that an NFA matches.
//
// Examples come from random walks on the NFA without ε-moves, which is cheap to build (unlike
// a DFA, which can be exponentially larger). Each walk picks a target length; once it reaches
// it, it only follows edges that get closer to an accepting state, so it always finishes soon.
// Characters are picked from readable pools first (see pickChar), and newlines are never
// used, since examples are shown one per line.

import { CharSet, MAX_CP } from "./charset.js";
import { matches, removeEpsilons } from "./nfa.js";

// characters an example can never contain: line breaks, and surrogates (not real characters)
const FORBIDDEN = CharSet.from([[0x0a, 0x0a], [0x0d, 0x0d], [0xd800, 0xdfff]]);
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
  const usable = g.edges.map((es) => es.map((e) => e.label.minus(FORBIDDEN)));
  const preferred = g.edges
    .flat()
    .filter((e) => e.label.size() <= SMALL_LABEL)
    .reduce((set, e) => set.union(e.label), CharSet.EMPTY)
    .minus(FORBIDDEN);
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
  if (dist[g.start] === Infinity) return { examples: found, matchesEmpty };

  // start with a shortest example, then random ones of varying lengths
  add(walk(g, usable, dist, dist[g.start], random, preferred, true));
  for (let i = 0; i < attempts && found.length < count; i++) {
    const target = dist[g.start] + Math.floor(random() * (LENGTH_SPREAD + 1));
    const s = walk(g, usable, dist, target, random, preferred, false);
    if (s !== null) add(s);
  }
  return { examples: found, matchesEmpty };
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

// A walk that goes anywhere until it has `target` characters, then heads for the nearest
// accepting state. With `shortest`, it only ever heads for acceptance and picks the first
// option each time, giving a shortest example. Returns null if it can't finish.
function walk(g, usable, dist, target, random, preferred, shortest) {
  const chars = [];
  let s = g.start;
  for (;;) {
    const done = chars.length >= target;
    if (done && g.accepting.has(s)) return chars.join("");
    const options = [];
    g.edges[s].forEach((e, i) => {
      const label = usable[s][i];
      if (label.isEmpty() || dist[e.to] === Infinity) return;
      if ((done || shortest) && dist[e.to] !== dist[s] - 1) return;
      options.push([label, e.to]);
    });
    if (options.length === 0) return g.accepting.has(s) ? chars.join("") : null;
    const [label, to] = shortest ? options[0] : options[Math.floor(random() * options.length)];
    chars.push(String.fromCodePoint(pickChar(label, shortest ? () => 0 : random, preferred)));
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
