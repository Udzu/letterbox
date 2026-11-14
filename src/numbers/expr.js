// Expressions typed by the player (and produced by the solver): parsing, exact
// evaluation against the puzzle's numbers and rules, and rendering as maths.
//
// Syntax: + - * / (also × ÷ −), ^ power, ! factorial, V or √ square root,
// bVa b-th root of a, .4 decimal, .2(4) recurring decimal (the bracketed digits
// repeat), .24~ shorthand for .(24), ( ). Several numbers written together are
// concatenated.
//
// Precedence, tightest first: !, roots, ^ (right to left), unary minus, * /, + -.

export class ExprError extends Error {}

// ---- parsing

const SYMBOLS = { "×": "*", x: "*", "÷": "/", "−": "-", "√": "V", v: "V" };

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    // digits, then optionally a point, digits and (recurring digits), then optionally ~
    const m = /^(\d*)(?:\.(\d*)(?:\((\d*)\))?)?(~?)/.exec(text.slice(i));
    const [whole, int, frac, bracket, tilde] = m;
    if (int || frac || bracket !== undefined) {
      if (tilde && frac === undefined) throw new ExprError("~ goes after a decimal, like .4~");
      if (tilde && bracket !== undefined) throw new ExprError("Use either brackets or ~ for recurring digits");
      if (bracket === "") throw new ExprError("Missing recurring digits in ( )");
      if (frac === "" && bracket === undefined) throw new ExprError("Missing digits after the decimal point");
      // frac holds every digit after the point, the last rep of which recur
      const rep = bracket !== undefined ? bracket.length : tilde ? frac.length : 0;
      tokens.push({ type: "num", int, frac: frac === undefined ? null : frac + (bracket ?? ""), rep, pos: i });
      i += whole.length;
      continue;
    }
    const s = SYMBOLS[c] ?? c;
    if (!"+-*/^!V()".includes(s)) throw new ExprError(`Unexpected ${c}`);
    tokens.push({ type: s, pos: i });
    i++;
  }
  return tokens;
}

export function parse(text) {
  const tokens = tokenize(text);
  let i = 0;
  const peek = () => tokens[i]?.type;
  const take = (type) => (peek() === type ? tokens[i++] : null);
  const fail = (what) => {
    throw new ExprError(i < tokens.length ? `Unexpected ${tokens[i].type === "num" ? "number" : tokens[i].type}` : `Missing ${what}`);
  };

  const sum = () => {
    let a = prod();
    for (let op; (op = take("+") ?? take("-"));) a = { type: op.type, a, b: prod() };
    return a;
  };
  const prod = () => {
    let a = neg();
    for (let op; (op = take("*") ?? take("/"));) a = { type: op.type, a, b: neg() };
    return a;
  };
  const neg = () => (take("-") ? { type: "neg", a: neg() } : pow());
  const pow = () => {
    const a = root();
    return take("^") ? { type: "^", a, b: neg() } : a;
  };
  const root = () => {
    if (take("V")) return { type: "sqrt", a: root() };
    const b = post();
    return take("V") ? { type: "root", b, a: root() } : b;
  };
  const post = () => {
    let a = primary();
    while (take("!")) a = { type: "!", a };
    return a;
  };
  const primary = () => {
    const t = take("num");
    if (t) return { type: "num", int: t.int, frac: t.frac, rep: t.rep };
    if (take("(")) {
      const a = sum();
      if (!take(")")) fail(")");
      return a;
    }
    return fail("number");
  };

  if (!tokens.length) throw new ExprError("Empty");
  const tree = sum();
  if (i < tokens.length) fail("");
  return tree;
}

// ---- exact rational arithmetic on [numerator, denominator] BigInt pairs
//
// BigInts so that intermediate values can be huge, as in √√√(7^24) = 7^3.

const MAX_BITS = 4096;
const TOO_BIG = "Too large to calculate exactly";
const bits = (n) => (n < 0n ? -n : n).toString(2).length;

function gcd(a, b) {
  if (a < 0n) a = -a;
  while (b) [a, b] = [b, a % b];
  return a;
}

function rat(n, d) {
  if (d === 0n) throw new ExprError("Division by zero");
  if (d < 0n) { n = -n; d = -d; }
  if (bits(n) > MAX_BITS || bits(d) > MAX_BITS) throw new ExprError(TOO_BIG);
  const g = gcd(n, d) || 1n;
  return [n / g, d / g];
}

// Exact integer k-th root of a non-negative BigInt, or -1n.
function bigRoot(n, k) {
  if (n < 2n || k === 1n) return n;
  // Newton's method from an overestimate
  let x = 1n << (BigInt(bits(n)) / k + 1n);
  for (;;) {
    const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
    if (y >= x) break;
    x = y;
  }
  return x ** k === n ? x : -1n;
}

