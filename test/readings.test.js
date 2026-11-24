import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { Readings, jyutping, kana, pinyin, readingQuery, romanize, vietnamese } from "../src/unicode/readings.js";

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
