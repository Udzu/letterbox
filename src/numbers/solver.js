// Numbers puzzle solver: finds the simplest expression for each reachable value
// using exact rationals (numerator/denominator as doubles, kept below 2^53).
//
// Expressions are stored as nodes in flat typed arrays (value, cost, operation,
// children) so that millions of them can be built without allocating objects.

export const OPS = ['concat', 'pow', 'fact', 'sqrt', 'root', 'dot', 'rec'];

// Node operations.
const LEAF = 0, ADD = 1, SUB = 2, MUL = 3, DIV = 4, NEG = 5, POW = 6, FACT = 7, SQRT = 8, ROOT = 9;
const OP_NAMES = ['leaf', '+', '-', '*', '/', 'neg', 'pow', 'fact', 'sqrt', 'root'];

// Cost of each operation; lower is simpler. Basic arithmetic first, then the
// extra operations in the order they're listed on the page.
export const COST = {
  '+': 10, '-': 10, '*': 11, '/': 11, neg: 11,
  concat: 12, pow: 13, fact: 14, sqrt: 15, root: 16, dot: 17, rec: 18,
};

const MAX = 2 ** 53;
const FACTORIALS = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800, 39916800,
  479001600, 6227020800, 87178291200, 1307674368000, 20922789888000, 355687428096000,
  6402373705728000];

