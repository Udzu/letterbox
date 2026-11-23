// The Ladders game's logic: which words can be used, which changes are allowed, and finding
// puzzles (a start and an end word a given number of steps apart) with a shortest ladder.

import { entryInfo, letters } from "../words/game.js";

export { entryInfo, letters };

// Whether an entry's info can be used with the given settings: its letters are all A–Z, it's
// only a phrase if phrases are allowed, and it only has capitals if capitals are allowed.
const usable = ({ entry, key, phrase }, { phrases, capitals }) =>
  key !== null && (phrases || !phrase) && (capitals || !/\p{Lu}/u.test(entry));

// The keys of some entries' infos that can be used, each with the entries it came from,
// optionally only those of one length.
export function keysOf(infos, settings, length = null) {
  const keys = new Map();
  for (const info of infos) {
    if (!usable(info, settings) || (length !== null && info.key.length !== length)) continue;
    if (!keys.has(info.key)) keys.set(info.key, []);
    keys.get(info.key).push(info.entry);
  }
  return keys;
}

// The words for a puzzle, from the infos of the word list's and @ list's entries (null if
// there's no @ list): `pool` holds the words used to pick puzzles and measure their length
// (the @ list's if there is one, otherwise the word list's), each with its entries, and
// `allowed` the words that can be played (from either list).
export function ladderWords(words, at, settings) {
  const pool = keysOf(at ?? words, settings, settings.length);
  const allowed = new Set(pool.keys());
  for (const key of keysOf(words, settings, settings.length).keys()) allowed.add(key);
  return { pool, allowed };
}

// Whether b is one step from a: the same length, with exactly one letter changed.
export function isStep(a, b) {
  if (a.length !== b.length) return false;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++diffs > 1) return false;
  return diffs === 1;
}

// Why b can't follow a, or null if it can.
export function stepError(a, b) {
  if (a.length !== b.length) return "Keep the same number of letters";
  let diffs = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
  if (diffs === 0) return "Change a letter";
  if (diffs > 1) return `Change only one letter, not ${diffs}`;
  return null;
}

// The graph of steps between some words: words[i] and the indexes of the words one step away.
// Words one step apart share a pattern with one letter blanked ("C_KE"), so they're found by
// grouping the words by those patterns.
export function buildGraph(keys) {
  const words = [...keys];
  const index = new Map(words.map((w, i) => [w, i]));
  const groups = new Map();
  words.forEach((w, i) => {
    for (let j = 0; j < w.length; j++) {
      const pattern = `${w.slice(0, j)}_${w.slice(j + 1)}`;
      if (!groups.has(pattern)) groups.set(pattern, []);
      groups.get(pattern).push(i);
    }
  });
  const next = words.map(() => []);
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const i of group) for (const j of group) if (i !== j) next[i].push(j);
  }
  return { words, index, next };
}

// The distance (in steps) from one word to every other, -1 where there's no ladder, and the
// word before each on a shortest ladder from it.
export function distances({ words, next }, from) {
  const dist = new Int32Array(words.length).fill(-1);
  const prev = new Int32Array(words.length).fill(-1);
  dist[from] = 0;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    for (const j of next[i]) {
      if (dist[j] !== -1) continue;
      dist[j] = dist[i] + 1;
      prev[j] = i;
      queue.push(j);
    }
  }
  return { dist, prev };
}

// A shortest ladder from `from` to `to`, as words, given `distances` from `from`.
function path(graph, { prev }, to) {
  const out = [];
  for (let i = to; i !== -1; i = prev[i]) out.push(graph.words[i]);
  return out.reverse();
}

// A shortest ladder between two words of the graph, or null if there's none.
export function shortestLadder(graph, a, b) {
  const from = graph.index.get(a), to = graph.index.get(b);
  if (from === undefined || to === undefined) return null;
  const d = distances(graph, from);
  return d.dist[to] === -1 ? null : path(graph, d, to);
}

// A puzzle length from 2 to `steps`, each twice as likely as the one below it, so "4 or
// fewer" gives 4, 3 and 2 steps with weights 4, 2 and 1.
export function fewerLength(steps, random = Math.random) {
  let r = random() * (2 ** (steps - 1) - 1); // the total weight, 1 + 2 + … + 2^(steps − 2)
  for (let k = steps; k > 2; k--) {
    r -= 2 ** (k - 2);
    if (r < 0) return k;
  }
  return 2;
}

// A puzzle whose shortest ladder (within the graph) is `steps` long, or, if `fewer`, between 2
// and `steps` long, picked at random: { start, end, ladder } (the ladder runs from start to
// end), or null if none was found in `tries` attempts. Each attempt picks a length (in
// `fewer` mode, with fewerLength) and a start word, and then an end word that far from it.
export function makePuzzle(graph, { steps, fewer }, random = Math.random, tries = 200) {
  const n = graph.words.length;
  if (n < 2) return null;
  const pick = (k) => Math.floor(random() * k);
  for (let t = 0; t < tries; t++) {
    const want = fewer ? fewerLength(steps, random) : steps;
    const from = pick(n);
    if (!graph.next[from].length) continue;
    const d = distances(graph, from);
    const ends = [];
    for (let i = 0; i < n; i++) if (d.dist[i] === want) ends.push(i);
    if (!ends.length) continue;
    const ladder = path(graph, d, ends[pick(ends.length)]);
    return { start: ladder[0], end: ladder.at(-1), ladder };
  }
  return null;
}
