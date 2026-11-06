// Sets of Unicode code points, stored as sorted, disjoint, non-adjacent inclusive ranges.
// These label NFA edges, so [^a] is just the two ranges either side of "a" and every edge
// means the same thing regardless of what other edges leave its state.

export const MAX_CP = 0x10ffff;

export class CharSet {
  // ranges must already be normalised: use CharSet.from for arbitrary ranges
  constructor(ranges) {
    this.ranges = ranges;
    Object.freeze(ranges);
    Object.freeze(this);
  }

  static from(ranges) {
    const sorted = ranges.filter(([lo, hi]) => lo <= hi).sort((x, y) => x[0] - y[0]);
    const out = [];
    for (const [lo, hi] of sorted) {
      const last = out[out.length - 1];
      if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
      else out.push([lo, hi]);
    }
    return new CharSet(out.map((r) => Object.freeze(r)));
  }

  static of(...cps) {
    return CharSet.from(cps.map((cp) => [cp, cp]));
  }

  isEmpty() {
    return this.ranges.length === 0;
  }

  isAll() {
    return this.ranges.length === 1 && this.ranges[0][0] === 0 && this.ranges[0][1] === MAX_CP;
  }

  has(cp) {
    const r = this.ranges;
    let lo = 0;
    let hi = r.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cp < r[mid][0]) hi = mid - 1;
      else if (cp > r[mid][1]) lo = mid + 1;
      else return true;
    }
    return false;
  }

  // number of code points in the set
  size() {
    return this.ranges.reduce((n, [lo, hi]) => n + hi - lo + 1, 0);
  }

  union(other) {
    return CharSet.from([...this.ranges, ...other.ranges].map(([lo, hi]) => [lo, hi]));
  }

  intersect(other) {
    const a = this.ranges;
    const b = other.ranges;
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      const lo = Math.max(a[i][0], b[j][0]);
      const hi = Math.min(a[i][1], b[j][1]);
      if (lo <= hi) out.push(Object.freeze([lo, hi]));
      if (a[i][1] < b[j][1]) i++;
      else j++;
    }
    return new CharSet(out);
  }

  complement() {
    const out = [];
    let next = 0;
    for (const [lo, hi] of this.ranges) {
      if (lo > next) out.push(Object.freeze([next, lo - 1]));
      next = hi + 1;
    }
    if (next <= MAX_CP) out.push(Object.freeze([next, MAX_CP]));
    return new CharSet(out);
  }

  minus(other) {
    return this.intersect(other.complement());
  }

  equals(other) {
    return (
      this.ranges.length === other.ranges.length &&
      this.ranges.every(([lo, hi], i) => lo === other.ranges[i][0] && hi === other.ranges[i][1])
    );
  }

  isSubsetOf(other) {
    return this.minus(other).isEmpty();
  }

  toString() {
    const fmt = (cp) => (cp >= 0x21 && cp <= 0x7e ? String.fromCodePoint(cp) : `U+${cp.toString(16).toUpperCase()}`);
    return `{${this.ranges.map(([lo, hi]) => (lo === hi ? fmt(lo) : `${fmt(lo)}-${fmt(hi)}`)).join(",")}}`;
  }
}

CharSet.EMPTY = new CharSet([]);
CharSet.ALL = new CharSet([Object.freeze([0, MAX_CP])]);

// Split some sets into disjoint non-empty pieces, so that each input set is a union of
// pieces. Returns [{ set, members }] where members are the indices of the inputs that
// contain that piece. Used to turn an NFA state set's outgoing edges into DFA edges.
export function partition(sets) {
  // common case, as in word lists and literal text: every set is a single character
  if (sets.every((s) => s.ranges.length === 1 && s.ranges[0][0] === s.ranges[0][1])) {
    const byChar = new Map();
    sets.forEach((s, i) => {
      const cp = s.ranges[0][0];
      const piece = byChar.get(cp);
      if (piece) piece.members.push(i);
      else byChar.set(cp, { set: s, members: [i] });
    });
    // in code point order, as below
    return [...byChar].sort((x, y) => x[0] - y[0]).map(([, piece]) => piece);
  }
  const points = new Set();
  for (const s of sets) {
    for (const [lo, hi] of s.ranges) {
      points.add(lo);
      points.add(hi + 1);
    }
  }
  const bounds = [...points].sort((x, y) => x - y);
  // members[k] lists the inputs containing the segment [bounds[k], bounds[k + 1])
  const members = bounds.map(() => []);
  sets.forEach((s, i) => {
    for (const [lo, hi] of s.ranges) {
      for (let k = lowerBound(bounds, lo); bounds[k] <= hi; k++) members[k].push(i);
    }
  });
  const pieces = new Map();
  for (let k = 0; k < bounds.length - 1; k++) {
    if (members[k].length === 0) continue;
    const key = members[k].join(",");
    if (!pieces.has(key)) pieces.set(key, { ranges: [], members: members[k] });
    pieces.get(key).ranges.push([bounds[k], bounds[k + 1] - 1]);
  }
  return [...pieces.values()].map(({ ranges, members }) => ({ set: CharSet.from(ranges), members }));
}

function lowerBound(xs, x) {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
