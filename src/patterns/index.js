// Public API for the patterns engine.
//
// Patterns and the strings matched against them are normalised to NFC, so that "é" typed
// as one code point or as "e" plus a combining accent behaves the same. Parse error spans
// refer to the normalised pattern, which is almost always identical to what was typed.

import { parse, PatternError } from "./parser.js";
import { compile as compileAst } from "./compile.js";
import { TooManyStatesError, matches as nfaMatches, run as nfaRun } from "./nfa.js";

export { parse, format, PatternError } from "./parser.js";
export { CharSet } from "./charset.js";
export { formatLabel, toDot } from "./display.js";
export { NFA, TooManyStatesError, closure, trim, removeEpsilons, determinize, complement, intersect, reverse, minimize } from "./nfa.js";

// pattern string → NFA (throws PatternError)
export function compile(pattern) {
  const normalized = pattern.normalize("NFC");
  const ast = parse(normalized);
  try {
    return compileAst(ast);
  } catch (e) {
    if (e instanceof TooManyStatesError) throw new PatternError(`Pattern is too complex: ${e.message}`, 0, normalized.length);
    throw e;
  }
}

export function matches(nfa, string) {
  return nfaMatches(nfa, string.normalize("NFC"));
}

export function run(nfa, string) {
  return nfaRun(nfa, string.normalize("NFC"));
}
