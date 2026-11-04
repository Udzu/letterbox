// Pattern parser: turns a pattern string into an AST.
//
// Precedence, loosest first:
//   alternation    A|B
//   conjunction    A&B
//   negation       !A
//   spatial        A<B A^B A##B A-B A->B ... (see SPATIAL_OPS); one operator can be chained,
//                  grouping to the left, but mixing different ones needs parentheses
//   concatenation  AB
//   postfix        A* A+ A? A{m} A{m,} A{m,n}
//   atoms          a \* . @ \d \p{L} [a-z] [^a-z] (A) (?i:A) (?[1:-1]:A) (?z:A/B/C) (?<v>A) (?&v)
//
// Every node has a `span` of [start, end) UTF-16 offsets into the pattern, for error
// reporting and highlighting. Parentheses aren't kept as nodes; `format` adds back the ones
// that are needed.
//
// Node types:
//   { type: "empty" }                                matches the empty string
//   { type: "char", cp }                             a single code point
//   { type: "any" }                                  any single character (.)
//   { type: "words" }                                any word in the word list (@)
//   { type: "class", negated, ranges: [[lo, hi]] }   ranges as written, inclusive, plus
//                                                    shorthands: [...] if it has any
//   { type: "shorthand", name, negated }             \d \w \s, or their complements \D \W \S
//                                                    if negated (see shorthands.js), or with
//                                                    name "p" and a property, \p{property}
//   { type: "repeat", node, min, max }               max is null if unbounded
//   { type: "concat", items }                        2+ items
//   { type: "alt", items }                           2+ items
//   { type: "and", items }                           2+ items
//   { type: "not", node }
//   { type: "spatial", op, left, right }             op is one of SPATIAL_OPS
//   { type: "modifier", flag, count, node }          (?flag count:node); count is null if
//                                                    omitted (see MODIFIERS)
//   { type: "slice", start, stop, step, node }       (?[start:stop:step]:node); each is null
//                                                    if omitted (see sliceError)
//   { type: "replace", strict, node, find, insert }  (?z:node/find/insert), or (?Z:...) if
//                                                    strict
//   { type: "split", unweave, split, left, right }   (?w:split/left/right), or (?u:...) if
//                                                    unweave; split only uses L and R
//   { type: "define", name, node }                   (?<name>node): matches node, and names it
//   { type: "ref", name }                            (?&name): matches the named pattern again
//
// Names can be used before they're defined, but can't refer to themselves (directly or not),
// since that could describe languages that aren't regular, and must be unique. A custom
// split's names are separate: its split can only use names defined in the split, and the
// rest of the pattern can't use those.

import { formatShorthand, isProperty } from "./shorthands.js";

export class PatternError extends Error {
  constructor(message, start, end = start + 1) {
    super(message);
    this.name = "PatternError";
    this.span = [start, end];
  }
}

// All ASCII punctuation is reserved for syntax, except the apostrophe, which is common in
// words. Reserved characters that don't (yet) mean anything are an error, not a literal,
// so new syntax can't change the meaning of an existing pattern. Escape them with \.
export const RESERVED = new Set("!\"#$%&()*+,-./:;<=>?@[\\]^_`{|}~");

// Separating operators (A<B: A inside B, etc) and the matching subtraction operators
// (A-<B: A with B removed from outside, etc). See compile.js for their meanings.
export const SPATIAL_OPS = [
  "<", ">", "<<", ">>", "^", "<^", ">^", "#", "##",
  "-", "_-", "-<", "->", "-<<", "->>", "-^", "-<^", "->^", "-#", "-##", "_-##",
];
// longest first, so that matching the first one that fits gives the longest match; none of
// these characters can start an operand, so the longest match is always the right one
const SPATIAL_BY_LENGTH = [...SPATIAL_OPS].sort((x, y) => y.length - x.length);