function power([n, d], [p, q], what) {
  if (n === 0n) {
    if (p <= 0n) throw new ExprError(p === 0n ? "0 to the power 0" : "Division by zero");
    return [0n, 1n];
  }
  let sign = 1n;
  if (n < 0n) {
    if (q % 2n === 0n) throw new ExprError(`${what} of a negative number`);
    n = -n;
    if (p % 2n !== 0n) sign = -1n;
  }
  if (q > 4096n) throw new ExprError(`${what} is irrational`);
  const rn = bigRoot(n, q), rd = bigRoot(d, q);
  if (rn < 0n || rd < 0n) throw new ExprError(`${what} is irrational`);
  const e = p < 0n ? -p : p;
  if (e * BigInt(Math.max(bits(rn), bits(rd)) - 1) > BigInt(MAX_BITS)) throw new ExprError(TOO_BIG);
  const a = rn ** e, b = rd ** e;
  return p >= 0n ? rat(sign * a, b) : rat(sign * b, a);
}

// [n, d] as Numbers if exactly representable, else as BigInts.
function toNumbers([n, d]) {
  const safe = (x) => x <= BigInt(Number.MAX_SAFE_INTEGER) && x >= -BigInt(Number.MAX_SAFE_INTEGER);
  return safe(n) && safe(d) ? [Number(n), Number(d)] : [n, d];
}

// ---- evaluation

const leafText = (t) => {
  if (t.frac === null) return t.int;
  const a = t.frac.length - t.rep;
  return `${t.int}.${t.frac.slice(0, a)}${t.rep ? `(${t.frac.slice(a)})` : ""}`;
};

export const OP_NAMES = {
  concat: "Concatenation", pow: "^", fact: "!", sqrt: "√", root: "b√a", dot: "Decimals", rec: "Recurring decimals",
};

// The numbers in an expression, left to right (a root's index comes before its radicand).
function leaves(t, out = []) {
  if (t.type === "num") out.push(t);
  else if (t.type === "root") { leaves(t.b, out); leaves(t.a, out); }
  else { leaves(t.a, out); if (t.b) leaves(t.b, out); }
  return out;
}

// Ways to split a number's digits into the puzzle's numbers, with any decimal
// point at a boundary between them.
function splits(leaf, numbers) {
  const digits = leaf.int + (leaf.frac ?? "");
  // the point and the start of any recurring digits must fall between numbers
  const cuts = leaf.frac === null ? [] : [leaf.int.length, digits.length - leaf.rep];
  const strings = [...new Set(numbers.map(String))];
  const out = [];
  const go = (at, parts) => {
    if (at === digits.length) { out.push(parts); return; }
    for (const s of strings) {
      if (!digits.startsWith(s, at)) continue;
      if (cuts.some((c) => c > at && c < at + s.length)) continue;
      go(at + s.length, [...parts, Number(s)]);
    }
  };
  go(0, []);
  return out;
}

// Assign every number in the expression to a distinct puzzle number (in order,
// if required). Returns true if possible.
function assign(parts, numbers, ordered, all) {
  const used = new Array(numbers.length).fill(false);
  const go = (k, last) => {
    if (k === parts.length) return !all || used.every(Boolean);
    for (let i = ordered ? last + 1 : 0; i < numbers.length; i++) {
      if (used[i] || numbers[i] !== parts[k]) continue;
      used[i] = true;
      if (go(k + 1, i)) return true;
      used[i] = false;
    }
    return false;
  };
  return go(0, -1);
}

// Check the expression's numbers against the puzzle; throws ExprError.
function checkNumbers(tree, numbers, rules, ops) {
  const ls = leaves(tree);
  const options = ls.map((leaf) => {
    const ways = splits(leaf, numbers);
    if (!ways.length) {
      throw new ExprError(`${leafText(leaf)} isn't made from the numbers`);
    }
    return ways;
  });
  for (const [k, leaf] of ls.entries()) {
    if (!ops.concat && options[k].every((w) => w.length > 1)) throw new ExprError("Concatenation isn't allowed");
    if (leaf.rep && !ops.rec) throw new ExprError("Recurring decimals aren't allowed");
    if (leaf.frac !== null && !leaf.rep && !ops.dot) throw new ExprError("Decimals aren't allowed");
  }
  // try every combination of splits (there are very few)
  const fits = (ordered, all) => {
    const go = (k, parts) => {
      if (k === ls.length) return assign(parts, numbers, ordered, all);
      return options[k].some((w) => (ops.concat || w.length === 1) && go(k + 1, [...parts, ...w]));
    };
    return go(0, []);
  };
  if (fits(!!rules.order, !!rules.all)) return;
  if (!fits(false, false)) throw new ExprError("Uses numbers that aren't available");
  if (rules.order && !fits(true, false)) throw new ExprError("The numbers must be used in order");
  throw new ExprError("All the numbers must be used");
}

