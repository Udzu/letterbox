// Word lists, and finding the words in one that a pattern matches.

import { CharSet } from "./charset.js";
import { Builder, closure, markDeterministic } from "./nfa.js";

// The words in a list's text: each non-empty line, without a trailing \r, normalised to NFC
// like everything else. Spaces are kept, so a list can hold phrases. Duplicates are dropped.
export function parseWords(text) {
  const words = new Set();
  for (const line of text.split("\n")) {
    const word = line.replace(/\r$/, "").normalize("NFC");
    if (word !== "") words.add(word);
  }
  return [...words];
}

// The NFA's DFA, built lazily: each DFA state (a set of NFA states) and its move on each
// character is worked out the first time it's needed and then remembered. States are
// numbers: `start`, `dead` (no NFA states), and whatever step(d, cp) returns. states(d) is
// the sorted NFA states in d.
export function lazyDfa(nfa) {
  const ids = new Map();
  const sets = [];
  const accepting = [];
  const moves = [];
  const intern = (set) => {
    const members = [...set].sort((x, y) => x - y);
    const key = members.join(",");
    if (!ids.has(key)) {
      ids.set(key, sets.length);
      sets.push(members);
      accepting.push(members.some((s) => nfa.accepting.has(s)));
      moves.push(new Map());
    }
    return ids.get(key);
  };
  const start = intern(closure(nfa, [nfa.start]));
  const dead = intern(new Set());
  const step = (d, cp) => {
    let next = moves[d].get(cp);
    if (next === undefined) {
      const targets = [];
      for (const s of sets[d]) {
        for (const { label, to } of nfa.edges[s]) if (label !== null && label.has(cp)) targets.push(to);
      }
      next = intern(closure(nfa, targets));
      moves[d].set(cp, next);
    }
    return next;
  };
  return { nfa, start, dead, step, accepts: (d) => accepting[d], states: (d) => sets[d] };
}

// A function that tells whether the NFA matches a string, using its lazy DFA. Matching many
// words, which share most of their prefixes and characters, then costs about one lookup per
// character. Strings must already be normalised.
export function matcher(nfa) {
  const { start, dead, step, accepts } = lazyDfa(nfa);
  return (string) => {
    let d = start;
    for (const c of string) {
      d = step(d, c.codePointAt(0));
      if (d === dead) return false;
    }
    return accepts(d);
  };
}

// The minimal DFA matching exactly the given words (a DAWG): a trie of the words, with
// equivalent states merged bottom-up, since two states are equivalent when they're both
// accepting or not and have the same moves to the same (already merged) states. Its size
// can be well above the usual state limit, so it has its own.
export function wordsAutomaton(words, limit = Infinity) {
  // the trie: each node is { final, next: Map cp → node }
  const root = { final: false, next: new Map() };
  for (const word of words) {
    let node = root;
    for (const c of word) {
      const cp = c.codePointAt(0);
      let child = node.next.get(cp);
      if (!child) node.next.set(cp, (child = { final: false, next: new Map() }));
      node = child;
    }
    node.final = true;
  }
  // number the distinct states, children first, so a state's signature can use their ids
  const ids = new Map(); // signature → id
  const states = []; // id → { final, moves: [[cp, id]] }
  const idOf = new Map(); // node → id
  const stack = [[root, false]];
  while (stack.length) {
    const [node, expanded] = stack.pop();
    if (!expanded) {
      stack.push([node, true]);
      for (const child of node.next.values()) stack.push([child, false]);
      continue;
    }
    const moves = [...node.next].map(([cp, child]) => [cp, idOf.get(child)]).sort((x, y) => x[0] - y[0]);
    const signature = `${node.final ? 1 : 0}|${moves.join(";")}`;
    if (!ids.has(signature)) {
      ids.set(signature, states.length);
      states.push({ final: node.final, moves });
    }
    idOf.set(node, ids.get(signature));
  }
  const b = new Builder(limit);
  for (let i = 0; i < states.length; i++) b.state();
  const accepting = [];
  states.forEach(({ final, moves }, i) => {
    if (final) accepting.push(i);
    for (const [cp, to] of moves) b.edge(i, CharSet.of(cp), to);
  });
  return markDeterministic(b.build(idOf.get(root), accepting));
}