// Group modifiers, (?i:A) etc, and whether they take a count. See compile.js for their
// meanings.
export const MODIFIERS = {
  i: { count: "none" }, //     case-insensitive
  r: { count: "none" }, //     reversed
  c: { count: "optional" }, // cipher shift: (?c3:A) by 3 letters, (?c:A) by any of 1-25
  R: { count: "optional" }, // rotation: (?R2:A) right by 2, (?R-2:A) left, (?R:A) any
  z: { count: "none", parts: 3 }, // replacement: (?z:A/B/C) is A with a B replaced by a C
  Z: { count: "none", parts: 3 }, // the same, but not at either end
  w: { count: "none", parts: 3 }, // custom weave: (?w:S/A/B) is A and B combined by split S
  u: { count: "none", parts: 3 }, // custom unweave: (?u:S/A/B) is A with B removed by S
};
const PARTS_EXAMPLE = { z: "London/o/u", Z: "London/o/u", w: "L+R+L+/the/[a-z]+", u: "(LLR)*/abcdef/.*" };
const SPLIT_CHARS = new Set(["L", "R"].map((c) => c.codePointAt(0)));
// PCRE's inline flags, which mean something different here (or nothing), so they're an
// error rather than a surprise
const PCRE_FLAGS = new Set("msxnUJ-^");
const MAX_MODIFIER_COUNT = 1000;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// escapes for sets of characters, and the uppercase ones for their complements
const SHORTHANDS = new Set("dDwWsSpP");

// Slices are strict, unlike Python's: a string too short for the slice gives nothing, so
// (?[:3]:A) is the first 3 characters of strings in A with at least 3. Returns why a slice
// isn't allowed, or null if it's fine.
export function sliceError(start, stop, step) {
  if (step === 0) return "Slice step can't be 0";
  if (step !== null && step < 0) return "Slice step can't be negative: use (?r:...) to reverse";
  if (start !== null && start < 0 && stop !== null && stop >= 0) {
    return "A slice can't have a negative start and a non-negative stop";
  }
  if (start !== null && stop !== null && (start < 0) === (stop < 0) && start > stop) {
    return "Slice start is after its stop";
  }
  return null;
}

const NAMED_ESCAPES = { n: 0x0a, r: 0x0d, t: 0x09 };
const MAX_REPEAT = 1000;
const HEX = /^[0-9a-fA-F]{1,6}$/;

export function parse(pattern) {
  return new Parser(pattern).parsePattern();
}

class Parser {
  constructor(pattern) {
    this.src = pattern;
    this.pos = 0;
  }

  // the code point at the current position as a string, or undefined at the end
  peek(offset = 0) {
    let pos = this.pos;
    for (let i = 0; i < offset && pos < this.src.length; i++) pos += this.width(pos);
    if (pos >= this.src.length) return undefined;
    return String.fromCodePoint(this.src.codePointAt(pos));
  }

  width(pos) {
    return this.src.codePointAt(pos) > 0xffff ? 2 : 1;
  }

  next() {
    const c = this.peek();
    if (c !== undefined) this.pos += c.length;
    return c;
  }

  eat(c) {
    if (this.peek() !== c) return false;
    this.pos += c.length;
    return true;
  }

  error(message, start = this.pos, end) {
    // by default, highlight the character at start
    const here = this.src.codePointAt(start);
    return new PatternError(message, start, end ?? start + (here === undefined ? 0 : here > 0xffff ? 2 : 1));
  }

  parsePattern() {
    const node = this.parseAlt();
    if (this.pos < this.src.length) {
      // parseAlt only stops early at a ")", a "/" or a character it couldn't use
      if (this.peek() === ")") throw this.error("Unmatched )");
      if (this.peek() === "/") throw this.slashError();
      throw this.error(`Unexpected ${this.peek()}`);
    }
    checkNames(node);
    return node;
  }

  slashError() {
    return this.error("/ is reserved: write \\/ to match it literally (it separates the parts of groups like (?z:A/B/C))");
  }

