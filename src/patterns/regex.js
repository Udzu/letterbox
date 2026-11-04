// Converting an NFA into an equivalent standard regular expression, by state elimination.
//
// Edges are labelled with regular expressions, and states are removed one at a time: removing
// k replaces each path i → k → j by a direct edge i → j labelled L(i,k) L(k,k)* L(k,j). The
// order matters a lot for the size of the result, so each step removes the state that adds
// the least (the Delgado-Morais weight heuristic), breaking ties by state number.
//
// Expressions are simplified as they're built (see alt, cat and rep below), and the result
// is written in the syntax PCRE and JavaScript (with the u flag) have in common, except that
// unprintable characters above U+FF are written \u{...}, which only JavaScript accepts.

import { CharSet } from "./charset.js";
import { mergeEquivalent, minimize, removeEpsilons, TooManyStatesError } from "./nfa.js";

export const LIMITS = { dfaStates: 2000, states: 200, length: 2000 };
export const UNLIMITED = { dfaStates: 50000, states: 5000, length: 1e6 };

// Returns { regex } with an anchored JavaScript regex, or { tooComplex: reason }.
export function toRegex(nfa, limits = LIMITS) {
  // far too large to end up within the limits, and slow even to try
  if (nfa.size > 10 * limits.dfaStates) return { tooComplex: "the automaton is too large" };
  const candidates = [];
  try {
    candidates.push(minimize(nfa, { maxStates: limits.dfaStates }));
  } catch (e) {
    if (!(e instanceof TooManyStatesError)) throw e;
  }
  // The NFA can be much smaller than the DFA, as for (a|b)*a(a|b){10}, and even when it isn't
  // it often reads better, since the DFA tracks things a regex needn't say: the DFA for
  // the<[a-z]* tracks the first "the", giving a long regex rather than [a-z]*the[a-z]*
  candidates.push(mergeEquivalent(removeEpsilons(nfa)));

  let best = null;
  let reason = "the automaton is too large";
  for (const automaton of candidates) {
    if (automaton.size > limits.states) continue;
    const node = eliminate(automaton, limits.length);
    if (node === null) {
      reason = "the result is too long";
      continue;
    }
    const regex = toJs(node);
    if (regex.length > limits.length) reason = "the result is too long";
    else if (best === null || regex.length < best.length) best = regex;
  }
  return best === null ? { tooComplex: reason } : { regex: best };
}

// --- expressions ---
//
// Nodes: { t: "empty" } matches nothing, { t: "eps" } the empty string, { t: "set", cs } one
// character, { t: "cat", items }, { t: "alt", items } and { t: "rep", node, min, max } (max
// may be Infinity). Each has a `key` (equal keys mean equal expressions) and a `size`.

const EMPTY = node({ t: "empty" }, "0", 1);
const EPS = node({ t: "eps" }, "e", 0);

function node(fields, key, size) {
  return Object.freeze({ ...fields, key, size });
}

function set(cs) {
  return cs.isEmpty() ? EMPTY : node({ t: "set", cs }, `[${cs.ranges.join(";")}]`, 1);
}

function nullable(n) {
  switch (n.t) {
    case "eps": return true;
    case "empty": case "set": return false;
    case "cat": return n.items.every(nullable);
    case "alt": return n.items.some(nullable);
    case "rep": return n.min === 0 || nullable(n.node);
  }
}

// the parts of an expression as a sequence
const parts = (n) => (n.t === "cat" ? n.items : n.t === "eps" ? [] : [n]);

export function cat(items) {
  const flat = items.flatMap(parts);
  if (flat.some((n) => n.t === "empty")) return EMPTY;
  const out = [];
  for (const item of flat) {
    out.push(item);
    mergeTail(out);
  }
  if (out.length === 0) return EPS;
  if (out.length === 1) return out[0];
  return node({ t: "cat", items: out }, `(${out.map((n) => n.key).join(",")})`, out.reduce((s, n) => s + n.size, 0));
}

// Merge the end of a sequence into what comes before it where possible:
// X{a,b}X{c,d} → X{a+c,b+d} (so XX* → X+ and XX → X{2}), and the same for a repeated
// sequence written out next to it, as in (ab)*ab → (ab)+ and ab(ab)* → (ab)+. A repeat can
// itself be the X, as in X{2}(X{2})* → (X{2})+.
function mergeTail(out) {
  const counts = (n) => (n.t === "rep" ? [n.node, n.min, n.max] : [n, 1, 1]);
  // the ways to see an expression as something repeated: a repeat as its body or as a whole
  const views = (n) => (n.t === "rep" ? [counts(n), [n, 1, 1]] : [counts(n)]);
  const same = (seq, from) => seq.every((m, i) => out[from + i]?.key === m.key);
  const replace = (from, count, r) => out.splice(from, count, ...parts(r));
  outer: for (;;) {
    const end = out.length - 1;
    if (end < 1) return;
    for (const [prevBase, prevMin, prevMax] of views(out[end - 1])) {
      for (const [base, min, max] of views(out[end])) {
        if (base.key === prevBase.key) {
          replace(end - 1, 2, rep(base, prevMin + min, prevMax + max));
          continue outer;
        }
      }
    }
    const [base, min, max] = counts(out[end]);
    // a repeated sequence, with the sequence written out just before it
    const seq = parts(base);
    if (out[end].t === "rep" && seq.length > 1 && end >= seq.length && same(seq, end - seq.length)) {
      replace(end - seq.length, seq.length + 1, rep(base, min + 1, max + 1));
      continue;
    }
    // a repeated sequence, followed by the sequence written out
    const found = out.findIndex((n, i) => n.t === "rep" && parts(n.node).length > 1 && i + parts(n.node).length === end);
    if (found >= 0 && same(parts(out[found].node), found + 1)) {
      const r = out[found];
      replace(found, parts(r.node).length + 1, rep(r.node, r.min + 1, r.max + 1));
      continue;
    }
    return;
  }
}

