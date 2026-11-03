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
//   atoms          a \* . [a-z] [^a-z] (A) (?i:A)
//
// Every node has a `span` of [start, end) UTF-16 offsets into the pattern, for error
// reporting and highlighting. Parentheses aren't kept as nodes; `format` adds back the ones
// that are needed.
//
// Node types:
//   { type: "empty" }                                matches the empty string
//   { type: "char", cp }                             a single code point
//   { type: "any" }                                  any single character (.)
//   { type: "class", negated, ranges: [[lo, hi]] }   ranges as written, inclusive
//   { type: "repeat", node, min, max }               max is null if unbounded
//   { type: "concat", items }                        2+ items
//   { type: "alt", items }                           2+ items
//   { type: "and", items }                           2+ items
//   { type: "not", node }
//   { type: "spatial", op, left, right }             op is one of SPATIAL_OPS
//   { type: "modifier", flag, count, node }          (?flag count:node); count is null if
//                                                    omitted (see MODIFIERS)

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
};
// PCRE's inline flags, which mean something different here (or nothing), so they're an
// error rather than a surprise
const PCRE_FLAGS = new Set("msxnUJ-^");
const MAX_MODIFIER_COUNT = 1000;

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
      // parseAlt only stops early at a ")" or a character it couldn't use
      if (this.peek() === ")") throw this.error("Unmatched )");
      throw this.error(`Unexpected ${this.peek()}`);
    }
    return node;
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
      case "|": case ")": case "&": case "!":
        return null;
      case "*": case "+": case "?": case "{":
        return null; // parsePostfix reports these
      case "(": return this.parseGroup();
      case "[": return this.parseClass();
      case ".":
        this.next();
        return { type: "any", span: [start, this.pos] };
      case "\\":
        return { type: "char", cp: this.parseEscape(), span: [start, this.pos] };
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
    const node = this.parseAlt();
    if (!this.eat(")")) {
      if (this.pos < this.src.length) throw this.error(`Unexpected ${this.peek()}`);
      throw this.error("Missing ) to close (", start);
    }
    return modifier ? { type: "modifier", ...modifier, node, span: [start, this.pos] } : node;
  }

  // the "?flag count:" after the "(" at groupStart, returning { flag, count }
  parseModifier(groupStart) {
    this.next();
    const flag = this.peek();
    const here = () => [groupStart, this.pos];
    if (flag === undefined) throw this.error("Missing modifier after (?", ...here());
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
      this.eat("-");
      while (/[0-9]/.test(this.peek() ?? "")) this.next();
      const text = this.src.slice(countStart, this.pos);
      if (MODIFIERS[flag].count === "none") {
        throw this.error(`(?${flag}:...) doesn't take a number`, countStart, this.pos);
      }
      if (!/^-?[0-9]+$/.test(text)) throw this.error(`Expected a number after (?${flag}`, countStart, this.pos);
      count = Number(text);
      if (Math.abs(count) > MAX_MODIFIER_COUNT) {
        throw this.error(`Modifier count can be at most ${MAX_MODIFIER_COUNT}`, countStart, this.pos);
      }
      if (flag === "R" && count === 0) throw this.error("Rotation count can't be 0", countStart, this.pos);
    }
    if (!this.eat(":")) {
      const example = MODIFIERS[flag].count === "none" ? `(?${flag}:abc)` : `(?${flag}2:abc)`;
      throw this.error(`Expected : after (?${flag}${count ?? ""}, as in ${example}`, ...here());
    }
    return { flag, count };
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
    throw this.error(`Unknown escape \\${c}`, start, this.pos);
  }

  // [abc], [a-z], [^a-z]; [] matches nothing and [^] matches anything
  parseClass() {
    const start = this.pos;
    this.next();
    const negated = this.eat("^");
    const ranges = [];
    for (;;) {
      const c = this.peek();
      if (c === undefined) throw this.error("Missing ] to close [", start);
      if (c === "]") break;
      const loStart = this.pos;
      const lo = this.parseClassChar();
      // a - between two characters makes a range; at the start or end it's literal
      if (this.peek() === "-" && this.peek(1) !== "]" && this.peek(1) !== undefined) {
        this.next();
        const hi = this.parseClassChar();
        if (hi < lo) throw this.error("Range is out of order", loStart, this.pos);
        ranges.push([lo, hi]);
      } else {
        ranges.push([lo, lo]);
      }
    }
    this.next();
    return { type: "class", negated, ranges, span: [start, this.pos] };
  }

  parseClassChar() {
    const c = this.peek();
    if (c === "\\") return this.parseEscape();
    if (c === "[") throw this.error("[ is reserved inside a class: write \\[ to match it literally");
    this.next();
    return c.codePointAt(0);
  }
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
    case "class": s = formatClass(node); break;
    case "repeat": s = fmt(node.node, ATOM) + formatQuantifier(node.min, node.max); break;
    case "concat": s = node.items.map((n) => fmt(n, LEVEL.repeat)).join(""); break;
    case "alt": s = node.items.map((n) => (n.type === "empty" ? "" : fmt(n, LEVEL.and))).join("|"); break;
    case "and": s = node.items.map((n) => fmt(n, LEVEL.not)).join("&"); break;
    case "not": s = "!" + fmt(node.node, LEVEL.not); break;
    case "modifier":
      s = `(?${node.flag}${node.count ?? ""}:${fmt(node.node, 0)})`;
      break;
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

export function formatClass({ negated, ranges }) {
  const parts = ranges.map(([lo, hi]) =>
    lo === hi ? formatChar(lo, true) : `${formatChar(lo, true)}-${formatChar(hi, true)}`,
  );
  return `[${negated ? "^" : ""}${parts.join("")}]`;
}
