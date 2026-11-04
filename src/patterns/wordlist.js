// Word lists, and finding the words in one that a pattern matches.

import { closure } from "./nfa.js";

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

// A function that tells whether the NFA matches a string, building the DFA lazily: each
// DFA state (a set of NFA states) and its move on each character is worked out the first
// time it's needed and then remembered. Matching many words, which share most of their
// prefixes and characters, then costs about one lookup per character. Strings must already
// be normalised.
export function matcher(nfa) {
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
  return (string) => {
    let d = start;
    for (const c of string) {
      const cp = c.codePointAt(0);
      let next = moves[d].get(cp);
      if (next === undefined) {
        const targets = [];
        for (const s of sets[d]) {
          for (const { label, to } of nfa.edges[s]) if (label !== null && label.has(cp)) targets.push(to);
        }
        next = intern(closure(nfa, targets));
        moves[d].set(cp, next);
      }
      if (next === dead) return false;
      d = next;
    }
    return accepting[d];
  };
}
