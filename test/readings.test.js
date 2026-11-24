import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Readings, jyutping, kana, pinyin, radicalQuery, readingQuery, romaji, romanize, vietnamese } from "../src/unicode/readings.js";

const readings = new Readings(readFileSync(new URL("../unicode/readings.txt", import.meta.url), "utf8"));
const top = (query, n = 1) => {
  const { lang, terms } = readingQuery(query);
  return readings.search(lang, terms).slice(0, n).map(({ cp }) => String.fromCodePoint(cp)).join("");
};

test("reading queries: known language codes only", () => {
  assert.deepEqual(readingQuery("ja:mizu"), { lang: "ja", terms: ["mizu"] });
  assert.deepEqual(readingQuery(" ZH : shui  huo "), { lang: "zh", terms: ["shui", "huo"] });
  assert.deepEqual(readingQuery("ko:"), { lang: "ko", terms: [] });
  assert.equal(readingQuery("flag: wales"), null);
  assert.equal(readingQuery("water"), null);
});

test("pinyin and Jyutping: tones by mark or number, ü as v", () => {
  assert.deepEqual(pinyin("shuǐ"), ["shui", 3]);
  assert.deepEqual(pinyin("shui3"), ["shui", 3]);
  assert.deepEqual(pinyin("shui"), ["shui", 0]);
  assert.deepEqual(pinyin("de", true), ["de", 5]);
  assert.deepEqual(pinyin("lǜ"), ["lv", 4]);
  assert.deepEqual(pinyin("lu:4"), ["lv", 4]);
  assert.deepEqual(pinyin("lü"), ["lv", 0]);
  assert.deepEqual(jyutping("seoi2"), ["seoi", 2]);
  assert.deepEqual(jyutping("seoi"), ["seoi", 0]);
});

test("kana from romaji or kana", () => {
  assert.equal(kana("mizu"), "みず");
  assert.equal(kana("gakkou"), "がっこう");
  assert.equal(kana("gakkō"), "がっこう");
  assert.equal(kana("shin'ya"), "しんや");
  assert.equal(kana("kanji"), "かんじ");
  assert.equal(kana("chotto"), "ちょっと");
  assert.equal(kana("tsuki"), "つき");
  assert.equal(kana("スイ"), "すい");
  assert.equal(kana("xyz"), null);
});

test("Korean romanization and Vietnamese tones", () => {
  assert.equal(romanize("수"), "su");
  assert.equal(romanize("식"), "sik");
  assert.equal(romanize("일"), "il");
  assert.equal(romanize("영"), "yeong");
  assert.equal(vietnamese("thuỷ").exact, vietnamese("thủy").exact);
  assert.equal(vietnamese("nước").plain, "nuoc");
  assert.equal(vietnamese("đức").plain, "duc");
});

test("searching readings: common characters first", () => {
  assert.equal(top("zh:shui"), "水");
  assert.equal(top("zh:shui4", 2), "睡税");
  assert.equal(top("zh:lv4"), "律");
  assert.equal(top("yue:seoi2"), "水");
  assert.equal(top("ja:mizu"), "水");
  assert.equal(top("ja:みず"), "水");
  assert.equal(top("ja:taberu"), "食");
  assert.equal(top("ko:su"), "水");
  assert.equal(top("ko:수"), "水");
  assert.equal(top("vi:thuy"), "水");
  assert.equal(top("vi:thùy"), "垂");
  // terms in order
  assert.equal(top("zh:huo3 shui3", 1), "火");
  assert.equal(top("ja:xyz"), "");
});

test("ideograph details", () => {
  const water = readings.get(0x6c34);
  assert.deepEqual(water.readings.zh, ["shuǐ"]);
  assert.deepEqual(water.readings.ja, ["スイ", "みず", "かわ"]);
  assert.equal(water.radical, "85.0");
  assert.equal(water.strokes, 4);
  assert.equal(readings.get(0x41), null);
});

test("romaji from kana, spelled as searches take it", () => {
  assert.equal(romaji("スイ"), "sui");
  assert.equal(romaji("みず"), "mizu");
  assert.equal(romaji("がっこう"), "gakkou");
  assert.equal(romaji("ちょっと"), "chotto");
  assert.equal(romaji("しんや"), "shin'ya");
  assert.equal(romaji("ジョウ"), "jou");
  assert.equal(romaji("まっちゃ"), "matcha");
  // every Japanese reading converts back to the same kana
  for (const cp of [0x6c34, 0x98df, 0x5b66, 0x4e00]) {
    for (const r of readings.get(cp).readings.ja) assert.equal(kana(romaji(r)), kana(r), r);
  }
});

test("definitions: whole matches, ignoring a leading to, common characters first", () => {
  const meanings = (q, n = 1) => readings.define(q).slice(0, n).map(({ cp }) => String.fromCodePoint(cp)).join("");
  assert.equal(meanings("water"), "水");
  assert.equal(meanings("fire"), "火");
  assert.equal(meanings("strike"), "打");
  assert.equal(meanings("to strike"), "打");
  assert.equal(meanings("wat"), "");
  assert.equal(readings.get(0x6c34).definition, "water, liquid, lotion, juice");
});

test("radical queries", () => {
  assert.deepEqual(radicalQuery("rs:85"), { radical: "85", extra: null });
  assert.deepEqual(radicalQuery(" RS: 水 + 3 "), { radical: "水", extra: 3 });
  assert.deepEqual(radicalQuery("rs:120'.2"), { radical: "120'", extra: 2 });
  assert.deepEqual(radicalQuery("rs:"), { radical: "", extra: null });
  assert.equal(radicalQuery("ja:mizu"), null);
});

test("radicals: named by number or form, characters by strokes", () => {
  assert.equal(readings.radicals.size, 246);
  assert.equal(readings.radicals.get("85").strokes, 4);
  for (const name of ["85", "水", "氵", "⺡", "⽔"]) assert.equal(readings.radical(name), "85", name);
  assert.equal(readings.radical("120'"), "120'");
  assert.equal(readings.radical("江"), null);
  assert.equal(readings.radical("999"), null);
  assert.deepEqual(readings.radicalOf(0x6c5f), ["85", 3]);
  const chars = (radical, extra) => readings.byRadical(radical, extra).map(({ cp }) => String.fromCodePoint(cp));
  assert.deepEqual(chars("85", 3).slice(0, 3), ["江", "污", "池"]);
  // simplified forms come after the traditional ones, or alone
  const silk = readings.byRadical("120");
  assert.equal(silk[0].radical, "120");
  assert.equal(silk.at(-1).radical, "120'");
  assert.ok(readings.byRadical("120'").every((r) => r.radical === "120'"));
});