export function alt(items) {
  let flat = items.flatMap((n) => (n.t === "alt" ? n.items : [n])).filter((n) => n.t !== "empty");
  // merge single characters into one set, in the position of the first
  const sets = flat.filter((n) => n.t === "set");
  if (sets.length > 1) {
    const merged = set(sets.reduce((cs, n) => cs.union(n.cs), CharSet.EMPTY));
    flat = flat.flatMap((n) => (n === sets[0] ? [merged] : n.t === "set" ? [] : [n]));
  }
  // X{a,b}|X{c,d} → X{min,max} when the counts overlap or touch, as in a|a{2,} → a+
  for (let i = 0; i < flat.length; i++) {
    for (let j = i + 1; j < flat.length; j++) {
      const [x, a, b] = flat[i].t === "rep" ? [flat[i].node, flat[i].min, flat[i].max] : [flat[i], 1, 1];
      const [y, c, d] = flat[j].t === "rep" ? [flat[j].node, flat[j].min, flat[j].max] : [flat[j], 1, 1];
      if (x.key === y.key && c <= b + 1 && a <= d + 1) {
        flat[i] = rep(x, Math.min(a, c), Math.max(b, d));
        flat.splice(j, 1);
        j = i;
      }
    }
  }
  // remove duplicates
  const seen = new Set();
  flat = flat.filter((n) => !seen.has(n.key) && seen.add(n.key));
  // ε|A → A? (or just A if A already matches the empty string)
  if (flat.some((n) => n.t === "eps")) {
    const rest = alt(flat.filter((n) => n.t !== "eps"));
    return rest.t === "empty" ? EPS : nullable(rest) ? rest : rep(rest, 0, 1);
  }
  flat = factor(factor(flat, false), true);
  if (flat.length === 0) return EMPTY;
  if (flat.length === 1) return flat[0];
  return node({ t: "alt", items: flat }, `{${flat.map((n) => n.key).join("|")}}`, flat.reduce((s, n) => s + n.size, flat.length - 1));
}

// factor out common first (or, with fromEnd, last) parts: AB|AC → A(B|C)
function factor(items, fromEnd) {
  const groups = new Map();
  for (const item of items) {
    const ps = parts(item);
    const key = ps.length ? ps[fromEnd ? ps.length - 1 : 0].key : item.key;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  if (groups.size === items.length) return items;
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const ps = parts(group[0]);
    const shared = ps[fromEnd ? ps.length - 1 : 0];
    const rests = group.map((n) => {
      const p = parts(n);
      return cat(fromEnd ? p.slice(0, -1) : p.slice(1));
    });
    return fromEnd ? cat([alt(rests), shared]) : cat([shared, alt(rests)]);
  });
}

export function rep(x, min, max) {
  if (max === 0 || x.t === "eps") return EPS;
  if (x.t === "empty") return min === 0 ? EPS : EMPTY;
  if (min === 1 && max === 1) return x;
  // (X{a,b}){c,d} → X{ac,bd} when every count in between is possible
  if (x.t === "rep") {
    const { min: a, max: b } = x;
    const contiguous = min === max || (b === Infinity ? min >= 1 || a <= 1 : a <= min * (b - a) + 1);
    if (contiguous) return rep(x.node, a * min, b * max);
  }
  if (max === Infinity && min <= 1) {
    // under a star, each alternative X{a,b} with a ≤ 1 can be just X: (A*|B)* → (A|B)*
    if (x.t === "alt") {
      const stripped = alt(x.items.map((n) => (n.t === "rep" && n.min <= 1 ? n.node : n)));
      if (stripped.key !== x.key) return rep(stripped, nullable(x) ? 0 : min, Infinity);
    }
    // a sequence of parts that can each be empty is any mix of them: (A*B*)* → (A|B)*
    if (x.t === "cat" && x.items.every(nullable)) return rep(alt(x.items), 0, Infinity);
  }
  if (nullable(x) && min > 0) return rep(x, 0, max);
  return node({ t: "rep", node: x, min, max }, `${x.key}{${min},${max}}`, x.size + 1);
}