  // alternation branches may be empty, as in "a|" or "()"
  parseAlt() {
    const start = this.pos;
    const items = [this.parseAnd() ?? this.emptyAt(this.pos)];
    while (this.peek() === "|") {
      this.next();
      items.push(this.parseAnd() ?? this.emptyAt(this.pos));
    }
    return combine("alt", items, start, this.pos);
  }

  emptyAt(pos) {
    return { type: "empty", span: [pos, pos] };
  }

  // returns null if there's nothing to parse, so callers can decide whether that's allowed
  parseAnd() {
    const start = this.pos;
    const first = this.parseNot();
    if (this.peek() !== "&") return first;
    if (first === null) throw this.error("Missing operand before &");
    const items = [first];
    while (this.peek() === "&") {
      const opPos = this.pos;
      this.next();
      const item = this.parseNot();
      if (item === null) throw this.error("Missing operand after &", opPos);
      items.push(item);
    }
    return combine("and", items, start, this.pos);
  }

  parseNot() {
    if (this.peek() !== "!") return this.parseSpatial();
    const start = this.pos;
    this.next();
    const node = this.parseNot();
    if (node === null) throw this.error("Missing operand after !", start);
    return { type: "not", node, span: [start, this.pos] };
  }

  peekSpatial() {
    return SPATIAL_BY_LENGTH.find((op) => this.src.startsWith(op, this.pos)) ?? null;
  }

  parseSpatial() {
    const start = this.pos;
    let left = this.parseConcat();
    const first = this.peekSpatial();
    if (first === null) return left;
    if (left === null) throw this.error(`Missing operand before ${first}`, this.pos, this.pos + first.length);
    for (let op = first; op !== null; op = this.peekSpatial()) {
      const opPos = this.pos;
      if (op !== first) {
        throw this.error(`Parenthesise to mix ${first} and ${op}, as in (a${first}b)${op}c`, opPos, opPos + op.length);
      }
      this.pos += op.length;
      const right = this.parseConcat();
      if (right === null) {
        if (this.peek() === "!") throw this.error(`Parenthesise ! after ${op}, as in a${op}(!b)`);
        throw this.error(`Missing operand after ${op}`, opPos, opPos + op.length);
      }
      left = { type: "spatial", op, left, right, span: [start, this.pos] };
    }
    return left;
  }

  parseConcat() {
    const start = this.pos;
    const items = [];
    for (;;) {
      const item = this.parsePostfix();
      if (item === null) break;
      items.push(item);
    }
    if (items.length === 0) return null;
    // negation binds more loosely than concatenation, so a!b would be ambiguous
    if (this.peek() === "!") throw this.error("Parenthesise ! inside a sequence, as in a(!b)");
    return combine("concat", items, start, this.pos);
  }

  parsePostfix() {
    const start = this.pos;
    const atom = this.parseAtom();
    if (atom === null) {
      if (this.isQuantifierStart()) throw this.error("Nothing to repeat");
      return null;
    }
    if (!this.isQuantifierStart()) return atom;
    const [min, max] = this.parseQuantifier();
    if (this.isQuantifierStart()) {
      throw this.error("Parenthesise a repetition before repeating it again, as in (a*)?");
    }
    return { type: "repeat", node: atom, min, max, span: [start, this.pos] };
  }

  isQuantifierStart() {
    const c = this.peek();
    return c === "*" || c === "+" || c === "?" || c === "{";
  }

  parseQuantifier() {
    const start = this.pos;
    const c = this.next();
    if (c === "*") return [0, null];
    if (c === "+") return [1, null];
    if (c === "?") return [0, 1];
    // {m}, {m,} or {m,n}
    const min = this.parseCount(start);
    let max = min;
    if (this.eat(",")) max = this.peek() === "}" ? null : this.parseCount(start);
    if (!this.eat("}")) throw this.error("Expected } to close repetition", start, this.pos);
    if (max !== null && max < min) {
      throw this.error(`Repetition minimum ${min} is larger than maximum ${max}`, start, this.pos);
    }
    return [min, max];
  }