/**
 * Evaluate a parsed expression exactly, checking it against the puzzle.
 * Returns [numerator, denominator], as Numbers if they fit exactly, else as
 * BigInts; throws ExprError.
 */
export function evaluate(tree, { numbers, rules = {}, ops = {} }) {
  checkNumbers(tree, numbers, rules, ops);
  const need = (op) => {
    if (!ops[op]) throw new ExprError(`${OP_NAMES[op]} isn't allowed`);
  };
  const ev = (t) => {
    const v = value(t);
    if (rules.integers && v[1] !== 1n) throw new ExprError("Fractions aren't allowed");
    return v;
  };
  const value = (t) => {
    switch (t.type) {
      case "num": {
        const digits = BigInt(t.int + (t.frac ?? ""));
        if (t.frac === null) return [digits, 1n];
        if (!t.rep) return rat(digits, 10n ** BigInt(t.frac.length));
        // int.A(R) = (intA + R / (10^r - 1)) / 10^a
        const a = t.frac.length - t.rep;
        const nines = 10n ** BigInt(t.rep) - 1n;
        const head = BigInt(t.int + t.frac.slice(0, a) || 0);
        return rat(head * nines + BigInt(t.frac.slice(a)), 10n ** BigInt(a) * nines);
      }
      case "neg": { const [n, d] = ev(t.a); return [-n, d]; }
      case "!": {
        need("fact");
        const [n, d] = ev(t.a);
        if (d !== 1n || n < 0n) throw new ExprError("Factorials need a whole number that isn't negative");
        if (n > 500n) throw new ExprError(TOO_BIG);
        let f = 1n;
        for (let i = 2n; i <= n; i++) f *= i;
        return rat(f, 1n);
      }
      case "sqrt": need("sqrt"); return power(ev(t.a), [1n, 2n], "Square root");
      case "root": {
        need("root");
        const [bn, bd] = ev(t.b);
        if (bn === 0n) throw new ExprError("0th root");
        return power(ev(t.a), bn < 0n ? [-bd, -bn] : [bd, bn], "Root");
      }
      case "^": {
        need("pow");
        return power(ev(t.a), ev(t.b), "Power");
      }
      default: {
        const [a, b] = ev(t.a), [c, d] = ev(t.b);
        switch (t.type) {
          case "+": return rat(a * d + c * b, b * d);
          case "-": return rat(a * d - c * b, b * d);
          case "*": return rat(a * c, b * d);
          case "/": if (c === 0n) throw new ExprError("Division by zero"); return rat(a * d, b * c);
        }
      }
    }
    throw new Error(`Unknown node ${t.type}`);
  };
  return toNumbers(ev(tree));
}

export function formatValue([n, d]) {
  return String(d) === "1" ? String(n).replace("-", "−") : `${String(n).replace("-", "−")}/${d}`;
}

// ---- rendering as HTML

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const PREC = { "+": 1, "-": 1, "*": 2, "/": 2, neg: 3, "^": 4, root: 5, sqrt: 5, "!": 6, num: 7 };
const SHOW = { "+": "+", "-": "−", "*": "×", "/": "÷" };

export function toHTML(t) {
  const sub = (x, paren) => (paren ? `(${toHTML(x)})` : toHTML(x));
  const p = PREC[t.type];
  switch (t.type) {
    case "num": {
      if (t.frac === null) return t.int;
      const a = t.frac.length - t.rep;
      return `${t.int}.${t.frac.slice(0, a)}${t.rep ? `<span class="rec">${t.frac.slice(a)}</span>` : ""}`;
    }
    case "neg": return `−${sub(t.a, PREC[t.a.type] < p)}`;
    case "!": return `${sub(t.a, PREC[t.a.type] < p)}!`;
    case "sqrt": return `<span class="radical">√<span class="radicand">${toHTML(t.a)}</span></span>`;
    case "root": return `<span class="radical"><sup class="index">${toHTML(t.b)}</sup>√<span class="radicand">${toHTML(t.a)}</span></span>`;
    case "^": return `${sub(t.a, PREC[t.a.type] <= p)}<sup>${toHTML(t.b)}</sup>`;
    default: {
      const tight = t.type === "-" || t.type === "/";
      return `${sub(t.a, PREC[t.a.type] < p)} ${SHOW[t.type]} ${sub(t.b, PREC[t.b.type] < p || (tight && PREC[t.b.type] === p))}`;
    }
  }
}

// Render ASCII expression text as HTML (the text as typed if it doesn't parse).
export function textToHTML(text) {
  try {
    return toHTML(parse(text));
  } catch (e) {
    if (e instanceof ExprError) return esc(text);
    throw e;
  }
}