function gcd(a, b) {
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

// Results of the arithmetic helpers, to avoid allocating.
let RN = 0, RD = 1;
// Whether only integer results are wanted (the final step).
let INTS = false;

// Normalise n/d into RN/RD; false if invalid or too big.
function make(n, d) {
  if (d === 1) {
    if (n >= MAX || -n >= MAX || n !== n) return false;
    RN = n; RD = 1;
    return true;
  }
  if (d === 0 || n !== n || d !== d) return false;
  if (d < 0) { n = -n; d = -d; }
  if (n >= MAX || -n >= MAX || d >= MAX) return false;
  if (INTS) {
    if (n % d !== 0) return false;
    RN = n / d; RD = 1;
    return true;
  }
  const g = gcd(n < 0 ? -n : n, d);
  RN = n / g; RD = d / g;
  return true;
}

function mul(a, b) {
  const p = a * b;
  return p >= MAX || -p >= MAX ? NaN : p;
}

// Exact integer k-th root of a non-negative integer, or -1.
export function iroot(n, k) {
  if (n < 2 || k === 1) return n;
  const r = Math.round(n ** (1 / k));
  for (let c = r > 0 ? r - 1 : 0; c <= r + 1; c++) {
    let p = 1;
    for (let i = 0; i < k && p <= n; i++) p *= c;
    if (p === n) return c;
  }
  return -1;
}

// RN/RD = (n/d)^(p/q), with q > 0 and lg = log2|n/d|. False if irrational or too big.
function power(n, d, lg, p, q, allowNeg) {
  if (n === 0) { RN = 0; RD = 1; return p > 0; }
  // a power of a reduced fraction is an integer only if its base is
  if (INTS && (p > 0 ? d !== 1 : n !== 1 && n !== -1)) return false;
  const e = p < 0 ? -p : p;
  if (q > 64 || e > 64) return false;
  if (Math.abs(lg) * e / q > 53.5) return false;
  let sign = 1;
  if (n < 0) {
    if (q % 2 === 0) return false;
    n = -n;
    if (e % 2 === 1) { if (!allowNeg) return false; sign = -1; }
  }
  const rn = iroot(n, q);
  if (rn < 0) return false;
  const rd = iroot(d, q);
  if (rd < 0) return false;
  let a = 1, b = 1;
  for (let i = 0; i < e; i++) { a *= rn; b *= rd; }
  if (a >= MAX || b >= MAX) return false;
  return p > 0 ? make(sign * a, b) : make(sign * b, a);
}

// Leaf values formed from an ordered list of input numbers: plain number,
// concatenation, decimal point at a number boundary, recurring decimal.
function leaves(nums, ops, fractions) {
  const out = [];
  const s = nums.map(String).join('');
  const L = s.length;
  const k = nums.length;
  if ((k > 1 && !ops.concat) || L > 15) return out;
  const base = (k - 1) * COST.concat;
  out.push({ n: Number(s), d: 1, c: base, text: s });
  if (fractions && (ops.dot || ops.rec)) {
    let p = 0;
    for (let i = 0; i < k; i++) {
      const ip = s.slice(0, p), fp = s.slice(p);
      const f = L - p;
      if (ops.dot && make(Number(s), 10 ** f)) {
        out.push({ n: RN, d: RD, c: base + COST.dot, text: `${ip}.${fp}` });
      }
      if (ops.rec) {
        // recurring from each number boundary after the point: ip.A(R)
        let q = p;
        for (let j = i; j < k; j++) {
          const A = s.slice(p, q), R = s.slice(q);
          const nines = 10 ** R.length - 1;
          if (make(Number(ip + A || 0) * nines + Number(R), 10 ** A.length * nines)) {
            out.push({ n: RN, d: RD, c: base + COST.rec, text: A ? `${ip}.${A}(${R})` : `${ip}.${R}~` });
          }
          q += String(nums[j]).length;
        }
      }
      p += String(nums[i]).length;
    }
  }
  return out;
}

function permutations(xs) {
  if (xs.length <= 1) return [xs];
  const out = [];
  xs.forEach((x, i) => {
    for (const p of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

function popcount(m) {
  let c = 0;
  for (; m; m &= m - 1) c++;
  return c;
}

// Growable node store.
class Store {
  constructor() {
    this.size = 0;
    this.cap = 1 << 16;
    this.alloc();
    this.text = new Map();
  }

  alloc() {
    const grow = (T, a) => { const b = new T(this.cap); if (a) b.set(a); return b; };
    this.N = grow(Float64Array, this.N);
    this.D = grow(Float64Array, this.D);
    this.LG = grow(Float64Array, this.LG);
    this.C = grow(Uint16Array, this.C);
    this.OP = grow(Uint8Array, this.OP);
    this.A = grow(Int32Array, this.A);
    this.B = grow(Int32Array, this.B);
  }

  push(n, d, c, op, a, b) {
    if (this.size === this.cap) { this.cap *= 2; this.alloc(); }
    const i = this.size++;
    this.N[i] = n; this.D[i] = d; this.C[i] = c; this.OP[i] = op; this.A[i] = a; this.B[i] = b;
    this.LG[i] = n === 0 ? 0 : Math.log2(Math.abs(n)) - Math.log2(d);
    return i;
  }
}

// Open-addressing hash table from rational n/d to node id.
class Table {
  constructor(bits = 10) {
    this.bits = bits;
    this.mask = (1 << bits) - 1;
    this.N = new Float64Array(1 << bits);
    this.D = new Float64Array(1 << bits);
    this.V = new Int32Array(1 << bits).fill(-1);
    this.size = 0;
  }

  slot(n, d) {
    let h = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul((n / 4294967296) | 0, 0x7feb352d)
      ^ Math.imul(d | 0, 0x85ebca77)) >>> (32 - this.bits);
    const { N, D, V, mask } = this;
    while (V[h] !== -1 && (N[h] !== n || D[h] !== d)) h = (h + 1) & mask;
    return h;
  }

  get(n, d) {
    return this.V[this.slot(n, d)];
  }

  set(n, d, id) {
    const h = this.slot(n, d);
    if (this.V[h] === -1) {
      if (++this.size * 2 > this.V.length) { this.grow(); this.set(n, d, id); return; }
      this.N[h] = n; this.D[h] = d;
    }
    this.V[h] = id;
  }

  grow() {
    const { N, D, V } = this;
    this.bits++;
    this.mask = (1 << this.bits) - 1;
    this.N = new Float64Array(1 << this.bits);
    this.D = new Float64Array(1 << this.bits);
    this.V = new Int32Array(1 << this.bits).fill(-1);
    for (let i = 0; i < V.length; i++) {
      if (V[i] !== -1) { const h = this.slot(N[i], D[i]); this.N[h] = N[i]; this.D[h] = D[i]; this.V[h] = V[i]; }
    }
  }
}

export class Budget extends Error {}

/**
 * Solve for every value reachable from the given numbers.
 * rules: { all, order, integers } (integers = no intermediate fractions)
 * ops: { concat, pow, fact, sqrt, root, dot, rec }
 * Returns Map from integer target in [lo, hi] to its simplest expression (ASCII).
 * Throws Budget (before doing it) if more than `budget` pairs need combining,
 * or once more than `nodeBudget` expressions are stored.
 */
export function solve(numbers, rules, ops, {
  lo = 0, hi = 999, maxNum = Infinity, maxDen = Infinity, budget = Infinity, nodeBudget = Infinity, stats, progress,
} = {}) {
  const n = numbers.length;
  const full = (1 << n) - 1;
  const neg = !!rules.order; // negatives only needed when the order is fixed
  const fractions = !rules.integers;
  const S = new Store();
  const sets = new Array(full + 1); // Int32Array of node ids per mask

  // Set under construction.
  let index = null; // value -> node id
  let ids = []; // node ids in the set (some may be superseded)
  let top = false;
  const find = (vn, vd) => index.get(vn, vd);

  // Add RN/RD with cost c, unless invalid or already known as cheaply.
  // Returns the new node id or -1.
  const add = (c, op, a, b) => {
    const vn = RN, vd = RD;
    if (vd !== 1 && !fractions) return -1;
    if (vn < 0 && !neg) return -1;
    const av = vn < 0 ? -vn : vn;
    if (top) {
      // only values that can still become a target: in range, or a perfect square
      if (vd !== 1) return -1;
      if (av > hi && !(ops.sqrt && iroot(av, 2) >= 0)) return -1;
    } else if ((av > maxNum || vd > maxDen) && !(ops.sqrt && iroot(av, 2) >= 0 && iroot(vd, 2) >= 0)) {
      return -1;
    }
    const f = find(vn, vd);
    if (f >= 0 && S.C[f] <= c) return -1;
    if (S.size >= nodeBudget) throw new Budget();
    const id = S.push(vn, vd, c, op, a, b);
    index.set(vn, vd, id);
    ids.push(id);
    return id;
  };

  // Without negatives (order off), sign tracking removes the need for them except
  // in exponents and root indices: x^(-y) = 1/x^y would need a spare 1. So try
  // those directly, with a negation node that isn't added to any set.
  const negNode = (y) => S.push(-S.N[y], S.D[y], S.C[y] + COST.neg, NEG, y, -1);
  const negPow = (x, y, base) => { // x^(-y)
    if (!ops.pow || neg || S.N[y] <= 0) return;
    if (power(S.N[x], S.D[x], S.LG[x], -S.N[y], S.D[y], false)) add(base + COST.neg + COST.pow, POW, x, negNode(y));
  };
  const negRoot = (y, x, base) => { // (-y)√x = x^(-1/y)
    if (!ops.root || neg || S.N[y] <= 0) return;
    if (power(S.N[x], S.D[x], S.LG[x], -S.D[y], S.N[y], false)) add(base + COST.neg + COST.root, ROOT, negNode(y), x);
  };

  // Add n/d ^ (p/q) with cost c as node (op, a, b). If that's too big to hold
  // exactly but square roots are allowed, add √…√ of it instead where that
  // brings it back, as in √√√(7^24) = 7^3.
  const tryPow = (n, d, lg, p, q, c, op, a, b) => {
    if (power(n, d, lg, p, q, neg)) {
      add(c, op, a, b);
      return;
    }
    // only worth trying if the numerator or denominator got too big
    if (!ops.sqrt || Math.max(Math.log2(Math.abs(n)), Math.log2(d)) * Math.abs(p) / q <= 53) return;
    for (let k = 1, pk = p; k <= 12 && pk % 2 === 0; k++) {
      pk /= 2;
      if (!power(n, d, lg, pk, q, neg)) continue;
      const rn = RN, rd = RD, cost = c + k * COST.sqrt;
      const f = find(rn, rd);
      if (f >= 0 && S.C[f] <= cost) continue;
      // the power itself, outside any set, then the square roots
      let id = S.push(NaN, NaN, c, op, a, b);
      for (let i = 1; i < k; i++) id = S.push(NaN, NaN, c + i * COST.sqrt, SQRT, id, -1);
      RN = rn; RD = rd;
      add(cost, SQRT, id, -1);
    }
  };

  const binary = (x, y, ordered) => {
    const N = S.N, D = S.D;
    const xn = N[x], xd = D[x], yn = N[y], yd = D[y];
    const base = S.C[x] + S.C[y];
    const xy = mul(xn, yd), yx = mul(yn, xd), dd = mul(xd, yd);
    if (make(xy + yx, dd)) add(base + COST['+'], ADD, x, y);
    if (make(mul(xn, yn), dd)) add(base + COST['*'], MUL, x, y);
    if (make(xy - yx, dd)) add(base + COST['-'], SUB, x, y);
    if (yn !== 0 && make(xy, yx)) add(base + COST['/'], DIV, x, y);
    // x^y, and xVy = y^(1/x)
    if (ops.pow) tryPow(xn, xd, S.LG[x], yn, yd, base + COST.pow, POW, x, y);
    negPow(x, y, base);
    if (ops.root && xn !== 0) tryPow(yn, yd, S.LG[y], xn < 0 ? -xd : xd, xn < 0 ? -xn : xn, base + COST.root, ROOT, x, y);
    negRoot(x, y, base);
    if (ordered) return;
    if (make(yx - xy, dd)) add(base + COST['-'], SUB, y, x);
    if (xn !== 0 && make(yx, xy)) add(base + COST['/'], DIV, y, x);
    if (ops.pow) tryPow(yn, yd, S.LG[y], xn, xd, base + COST.pow, POW, y, x);
    negPow(y, x, base);
    if (ops.root && yn !== 0) tryPow(xn, xd, S.LG[x], yn < 0 ? -yd : yd, yn < 0 ? -yn : yn, base + COST.root, ROOT, y, x);
    negRoot(y, x, base);
  };

  // binary() for the final step, which only keeps integers: skip combinations
  // that can't give one (x and y are reduced fractions).
  const binaryTop = (x, y, ordered) => {
    const N = S.N, D = S.D;
    const xn = N[x], xd = D[x], yn = N[y], yd = D[y];
    const base = S.C[x] + S.C[y];
    if (xd === yd) {
      if (make(xn + yn, xd)) add(base + COST['+'], ADD, x, y);
      if (make(xn - yn, xd)) add(base + COST['-'], SUB, x, y);
      if (!ordered && make(yn - xn, xd)) add(base + COST['-'], SUB, y, x);
    }
    if (xn % yd === 0 && yn % xd === 0 && make(mul(xn / yd, yn / xd), 1)) add(base + COST['*'], MUL, x, y);
    if (yn !== 0 && xn % yn === 0 && yd % xd === 0 && make(mul(xn / yn, yd / xd), 1)) add(base + COST['/'], DIV, x, y);
    if (!ordered && xn !== 0 && yn % xn === 0 && xd % yd === 0 && make(mul(yn / xn, xd / yd), 1)) {
      add(base + COST['/'], DIV, y, x);
    }
    if (ops.pow) tryPow(xn, xd, S.LG[x], yn, yd, base + COST.pow, POW, x, y);
    negPow(x, y, base);
    if (ops.root && xn !== 0) tryPow(yn, yd, S.LG[y], xn < 0 ? -xd : xd, xn < 0 ? -xn : xn, base + COST.root, ROOT, x, y);
    negRoot(x, y, base);
    if (ordered) return;
    if (ops.pow) tryPow(yn, yd, S.LG[y], xn, xd, base + COST.pow, POW, y, x);
    negPow(y, x, base);
    if (ops.root && yn !== 0) tryPow(xn, xd, S.LG[x], yn < 0 ? -yd : yd, yn < 0 ? -yn : yn, base + COST.root, ROOT, y, x);
    negRoot(y, x, base);
  };

  const unary = () => {
    const work = ids.slice();
    while (work.length) {
      const x = work.pop();
      const a = S.N[x], b = S.D[x], c = S.C[x];
      if (find(a, b) !== x) continue; // superseded
      const push = (id) => { if (id >= 0) work.push(id); };
      if (ops.sqrt && a > 0 && (a !== 1 || b !== 1) && power(a, b, S.LG[x], 1, 2, neg)) {
        push(add(c + COST.sqrt, SQRT, x, -1));
      }
      if (ops.fact && b === 1 && a >= 0 && a < FACTORIALS.length && a !== 1 && a !== 2) {
        RN = FACTORIALS[a]; RD = 1;
        push(add(c + COST.fact, FACT, x, -1));
      }
      if (neg && a !== 0) { RN = -a; RD = b; push(add(c + COST.neg, NEG, x, -1)); }
    }
  };

  // The current node for each value in the set.
  const finish = () => {
    const out = [];
    for (const id of ids) if (find(S.N[id], S.D[id]) === id) out.push(id);
    return Int32Array.from(out);
  };

  const masks = [];
  for (let m = 1; m <= full; m++) masks.push(m);
  masks.sort((x, y) => popcount(x) - popcount(y) || x - y);

  // Best solution for each target: fewest numbers used, then lowest cost. Masks
  // come in order of size, so a target's first solution uses the fewest numbers.
  const best = new Map(); // target -> node id
  const used = new Map(); // target -> how many numbers its solution uses
  const record = (m) => {
    const k = popcount(m);
    for (const id of sets[m]) {
      const v = S.N[id];
      if (S.D[id] !== 1 || v < lo || v > hi) continue;
      if (!best.has(v) || (used.get(v) === k && S.C[id] < S.C[best.get(v)])) {
        best.set(v, id);
        used.set(v, k);
      }
    }
  };

  let done = 0, work = 0;
  for (const m of masks) {
    // Without "use all", stop once every target is solved: bigger subsets use more numbers.
    if (!rules.all && best.size === hi - lo + 1 && popcount(m) > Math.max(...used.values())) break;
    const idx = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) idx.push(i);
    index = new Table(); ids = [];
    top = INTS = m === full;
    for (const o of rules.order ? [idx] : permutations(idx)) {
      for (const l of leaves(o.map((i) => numbers[i]), ops, fractions)) {
        RN = l.n; RD = l.d;
        const id = add(l.c, LEAF, -1, -1);
        if (id >= 0) S.text.set(id, l.text);
      }
    }
    let need = 0;
    const splits = [];
    if (rules.order) {
      for (let s = 1; s < idx.length; s++) {
        let left = 0;
        for (let i = 0; i < s; i++) left |= 1 << idx[i];
        splits.push(left);
      }
    } else {
      // unordered splits: left contains the lowest set bit
      const low = m & -m;
      for (let left = (m - 1) & m; left; left = (left - 1) & m) if (left & low) splits.push(left);
    }
    for (const left of splits) need += sets[left].length * sets[m ^ left].length;
    work += need;
    if (work > budget) throw new Budget();
    if (stats) stats.work = work;
    const pairs = (left) => {
      const X = sets[left], Y = sets[m ^ left];
      const f = top ? binaryTop : binary, ordered = !!rules.order;
      for (let i = 0; i < X.length; i++) for (let j = 0; j < Y.length; j++) f(X[i], Y[j], ordered);
    };
    for (const left of splits) pairs(left);
    unary();
    sets[m] = finish();
    index = null; ids = []; INTS = false;
    if (stats) stats[m] = sets[m].length;
    if (!rules.all || m === full) record(m);
    if (progress) progress(++done / masks.length);
  }

  const result = new Map();
  for (const t of [...best.keys()].sort((a, b) => a - b)) result.set(t, toText(S, best.get(t)));
  return result;
}

// Search limits, from tightest to none.
export const LIMITS = [
  { maxNum: 1e3, maxDen: 10 },
  { maxNum: 1e4, maxDen: 100 },
  { maxNum: 1e6, maxDen: 1e3 },
  { maxNum: Infinity, maxDen: Infinity },
];

/**
 * Solve with successively looser limits, yielding { solutions, exact, step }
 * after each one that fits the budget. The first step always runs. exact means
 * no limits were needed, so unsolved targets are impossible, not just not found.
 */
export function* solveSteps(numbers, rules, ops, { budget = 2e7, nodeBudget = 2e6, progress } = {}) {
  for (let step = 0; step < LIMITS.length; step++) {
    let solutions;
    try {
      solutions = solve(numbers, rules, ops, {
        ...LIMITS[step],
        budget: step ? budget : Infinity,
        nodeBudget: step ? nodeBudget : Infinity,
        progress: progress && ((f) => progress(f, step)),
      });
    } catch (e) {
      if (e instanceof Budget) return;
      throw e;
    }
    const exact = step === LIMITS.length - 1;
    yield { solutions, exact, step };
  }
}

// ASCII rendering with minimal parentheses.
const PREC = [7, 1, 1, 2, 2, 3, 4, 6, 5, 5];
const P_NEG = 3, P_FACT = 6;

function toText(S, x) {
  const op = S.OP[x], a = S.A[x], b = S.B[x];
  const p = PREC[op];
  const wrap = (y, cond) => (cond ? `(${toText(S, y)})` : toText(S, y));
  switch (op) {
    case LEAF: return S.text.get(x);
    case FACT: return `${wrap(a, PREC[S.OP[a]] < p)}!`;
    case SQRT: return `V${wrap(a, PREC[S.OP[a]] < p)}`;
    case NEG: return `-${wrap(a, PREC[S.OP[a]] < p)}`;
    case ROOT: return `${wrap(a, PREC[S.OP[a]] < P_FACT)}V${wrap(b, PREC[S.OP[b]] < p)}`;
    case POW: return `${wrap(a, PREC[S.OP[a]] <= p)}^${wrap(b, PREC[S.OP[b]] < P_NEG)}`;
    default: {
      const tight = op === SUB || op === DIV;
      return `${wrap(a, PREC[S.OP[a]] < p)}${OP_NAMES[op]}${wrap(b, PREC[S.OP[b]] < p || (tight && PREC[S.OP[b]] === p))}`;
    }
  }
}