  parseCount(braceStart) {
    const start = this.pos;
    while (/[0-9]/.test(this.peek() ?? "")) this.next();
    if (start === this.pos) {
      throw this.error("Expected a number in repetition, as in {2}, {2,} or {2,5}", braceStart, this.pos + 1);
    }
    const n = Number(this.src.slice(start, this.pos));
    if (n > MAX_REPEAT) throw this.error(`Repetition count can be at most ${MAX_REPEAT}`, start, this.pos);
    return n;
  }

  // returns null at the end, or at a character that ends or separates sequences
  parseAtom() {
    const start = this.pos;
    const c = this.peek();
    if (c === undefined || this.peekSpatial() !== null) return null;
    switch (c) {
      case "|": case ")": case "&": case "!": case "/":
        return null;
      case "*": case "+": case "?": case "{":
        return null; // parsePostfix reports these
      case "(": return this.parseGroup();
      case "[": return this.parseClass();
      case ".":
        this.next();
        return { type: "any", span: [start, this.pos] };
      case "@":
        this.next();
        return { type: "words", span: [start, this.pos] };
      case "\\": {
        if (SHORTHANDS.has(this.peek(1) ?? "")) return { type: "shorthand", ...this.parseShorthand(), span: [start, this.pos] };
        return { type: "char", cp: this.parseEscape(), span: [start, this.pos] };
      }
      default:
        if (RESERVED.has(c)) throw this.error(`${c} is reserved: write \\${c} to match it literally`);
        this.next();
        return { type: "char", cp: c.codePointAt(0), span: [start, this.pos] };
    }
  }

  parseGroup() {
    const start = this.pos;
    this.next();
    const modifier = this.peek() === "?" ? this.parseModifier(start) : null;
    if (modifier?.type === "parts") return this.parseParts(start, modifier.flag);
    if (modifier?.type === "ref") return { ...modifier, span: [start, this.pos] };
    const node = this.parseAlt();
    this.closeGroup(start);
    return modifier ? { ...modifier, node, span: [start, this.pos] } : node;
  }

  closeGroup(start) {
    if (this.eat(")")) return;
    if (this.peek() === "/") throw this.slashError();
    if (this.pos < this.src.length) throw this.error(`Unexpected ${this.peek()}`);
    throw this.error("Missing ) to close (", start);
  }

  // the "A/B/C)" of a replacement or custom split, whose parts are separated by / at the top
  // level
  parseParts(start, flag) {
    const parts = [this.parseAlt()];
    while (this.peek() === "/") {
      if (parts.length === 3) {
        throw this.error(`(?${flag}:...) has three parts: write \\/ to match / literally`);
      }
      this.next();
      parts.push(this.parseAlt());
    }
    if (parts.length < 3 && this.peek() === ")") {
      throw this.error(`(?${flag}:...) needs three parts, as in (?${flag}:${PARTS_EXAMPLE[flag]})`, start, this.pos + 1);
    }
    this.closeGroup(start);
    const span = [start, this.pos];
    if (flag === "z" || flag === "Z") {
      const [node, find, insert] = parts;
      return { type: "replace", strict: flag === "Z", node, find, insert, span };
    }
    const [split, left, right] = parts;
    this.checkSplit(split);
    return { type: "split", unweave: flag === "u", split, left, right, span };
  }

