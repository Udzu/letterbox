// The Ladders game's logic: which words can be used, which changes are allowed, and finding
// puzzles (a start and an end word a given number of steps apart) with a shortest ladder.

import { entryInfo, letters } from "../words/game.js";

export { entryInfo, letters };

// Whether an entry's info can be used with the given settings: its letters are all A–Z, it's
// only a phrase if phrases are allowed, and it only has capitals if capitals are allowed.
const usable = ({ entry, key, phrase }, { phrases, capitals }) =>
  key !== null && (phrases || !phrase) && (capitals || !/\p{Lu}/u.test(entry));

// How much longer or shorter than the start word a word in the ladder can be, when letters
// can be added and removed (more makes the graph much bigger for little gain).
export const LENGTH_SPREAD = 2;

// The lengths a word in the ladder can have: just the start word's, or a range around it
// when letters can be added and removed.
export const lengthRange = ({ length, addRemove }) =>
  addRemove ? [Math.max(1, length - LENGTH_SPREAD), length + LENGTH_SPREAD] : [length, length];

// The keys of some entries' infos that can be used, each with the entries it came from,
// optionally only those with lengths in a range.
export function keysOf(infos, settings, [min, max] = [1, Infinity]) {
  const keys = new Map();
  for (const info of infos) {
    if (!usable(info, settings) || info.key.length < min || info.key.length > max) continue;
    if (!keys.has(info.key)) keys.set(info.key, []);
    keys.get(info.key).push(info.entry);
  }
  return keys;
}

// The words for a puzzle, from the infos of the word list's and @ list's entries (null if
// there's no @ list): `pool` holds the words used to pick puzzles and measure their length
// (the @ list's if there is one, otherwise the word list's), each with its entries, and
// `allowed` the words that can be played (from either list). Both have only the lengths a
// ladder can use; puzzles start and end with words of the chosen length.
export function ladderWords(words, at, settings) {
  const range = lengthRange(settings);
  const pool = keysOf(at ?? words, settings, range);
  const allowed = new Set(pool.keys());
  for (const key of keysOf(words, settings, range).keys()) allowed.add(key);
  return { pool, allowed };
}

// Whether b is a (no shorter than a) with one letter added.
function isAddition(a, b) {
  if (b.length !== a.length + 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i) === b.slice(i + 1);
}

// The kind of step from a to b ("change", "swap", "add" or "remove"), whatever the
// settings allow, or null if it isn't one step. A swap exchanges any two letters.
export function stepKind(a, b) {
  if (b.length === a.length + 1) return isAddition(a, b) ? "add" : null;
  if (b.length === a.length - 1) return isAddition(b, a) ? "remove" : null;
  if (a.length !== b.length) return null;
  const diffs = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs.push(i);
  if (diffs.length === 1) return "change";
  if (diffs.length === 2 && a[diffs[0]] === b[diffs[1]] && a[diffs[1]] === b[diffs[0]]) return "swap";
  return null;
}

const allowedKind = (kind, { swaps = false, addRemove = false } = {}) =>
  kind === "change" || (kind === "swap" && swaps) || ((kind === "add" || kind === "remove") && addRemove);

// Whether b is one step from a with the moves the settings allow.
export const isStep = (a, b, moves) => allowedKind(stepKind(a, b), moves);

// Why b can't follow a with the moves the settings allow, or null if it can.
export function stepError(a, b, moves = {}) {
  if (isStep(a, b, moves)) return null;
  if (a === b) return "Change a letter";
  const kind = stepKind(a, b);
  if (kind === "swap") return "Swapping letters isn't allowed";
  if (kind === "add" || kind === "remove") return "Adding and removing letters isn't allowed";
  if (a.length !== b.length) {
    if (!moves.addRemove) return "Keep the same number of letters";
    return Math.abs(a.length - b.length) > 1 ? "Add or remove only one letter" : "Add or remove one letter, keeping the rest in order";
  }
  let diffs = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
  return moves.swaps ? "Change one letter, or swap two" : `Change only one letter, not ${diffs}`;
}

// The positions of b's letters that a step from a changed or added: the changed or swapped
// letters, or the added one (the first place it could have gone). For other pairs of words,
// the letters that differ from a's in the same place.
export function changedPositions(a, b) {
  const kind = stepKind(a, b);
  if (kind === "remove") return [];
  if (kind === "add") {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return [i];
  }
  const out = [];
  for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

// The graph of steps between some words, with the given moves: words[i] and the indexes of the
// words one step away. Changes are found by grouping the words by patterns with one letter
// blanked ("C_KE"), and swaps and removals by looking each word's up.
export function buildGraph(keys, moves = {}) {
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
  const next = words.map(() => new Set());
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const i of group) for (const j of group) if (i !== j) next[i].add(j);
  }
  words.forEach((w, i) => {
    if (moves.swaps) {
      for (let a = 0; a < w.length; a++) {
        for (let b = a + 1; b < w.length; b++) {
          if (w[a] === w[b]) continue;
          const j = index.get(w.slice(0, a) + w[b] + w.slice(a + 1, b) + w[a] + w.slice(b + 1));
          if (j !== undefined) next[i].add(j);
        }
      }
    }
    if (moves.addRemove) {
      for (let a = 0; a < w.length; a++) {
        const j = index.get(w.slice(0, a) + w.slice(a + 1));
        if (j !== undefined) {
          next[i].add(j);
          next[j].add(i);
        }
      }
    }
  });
  return { words, index, next: next.map((set) => [...set]) };
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
// `fewer` mode, with fewerLength) and a start word, and then an end word that far from it;
// with a `length`, both have that length.
export function makePuzzle(graph, { steps, fewer, length = null }, random = Math.random, tries = 200) {
  const fits = (i) => length === null || graph.words[i].length === length;
  const starts = graph.words.map((_, i) => i).filter((i) => fits(i) && graph.next[i].length);
  if (!starts.length) return null;
  const pick = (k) => Math.floor(random() * k);
  for (let t = 0; t < tries; t++) {
    const want = fewer ? fewerLength(steps, random) : steps;
    const from = starts[pick(starts.length)];
    const d = distances(graph, from);
    const ends = [];
    for (let i = 0; i < graph.words.length; i++) if (d.dist[i] === want && fits(i)) ends.push(i);
    if (!ends.length) continue;
    const ladder = path(graph, d, ends[pick(ends.length)]);
    return { start: ladder[0], end: ladder.at(-1), ladder };
  }
  return null;
}
