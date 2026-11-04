// Public API for the patterns engine.
//
// Patterns and the strings matched against them are normalised to NFC, so that "é" typed
// as one code point or as "e" plus a combining accent behaves the same. Parse error spans
// refer to the normalised pattern, which is almost always identical to what was typed.

import { parse, PatternError } from "./parser.js";
import { compile as compileAst } from "./compile.js";
import { explainer as explainerAst, layout } from "./explain.js";
import { MAX_STATES, TooManyStatesError, limitFor, matches as nfaMatches, run as nfaRun, withStateLimit } from "./nfa.js";

export { parse, format, PatternError } from "./parser.js";
export { CharSet } from "./charset.js";
export { formatLabel, toDot } from "./display.js";
export { TooComplexToExplain } from "./explain.js";
export { NFA, TooManyStatesError, closure, trim, removeEpsilons, determinize, complement, intersect, reverse, minimize, limitFor, withStateLimit } from "./nfa.js";

// a pattern using the word list may have this many states per state of the list's automaton,
// on top of the usual limit
const WORDS_FACTOR = 10;

// pattern string → NFA (throws PatternError); { words } is the word list's automaton, if any
export function compile(pattern, { words } = {}) {
  const normalized = pattern.normalize("NFC");
  const ast = parse(normalized);
  const usesWords = words !== undefined && containsWords(ast);
  const limit = stateLimit(ast, words);
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

function stateLimit(ast, words) {
  return MAX_STATES + (words !== undefined && containsWords(ast) ? WORDS_FACTOR * words.size : 0);
}

// A function that explains how a string matches the pattern (see explain.js), as rows for
// display, or returns null if it doesn't match. { nfa } is the pattern's compiled NFA. It
// throws TooComplexToExplain or TooManyStatesError if the explanation takes too long.
export function explainer(pattern, { words, nfa } = {}) {
  const normalized = pattern.normalize("NFC");
  const ast = parse(normalized);
  const limit = Math.max(stateLimit(ast, words), nfa ? limitFor(nfa) : 0);
  const explain = explainerAst(ast, { words, nfa });
  return (string) => withStateLimit(limit, () => {
    const tree = explain(string.normalize("NFC"));
    return tree && layout(tree, normalized);
  });
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