  // split patterns are over L (the left operand's characters) and R (the right one's)
  checkSplit(node) {
    const bad = (n) => {
      throw new PatternError("Split patterns can only use the characters L and R", ...n.span);
    };
    const visit = (n) => {
      if ((n.type === "char" && !SPLIT_CHARS.has(n.cp)) || n.type === "words" || n.type === "shorthand") bad(n);
      if (n.type === "class" && (n.shorthands || !n.ranges.every(([lo, hi]) => lo === hi && SPLIT_CHARS.has(lo)))) bad(n);
      for (const child of [n.node, n.left, n.right, n.find, n.insert, n.split, ...(n.items ?? [])]) if (child) visit(child);
    };
    visit(node);
  }

  // the "?flag count:" or "?[slice]:" after the "(" at groupStart, returning the node's
  // fields other than its contents
  parseModifier(groupStart) {
    this.next();
    const flag = this.peek();
    const here = () => [groupStart, this.pos];
    if (flag === undefined) throw this.error("Missing modifier after (?", ...here());
    if (flag === "[") return this.parseSlice(groupStart);
    if (flag === "<" || flag === "&") return this.parseName(groupStart, flag);
    if (PCRE_FLAGS.has(flag)) {
      const hint = flag === "s" ? ": for a cipher shift, write (?c:...)" : "";
      throw this.error(`(?${flag} is a PCRE flag, which isn't supported${hint}`, groupStart, this.pos + 1);
    }
    if (!(flag in MODIFIERS)) {
      if (flag === ":") throw this.error("Write (...) for grouping, not (?:...)", groupStart, this.pos + 1);
      throw this.error(`Unknown modifier (?${flag}`, groupStart, this.pos + this.width(this.pos));
    }
    this.next();
    let count = null;
    if (/[-0-9]/.test(this.peek() ?? "")) {
      const countStart = this.pos;
      if (MODIFIERS[flag].count === "none") {
        this.parseSignedNumber(`after (?${flag}`);
        throw this.error(`(?${flag}:...) doesn't take a number`, countStart, this.pos);
      }
      count = this.parseSignedNumber(`after (?${flag}`);
      if (flag === "R" && count === 0) throw this.error("Rotation count can't be 0", countStart, this.pos);
    }
    if (!this.eat(":")) {
      const example = MODIFIERS[flag].count === "none" ? `(?${flag}:abc)` : `(?${flag}2:abc)`;
      throw this.error(`Expected : after (?${flag}${count ?? ""}, as in ${example}`, ...here());
    }
    if (MODIFIERS[flag].parts) return { type: "parts", flag };
    return { type: "modifier", flag, count };
  }

  // the "<name>" of (?<name>...), or the "&name)" of (?&name), after the "(?"
  parseName(groupStart, flag) {
    this.next();
    if (flag === "<" && (this.peek() === "=" || this.peek() === "!")) {
      throw this.error("Lookbehind isn't supported", groupStart, this.pos + 1);
    }
    const nameStart = this.pos;
    const end = flag === "<" ? ">" : ")";
    while (this.peek() !== undefined && this.peek() !== end) this.next();
    const name = this.src.slice(nameStart, this.pos);
    if (!this.eat(end)) {
      throw this.error(`Missing ${end} after (?${flag}${name}, as in ${flag === "<" ? "(?<v>[aeiou])" : "(?&v)"}`, groupStart, this.pos);
    }
    if (!NAME.test(name)) {
      throw this.error("Names use ASCII letters, digits and _, and can't start with a digit", nameStart, this.pos - 1);
    }
    return flag === "<" ? { type: "define", name } : { type: "ref", name };
  }

  // an optionally negative number, as in a modifier count or slice index
  parseSignedNumber(where) {
    const start = this.pos;
    this.eat("-");
    while (/[0-9]/.test(this.peek() ?? "")) this.next();
    const text = this.src.slice(start, this.pos);
    if (!/^-?[0-9]+$/.test(text)) throw this.error(`Expected a number ${where}`, start, this.pos);
    const n = Number(text);
    if (Math.abs(n) > MAX_MODIFIER_COUNT) throw this.error(`Number can be at most ${MAX_MODIFIER_COUNT}`, start, this.pos);
    return n;
  }

