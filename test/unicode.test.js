import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { TONES, Unicode, displayName, normalize, withTone, withTones } from "../src/unicode/unicode.js";

const unicode = new Unicode(readFileSync(new URL("../unicode/characters.txt", import.meta.url), "utf8"));
const text = (cps) => String.fromCodePoint(...cps);
const top = (query, n = 1) => unicode.search(query).slice(0, n).map(({ entry }) => text(entry.cps));

test("names: listed, made from codepoints, numbered, Hangul, unnamed", () => {
  assert.equal(unicode.info(0x41).name, "LATIN CAPITAL LETTER A");
  assert.equal(unicode.info(0x4e00).name, "CJK UNIFIED IDEOGRAPH-4E00");
  assert.equal(unicode.info(0x3d000).name, "SMALL SEAL CHARACTER-3D000");
  assert.equal(unicode.info(0x18800).name, "TANGUT COMPONENT-001");
  assert.equal(unicode.info(0x18d80).name, "TANGUT COMPONENT-769");
  assert.equal(unicode.info(0x191a0).name, "JURCHEN RADICAL-01");
  assert.equal(unicode.info(0xac00).name, "HANGUL SYLLABLE GA");
  assert.equal(unicode.info(0xd7a3).name, "HANGUL SYLLABLE HIH");
  assert.equal(unicode.info(0xe000).name, "");
  assert.equal(unicode.info(0xe000).gc, "Co");
  assert.ok(unicode.info(0x378).unassigned);
});

test("codepoint-named blocks are left out of searches, Hangul isn't", () => {
  assert.ok(unicode.info(0x4e00).omit);
  assert.ok(!unicode.info(0xac00).omit);
  assert.ok(!unicode.entries.some((e) => e.cps[0] === 0x4e00));
  assert.deepEqual(top("hangul syllable ga"), ["가"]);
  // but they can still be looked up
  assert.deepEqual(top("U+4E00"), ["一"]);
  assert.deepEqual(top("一"), ["一"]);
});

test("properties", () => {
  const [{ entry }] = unicode.search("U+00E9");
  assert.equal(entry.script, "Latn");
  assert.equal(entry.block, "Latin-1 Supplement");
  assert.equal(entry.age, "1.1");
  assert.equal(entry.gc, "Ll");
});

test("search ranks whole words, names and short names first", () => {
  assert.deepEqual(top("latin a acute", 2), ["Á", "á"]);
  assert.deepEqual(top("no break", 1), [" "]);
  assert.equal(normalize("Flag: Wales"), "flag wales");
  assert.equal(top("flag wales")[0], "🏴󠁧󠁢󠁷󠁬󠁳󠁿");
});

test("matches by alias or emoji name say what they matched", () => {
  const [nbsp] = unicode.search("nbsp");
  assert.equal(text(nbsp.entry.cps), " ");
  assert.deepEqual([nbsp.label.text, nbsp.label.type], ["NBSP", "abbreviation"]);
  const [thumbs] = unicode.search("thumbs up");
  assert.equal(displayName(thumbs.entry), "THUMBS UP SIGN");
  assert.equal(thumbs.label.text, "thumbs up");
  // controls are shown by their alias
  assert.equal(displayName(unicode.search("U+0000")[0].entry), "NULL");
});

test("emoji and named sequences are entries", () => {
  assert.equal(displayName(unicode.find([0x31, 0xfe0f, 0x20e3])), "KEYCAP DIGIT ONE");
  assert.equal(unicode.find([0x31, 0x20e3]).emoji.name, "keycap: 1");
  assert.equal(displayName(unicode.find([0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f466])), "family: man, woman, boy");
  // single-character emoji keep their Unicode name and copy with FE0F
  assert.deepEqual(unicode.find([0xa9]).cps, [0xa9, 0xfe0f]);
});

test("skin tones", () => {
  const thumbs = unicode.find([0x1f44d]);
  assert.equal(text(withTone(thumbs, TONES[2])), "👍🏽");
  assert.equal(text(withTone(thumbs, 0)), "👍");
  const handshake = unicode.find([0x1f91d]);
  assert.equal(text(withTones(handshake, [TONES[1], TONES[1]])), "🤝🏼");
  assert.equal(text(withTones(handshake, [TONES[0], TONES[4]])), "🫱🏻‍🫲🏿");
  // no tones: unchanged
  assert.equal(text(withTone(unicode.find([0x1f600]), TONES[0])), "😀");
});

test("pasted text is split into graphemes", () => {
  assert.deepEqual(top("é👍🏽x́", 5), ["é", "👍🏽", "x", "́"]);
  assert.deepEqual(top("👨‍👩‍👦a👨‍👩‍👦", 5), ["👨‍👩‍👦", "a"]);
  assert.deepEqual(top("🫱🏻‍🫲🏿"), ["🫱🏻‍🫲🏿"]);
});
