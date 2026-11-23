import { test } from "node:test";
import assert from "node:assert/strict";
import { distribution, highest, lowest, moments, probabilityBetween } from "../src/dice/distribution.js";

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≈ ${b}`);

test("2d6 + 1 has the usual triangle, shifted", () => {
  const dist = distribution({ groups: [{ m: 2, d: 6, a: 1 }], c: 1 });
  assert.equal(lowest(dist), 3);
  assert.equal(highest(dist), 13);
  close(probabilityBetween(dist, 8, 8), 6 / 36);
  close(probabilityBetween(dist, -Infinity, Infinity), 1);
});

test("multipliers only make multiples of their step, and mixed groups combine", () => {
  const doubled = distribution({ groups: [{ m: 1, d: 6, a: 2 }] });
  close(probabilityBetween(doubled, 4, 4), 1 / 6);
  close(probabilityBetween(doubled, 5, 5), 0);
  const mixed = distribution({ groups: [{ m: 1, d: 6, a: 2 }, { m: 1, d: 4, a: 1 }], c: -1 });
  const { mean, sd } = moments(mixed);
  close(mean, 7 + 2.5 - 1);
  close(sd, Math.sqrt(4 * 35 / 12 + 15 / 12));
});

test("rules drop a die", () => {
  const ability = distribution({ groups: [{ m: 4, d: 6, a: 1 }], rule: { drop: "lowest" } });
  close(moments(ability).mean, 15869 / 1296);
  const advantage = distribution({ groups: [{ m: 2, d: 20, a: 1 }], rule: { drop: "lowest" }, c: 2 });
  close(probabilityBetween(advantage, 22, 22), 39 / 400);
});

test("big rolls use the normal approximation, which still sums to 1", () => {
  const dist = distribution({ groups: [{ m: 999, d: 100, a: 1 }] });
  assert.equal(dist.normal, true);
  close(probabilityBetween(dist, -Infinity, Infinity), 1, 1e-6);
  close(probabilityBetween(dist, 50449, 50450), probabilityBetween(dist, 50451, 50452), 1e-6);
});