  // "[start:stop:step]:" after the "(?", where every part is optional, as is the second ":"
  parseSlice(groupStart) {
    this.next();
    const part = () => (/[-0-9]/.test(this.peek() ?? "") ? this.parseSignedNumber("in slice") : null);
    const start = part();
    if (!this.eat(":")) throw this.error("Expected : in slice, as in (?[1:-1]:abc)", groupStart, this.pos);
    const stop = part();
    const step = this.eat(":") ? part() : null;
    if (!this.eat("]")) throw this.error("Expected ] to close slice", groupStart, this.pos);
    const problem = sliceError(start, stop, step);
    if (problem) throw this.error(problem, groupStart, this.pos);
    if (!this.eat(":")) throw this.error("Expected : after slice, as in (?[1:-1]:abc)", groupStart, this.pos);
    return { type: "slice", start, stop, step };
  }

  // returns the escaped code point
  parseEscape() {
    const start = this.pos;
    this.next();
    const c = this.next();
    if (c === undefined) throw this.error("Pattern can't end with \\", start);
    if (RESERVED.has(c) || c === "'") return c.codePointAt(0);
    if (c in NAMED_ESCAPES) return NAMED_ESCAPES[c];
    if (c === "u") {
      if (!this.eat("{")) throw this.error("Expected { after \\u, as in \\u{e9}", start, this.pos);
      const hexStart = this.pos;
      while (this.peek() !== undefined && this.peek() !== "}") this.next();
      const hex = this.src.slice(hexStart, this.pos);
      if (!this.eat("}")) throw this.error("Missing } to close \\u{", start, this.pos);
      const cp = HEX.test(hex) ? parseInt(hex, 16) : NaN;
      if (!(cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) {
        throw this.error(`Invalid code point \\u{${hex}}`, start, this.pos);
      }
      return cp;
    }
    if (c === "k" || /[1-9]/.test(c)) {
      throw this.error(`Backreferences (\\${c}) aren't supported, since they match the same text again: (?&name) matches the same pattern`, start, this.pos);
    }
    if (c === "b" || c === "B") {
      throw this.error(`Word boundaries (\\${c}) aren't supported, since patterns match whole strings`, start, this.pos);
    }
    throw this.error(`Unknown escape \\${c}`, start, this.pos);
  }

  // \d \D \w \W \s \S, returning { name, negated }, or \p{...} \P{...}, also with a property
  parseShorthand() {
    const start = this.pos;
    this.next();
    const c = this.next();
    const name = c.toLowerCase();
    const negated = c !== name;
    if (name !== "p") return { name, negated };
    if (!this.eat("{")) throw this.error(`Expected { after \\${c}, as in \\${c}{L}`, start, this.pos);
    const nameStart = this.pos;
    while (this.peek() !== undefined && this.peek() !== "}") this.next();
    const property = this.src.slice(nameStart, this.pos);
    if (!this.eat("}")) throw this.error(`Missing } to close \\${c}{`, start, this.pos);
    if (!isProperty(property)) throw this.error(`Unknown Unicode property \\${c}{${property}}`, start, this.pos);
    return { name, negated, property };
  }

  isShorthandStart() {
    return this.peek() === "\\" && SHORTHANDS.has(this.peek(1) ?? "");
  }

  // [abc], [a-z], [^a-z]; [] matches nothing and [^] matches anything
  parseClass() {
    const start = this.pos;
    this.next();
    const negated = this.eat("^");
    const ranges = [];
    const shorthands = [];
    const rangeError = (from) => this.error("A shorthand like \\d can't be one end of a range: write \\- for a literal -", from, this.pos);
    for (;;) {
      const c = this.peek();
      if (c === undefined) throw this.error("Missing ] to close [", start);
      if (c === "]") break;
      const loStart = this.pos;
      if (this.isShorthandStart()) {
        shorthands.push(this.parseShorthand());
        if (this.peek() === "-" && this.peek(1) !== "]" && this.peek(1) !== undefined) throw rangeError(loStart);
        continue;
      }
      const lo = this.parseClassChar();
      // a - between two characters makes a range; at the start or end it's literal
      if (this.peek() === "-" && this.peek(1) !== "]" && this.peek(1) !== undefined) {
        this.next();
        if (this.isShorthandStart()) {
          this.parseShorthand();
          throw rangeError(loStart);
        }
        const hi = this.parseClassChar();
        if (hi < lo) throw this.error("Range is out of order", loStart, this.pos);
        ranges.push([lo, hi]);
      } else {
        ranges.push([lo, lo]);
      }
    }
    this.next();
    return { type: "class", negated, ranges, ...(shorthands.length ? { shorthands } : {}), span: [start, this.pos] };
  }

  parseClassChar() {
    const c = this.peek();
    if (c === "\\") return this.parseEscape();
    if (c === "[") throw this.error("[ is reserved inside a class: write \\[ to match it literally");
    this.next();
    return c.codePointAt(0);
  }
}

// Check that every name is defined once and used only where it's visible, and that no name
// refers to itself. A custom split's split part has its own names (see the top of the file).
function checkNames(root) {
  const definitions = new Map(); // name → define node, across all scopes
  const scopes = []; // { defines, refs }
  const collect = (node, scope) => {
    if (node.type === "define") {
      if (definitions.has(node.name)) throw new PatternError(`${node.name} is defined more than once`, ...node.span);
      definitions.set(node.name, node);
      scope.defines.add(node.name);
    }
    if (node.type === "ref") scope.refs.push(node);
    if (node.type === "split") {
      const inner = { defines: new Set(), refs: [] };
      scopes.push(inner);
      collect(node.split, inner);
    }
    for (const child of [node.node, node.left, node.right, node.find, node.insert, ...(node.items ?? [])]) {
      if (child) collect(child, scope);
    }
  };
  const top = { defines: new Set(), refs: [] };
  scopes.push(top);
  collect(root, top);
  for (const { defines, refs } of scopes) {
    for (const ref of refs) {
      if (!defines.has(ref.name)) {
        const where = definitions.has(ref.name) ? ` here: names in a custom split's split and the rest of the pattern are separate` : "";
        throw new PatternError(`${ref.name} isn't defined${where}`, ...ref.span);
      }
    }
  }
  // the names each definition uses, to look for cycles
  const uses = new Map();
  const usesIn = (node, out) => {
    if (node.type === "ref") out.add(node.name);
    for (const child of [node.node, node.left, node.right, node.find, node.insert, node.split, ...(node.items ?? [])]) {
      if (child) usesIn(child, out);
    }
    return out;
  };
  for (const [name, node] of definitions) uses.set(name, usesIn(node.node, new Set()));
  const done = new Set();
  const visit = (name, path) => {
    if (path.includes(name)) {
      // as in "a refers to b, which refers to a"
      const cycle = path.slice(path.indexOf(name));
      const message = cycle.length === 1
        ? `${name} refers to itself`
        : `${name} refers to ${[...cycle.slice(1), name].join(", which refers to ")}`;
      throw new PatternError(message, ...definitions.get(name).span);
    }
    if (done.has(name)) return;
    for (const used of uses.get(name)) visit(used, [...path, name]);
    done.add(name);
  };
  for (const name of definitions.keys()) visit(name, []);
}

// these operators are associative, so (ab)c and a(bc) both become abc
function combine(type, items, start, end) {
  if (items.length === 1) return items[0];
  return { type, items: items.flatMap((n) => (n.type === type ? n.items : [n])), span: [start, end] };
}

// Format an AST back into a pattern, adding only the parentheses that are needed.
// parse(format(ast)) gives back the same AST (ignoring spans).

const LEVEL = { alt: 0, and: 1, not: 2, spatial: 3, concat: 4, repeat: 5 };
const ATOM = 6;

export function format(node) {
  return fmt(node, 0);
}

function fmt(node, minLevel) {
  const level = LEVEL[node.type] ?? ATOM;
  let s;
  switch (node.type) {
    case "empty":
      // only an alternation branch or the whole pattern can be written as nothing
      return minLevel <= LEVEL.alt ? "" : "()";
    case "char": s = formatChar(node.cp, false); break;
    case "any": s = "."; break;
    case "words": s = "@"; break;
    case "ref": s = `(?&${node.name})`; break;
    case "define": s = `(?<${node.name}>${fmt(node.node, 0)})`; break;
    case "shorthand": s = formatShorthand(node); break;
    case "class": s = formatClass(node); break;
    case "repeat": s = fmt(node.node, ATOM) + formatQuantifier(node.min, node.max); break;
    case "concat": s = node.items.map((n) => fmt(n, LEVEL.repeat)).join(""); break;
    case "alt": s = node.items.map((n) => (n.type === "empty" ? "" : fmt(n, LEVEL.and))).join("|"); break;
    case "and": s = node.items.map((n) => fmt(n, LEVEL.not)).join("&"); break;
    case "not": s = "!" + fmt(node.node, LEVEL.not); break;
    case "modifier":
      s = `(?${node.flag}${node.count ?? ""}:${fmt(node.node, 0)})`;
      break;
    case "replace": {
      const parts = [node.node, node.find, node.insert].map((n) => fmt(n, 0));
      s = `(?${node.strict ? "Z" : "z"}:${parts.join("/")})`;
      break;
    }
    case "split": {
      const parts = [node.split, node.left, node.right].map((n) => fmt(n, 0));
      s = `(?${node.unweave ? "u" : "w"}:${parts.join("/")})`;
      break;
    }
    case "slice": {
      const step = node.step === null ? "" : `:${node.step}`;
      s = `(?[${node.start ?? ""}:${node.stop ?? ""}${step}]:${fmt(node.node, 0)})`;
      break;
    }
    case "spatial": {
      // chains of the same operator group to the left without parentheses
      const sameLeft = node.left.type === "spatial" && node.left.op === node.op;
      s = fmt(node.left, sameLeft ? LEVEL.spatial : LEVEL.concat) + node.op + fmt(node.right, LEVEL.concat);
      break;
    }
    default: throw new Error(`Unknown node type ${node.type}`);
  }
  return level < minLevel ? `(${s})` : s;
}

function formatQuantifier(min, max) {
  if (min === 0 && max === null) return "*";
  if (min === 1 && max === null) return "+";
  if (min === 0 && max === 1) return "?";
  if (max === null) return `{${min},}`;
  if (min === max) return `{${min}}`;
  return `{${min},${max}}`;
}

// characters shown as themselves when formatting; anything else (controls, format characters,
// lone combining marks, unassigned code points, etc) is written as \u{...}
const PRINTABLE = /^[\p{L}\p{N}\p{P}\p{S} ]$/u;

export function formatChar(cp, inClass = false) {
  const c = String.fromCodePoint(cp);
  if (cp === 0x0a) return "\\n";
  if (cp === 0x0d) return "\\r";
  if (cp === 0x09) return "\\t";
  if (!PRINTABLE.test(c)) return `\\u{${cp.toString(16)}}`;
  if (inClass ? "\\]^-[".includes(c) : RESERVED.has(c)) return "\\" + c;
  return c;
}

export function formatClass({ negated, ranges, shorthands = [] }) {
  const parts = ranges.map(([lo, hi]) =>
    lo === hi ? formatChar(lo, true) : `${formatChar(lo, true)}-${formatChar(hi, true)}`,
  );
  return `[${negated ? "^" : ""}${parts.join("")}${shorthands.map(formatShorthand).join("")}]`;
}
