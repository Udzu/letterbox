// Probability distributions of dice totals, for the Dice page's chart.
//
// A distribution is either exact, { lo, step, p }, where p[i] is the probability of the total
// lo + i·step, or, for rolls too big to work out exactly, approximate, { normal: true, mean, sd,
// lo, hi, step }, a normal curve over the totals lo, lo + step, …, hi.

const MAX_WORK = 4e6; // the most work (array cells times dice) an exact distribution may take

const gcd = (x, y) => {
  while (y) [x, y] = [y, x % y];
  return x;
};

// the exact distribution of m dice dk, by adding one die at a time with a running sum
function uniformSum(m, k) {
  let p = new Float64Array([1]);
  for (let i = 0; i < m; i++) {
    const next = new Float64Array(p.length + k - 1);
    let window = 0;
    for (let j = 0; j < next.length; j++) {
      if (j < p.length) window += p[j];
      if (j - k >= 0) window -= p[j - k];
      next[j] = window / k;
    }
    p = next;
  }
  return { lo: m, step: 1, p };
}

// a distribution spread out to a smaller step that divides its own (adding zero entries)
function respaced(dist, step) {
  const factor = dist.step / step;
  if (factor === 1) return dist.p;
  const p = new Float64Array((dist.p.length - 1) * factor + 1);
  dist.p.forEach((x, i) => (p[i * factor] = x));
  return p;
}

function convolve(a, b) {
  const step = gcd(a.step, b.step);
  const pa = respaced(a, step), pb = respaced(b, step);
  const p = new Float64Array(pa.length + pb.length - 1);
  for (let i = 0; i < pa.length; i++) {
    if (pa[i] === 0) continue;
    for (let j = 0; j < pb.length; j++) p[i + j] += pa[i] * pb[j];
  }
  return { lo: a.lo + b.lo, step, p };
}

// The distribution of a roll: groups of m dice dk × a, plus the constant c, or, with a rule,
// a single group of dice with one die dropped ({ drop: "lowest" | "highest" }).
export function distribution({ groups, c = 0, rule = null }) {
  if (rule) return shifted(ruleDistribution(groups[0].m, groups[0].d, rule.drop), c);
  const step = groups.map(g => g.a).reduce(gcd);
  const lo = groups.reduce((sum, g) => sum + g.m * g.a, 0) + c;
  const hi = groups.reduce((sum, g) => sum + g.m * g.d * g.a, 0) + c;
  const cells = (hi - lo) / step + 1;
  const dice = groups.reduce((sum, g) => sum + g.m, 0);
  if (cells * dice > MAX_WORK || cells * cells > MAX_WORK * 4) {
    const mean = groups.reduce((sum, g) => sum + g.m * g.a * (g.d + 1) / 2, 0) + c;
    const variance = groups.reduce((sum, g) => sum + g.m * g.a * g.a * (g.d * g.d - 1) / 12, 0);
    return { normal: true, mean, sd: Math.sqrt(variance), lo, hi, step };
  }
  let dist = null;
  for (const g of groups) {
    const sum = uniformSum(g.m, g.d);
    const part = { lo: sum.lo * g.a, step: g.a, p: sum.p };
    dist = dist ? convolve(dist, part) : part;
  }
  return shifted(dist, c);
}

const shifted = (dist, c) => ({ ...dist, lo: dist.lo + c });

// every roll of m dice dk, dropping the lowest or highest die (only small rolls have rules)
function ruleDistribution(m, k, drop) {
  const p = new Float64Array((m - 1) * (k - 1) + 1);
  const faces = new Array(m);
  const each = i => {
    if (i === m) {
      const sum = faces.reduce((x, y) => x + y, 0);
      const dropped = drop === "lowest" ? Math.min(...faces) : Math.max(...faces);
      p[sum - dropped - (m - 1)] += 1 / k ** m;
      return;
    }
    for (let f = 1; f <= k; f++) {
      faces[i] = f;
      each(i + 1);
    }
  };
  each(0);
  return { lo: m - 1, step: 1, p };
}

// the standard normal cumulative distribution (Abramowitz and Stegun 7.1.26, error < 1.5e-7)
function phi(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// the probability of a total from `from` to `to` (inclusive)
export function probabilityBetween(dist, from, to) {
  from = Math.max(from, dist.lo);
  if (dist.normal) {
    to = Math.min(to, dist.hi);
    // the totals in range, each standing for the half-step either side of it
    const first = dist.lo + Math.ceil((from - dist.lo) / dist.step) * dist.step;
    const last = dist.lo + Math.floor((to - dist.lo) / dist.step) * dist.step;
    if (first > last) return 0;
    const z = x => (x - dist.mean) / dist.sd;
    return phi(z(last + dist.step / 2)) - phi(z(first - dist.step / 2));
  }
  let sum = 0;
  for (let i = Math.ceil((from - dist.lo) / dist.step); i < dist.p.length && dist.lo + i * dist.step <= to; i++) sum += dist.p[i];
  return sum;
}

// the mean and standard deviation, for choosing the range the chart shows
export function moments(dist) {
  if (dist.normal) return { mean: dist.mean, sd: dist.sd };
  let mean = 0, square = 0;
  dist.p.forEach((x, i) => {
    const v = dist.lo + i * dist.step;
    mean += x * v;
    square += x * v * v;
  });
  return { mean, sd: Math.sqrt(Math.max(0, square - mean * mean)) };
}

export const lowest = dist => dist.lo;
export const highest = dist => (dist.normal ? dist.hi : dist.lo + (dist.p.length - 1) * dist.step);
