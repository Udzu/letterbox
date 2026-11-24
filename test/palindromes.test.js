import { test } from "node:test";
import assert from "node:assert/strict";
import { entryInfo, extend, extensions, fragment } from "../src/palindromes/ends.js";

const infos = (list) => list.map(entryInfo).filter((i) => i !== null);
const entries = (list, letters, at) => extensions(infos(list), letters, at).map((e) => e.entry);

test("an end is open while the text there is a letter", () => {
  assert.deepEqual(fragment("a man a pl", "start"), { text: "a", letters: "a" });
  assert.deepEqual(fragment("a man a pl", "end"), { text: "pl", letters: "pl" });
  assert.deepEqual(fragment("Al Panama!", "start"), { text: "Al", letters: "al" });
  assert.equal(fragment("al Panama!", "end"), null);
  assert.equal(fragment("plan ", "end"), null);
  assert.equal(fragment("", "start"), null);
  assert.deepEqual(fragment("o'cl", "end"), { text: "o'cl", letters: "ocl" });
  assert.deepEqual(fragment("Panama!", "start"), { text: "Panama", letters: "panama" });
  assert.deepEqual(fragment("a well-kn", "end"), { text: "well-kn", letters: "wellkn" });
  assert.deepEqual(fragment("'tis", "end"), { text: "tis", letters: "tis" });
});

test("extensions end with the letters at a start and begin with them at an end", () => {
  const list = ["a", "ma", "bra", "play", "plan", "play test", "pl", "canal", "al", "Ma"];
  assert.deepEqual(entries(list, "a", "start"), ["ma", "bra", "Ma"]);
  assert.deepEqual(entries(list, "pl", "end"), ["play", "plan", "play test"]);
  assert.deepEqual(entries(list, "al", "start"), ["canal"]);
});

test("an extension is split into the added and matched text, with the mirror reversed", () => {
  const [play] = extensions(infos(["play test"]), "pl", "end");
  assert.deepEqual(play, { entry: "play test", matched: "pl", added: "ay test", mirror: "tsetya" });
  const [canal] = extensions(infos(["Canal"]), "al", "start");
  assert.deepEqual(canal, { entry: "Canal", added: "Can", matched: "al", mirror: "nac" });
  const [clock] = extensions(infos(["o'clock"]), "o", "end");
  assert.equal(clock.added, "'clock");
});

test("choosing an extension updates both boxes", () => {
  const pick = (entry, letters, at) => extensions(infos([entry]), letters, at)[0];
  assert.deepEqual(extend("a man a pl", "al Panama!", 0, pick("ma", "a", "start")), { left: "ma man a pl", right: "al Panama! m" });
  assert.deepEqual(extend("a man a pl", "al Panama!", 1, pick("play", "pl", "end")), { left: "a man a play", right: "yaal Panama!" });
  assert.deepEqual(extend("a man a pl", "al Panama!", 2, pick("canal", "al", "start")), { left: "a man a plnac", right: "canal Panama!" });
  assert.deepEqual(extend("a man ", "x", 3, pick("xy", "x", "end")), { left: "ya man ", right: "xy" });
  assert.deepEqual(extend("“a man", "", 3, { added: "b", mirror: "b" }), { left: "b “a man", right: "b" });
});