// --- state elimination ---

// returns the expression for the NFA, or null if an intermediate one gets too long
function eliminate(nfa, maxSize) {
  const n = nfa.size;
  const START = n;
  const END = n + 1;
  const out = Array.from({ length: n + 2 }, () => new Map());
  const into = Array.from({ length: n + 2 }, () => new Map());
  const add = (i, j, r) => {
    const existing = out[i].get(j);
    const combined = existing ? alt([existing, r]) : r;
    out[i].set(j, combined);
    into[j].set(i, combined);
    return combined;
  };
  add(START, nfa.start, EPS);
  for (const s of nfa.accepting) add(s, END, EPS);
  nfa.edges.forEach((es, s) => {
    for (const { label, to } of es) add(s, to, label === null ? EPS : set(label));
  });

  const remaining = new Set(Array.from({ length: n }, (_, i) => i));
  while (remaining.size) {
    let best = -1;
    let bestWeight = Infinity;
    for (const k of remaining) {
      const w = weight(k, out, into);
      if (w < bestWeight) {
        best = k;
        bestWeight = w;
      }
    }
    const k = best;
    const loop = out[k].get(k);
    const middle = loop ? rep(loop, 0, Infinity) : EPS;
    const ins = [...into[k]].filter(([i]) => i !== k);
    const outs = [...out[k]].filter(([j]) => j !== k);
    for (const [i] of ins) out[i].delete(k);
    for (const [j] of outs) into[j].delete(k);
    for (const [i, a] of ins) {
      for (const [j, b] of outs) {
        if (add(i, j, cat([a, middle, b])).size > maxSize) return null;
      }
    }
    remaining.delete(k);
  }
  return out[START].get(END) ?? EMPTY;
}

// roughly how much removing state k adds to the total size of the expressions
function weight(k, out, into) {
  let ins = 0, outs = 0, inSize = 0, outSize = 0;
  for (const [i, r] of into[k]) if (i !== k) (ins++, (inSize += r.size));
  for (const [j, r] of out[k]) if (j !== k) (outs++, (outSize += r.size));
  const loop = out[k].get(k)?.size ?? 0;
  return inSize * (outs - 1) + outSize * (ins - 1) + loop * (ins * outs - 1);
}

// --- JavaScript syntax ---

export function toJs(n) {
  if (n.t === "empty") return "^(?!)$"; // [] isn't valid in PCRE
  const body = js(n, ALT);
  return n.t === "alt" ? `^(?:${body})$` : `^${body}$`;
}

const ALT = 0, CAT = 1, REP = 2, ATOM = 3;

function js(n, level) {
  switch (n.t) {
    case "eps": return level === ATOM ? "(?:)" : "";
    case "set": return jsSet(n.cs);
    case "cat": return group(n.items.map((m) => js(m, CAT)).join(""), level > CAT);
    case "alt": return group(n.items.map((m) => js(m, ALT)).join("|"), level > ALT);
    case "rep": return group(js(n.node, ATOM) + quantifier(n.min, n.max), level > REP);
  }
}

function group(s, needed) {
  return needed ? `(?:${s})` : s;
}

function quantifier(min, max) {
  if (min === 0 && max === Infinity) return "*";
  if (min === 1 && max === Infinity) return "+";
  if (min === 0 && max === 1) return "?";
  if (max === Infinity) return `{${min},}`;
  if (min === max) return `{${min}}`;
  return `{${min},${max}}`;
}

const PRINTABLE = /^[\p{L}\p{N}\p{P}\p{S} ]$/u;

function jsChar(cp, inClass) {
  const c = String.fromCodePoint(cp);
  if (cp === 0x0a) return "\\n";
  if (cp === 0x0d) return "\\r";
  if (cp === 0x09) return "\\t";
  if (!PRINTABLE.test(c)) {
    // \xHH works in both PCRE and JavaScript, but there's no shared form for larger ones
    return cp <= 0xff ? `\\x${cp.toString(16).padStart(2, "0")}` : `\\u{${cp.toString(16)}}`;
  }
  // JavaScript's u flag only allows escaping syntax characters (and - inside classes)
  if ((inClass ? "\\]^-[" : "^$\\.*+?()[]{}|/").includes(c)) return "\\" + c;
  return c;
}

function jsSet(cs) {
  if (cs.isAll()) return "[\\s\\S]";
  if (cs.size() === 1) return jsChar(cs.ranges[0][0], false);
  const complement = cs.complement();
  if (complement.size() === 1) return `[^${jsChar(complement.ranges[0][0], true)}]`;
  const [negated, ranges] = complement.ranges.length < cs.ranges.length ? [true, complement.ranges] : [false, cs.ranges];
  const body = ranges
    .map(([lo, hi]) => (lo === hi ? jsChar(lo, true) : hi === lo + 1 ? jsChar(lo, true) + jsChar(hi, true) : `${jsChar(lo, true)}-${jsChar(hi, true)}`))
    .join("");
  return `[${negated ? "^" : ""}${body}]`;
}
