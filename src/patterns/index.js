// Public API for the patterns engine.
//
// Patterns and the strings matched against them are normalised to NFC, so that "é" typed
// as one code point or as "e" plus a combining accent behaves the same. Parse error spans
// refer to the normalised pattern, which is almost always identical to what was typed.

import { parse, PatternError } from "./parser.js";
import { compile as compileAst } from "./compile.js";
import { MAX_STATES, TooManyStatesError, matches as nfaMatches, run as nfaRun, withStateLimit } from "./nfa.js";

export { parse, format, PatternError } from "./parser.js";
export { CharSet } from "./charset.js";
export { formatLabel, toDot } from "./display.js";
export { NFA, TooManyStatesError, closure, trim, removeEpsilons, determinize, complement, intersect, reverse, minimize, limitFor, withStateLimit } from "./nfa.js";

// a pattern using the word list may have this many states per state of the list's automaton,
// on top of the usual limit
const WORDS_FACTOR = 10;

// pattern string → NFA (throws PatternError); { words } is the word list's automaton, if any
export function compile(pattern, { words } = {}) {
  const normalized = pattern.normalize("NFC");
  const ast = parse(normalized);
  const usesWords = words !== undefined && containsWords(ast);
  const limit = MAX_STATES + (usesWords ? WORDS_FACTOR * words.size : 0);
  try {
    return withStateLimit(limit, () => compileAst(ast, { words }));
  } catch (e) {
    if (e instanceof TooManyStatesError) {
      const hint = usesWords ? " (combining the word list with itself or with other large patterns can be too much)" : "";
      throw new PatternError(`Pattern is too complex: ${e.message}${hint}`, 0, normalized.length);
    }
    throw e;
  }
}

function containsWords(node) {
  if (node.type === "words") return true;
  return [node.node, node.left, node.right, node.find, node.insert, node.split, ...(node.items ?? [])]
    .some((child) => child && containsWords(child));
}

export function matches(nfa, string) {
  return nfaMatches(nfa, string.normalize("NFC"));
}

export function run(nfa, string) {
  return nfaRun(nfa, string.normalize("NFC"));
}
