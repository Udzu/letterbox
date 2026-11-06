import { test } from "node:test";
import assert from "node:assert/strict";
import { readShared, shareQuery } from "../src/patterns/share.js";

const VIEWS = { raw: 1, epsfree: 1, min: 1 };
const DEFAULT = "epsfree";
const roundTrip = (state) => readShared(shareQuery(state, DEFAULT), VIEWS, DEFAULT);

test("round trips patterns full of URL syntax", () => {
  for (const pattern of ["cow^ox", "a+b&!c#d", "(?<v>x)(?&v) %20 ?=/", "\\Qe.g.\\E", "é😀\\u{e9}", ""]) {
    const state = { pattern, tests: "a b\n+c&d=e\n\n#f%", view: "min", hidden: pattern === "" };
    assert.deepEqual(roundTrip(state), state);
  }
});

test("omits empty test strings, the default view and a shown diagram", () => {
  assert.equal(shareQuery({ pattern: "a b", tests: "\n", view: DEFAULT, hidden: false }, DEFAULT), "?p=a+b");
  assert.equal(shareQuery({ pattern: "a", tests: "", view: DEFAULT, hidden: true }, DEFAULT), "?p=a&h=1");
  assert.deepEqual(roundTrip({ pattern: "x", tests: "", view: DEFAULT }), { pattern: "x", tests: "", view: DEFAULT, hidden: false });
});

test("ignores links without a pattern, and tidies hand-written ones", () => {
  assert.equal(readShared("", VIEWS, DEFAULT), null);
  assert.equal(readShared("?t=abc", VIEWS, DEFAULT), null);
  assert.deepEqual(readShared("?p=a%0Ab&t=x%0D%0Ay&v=bogus&h=yes", VIEWS, DEFAULT), { pattern: "ab", tests: "x\ny", view: DEFAULT, hidden: false });
  assert.deepEqual(readShared("?p=a&v=toString", VIEWS, DEFAULT).view, DEFAULT);
});
