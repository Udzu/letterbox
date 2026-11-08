import { test } from "node:test";
import assert from "node:assert/strict";

import { Rhymes, lookupKey, parsePronunciations, rhymeParts, toIpa } from "../src/rhymes/rhymes.js";

const DATA = `# name: Pronunciations
# attribution: From [somewhere](https://example.com).

head\thE1d\tCU\t50
behead\tbIhE1d\tC\t20
ahead\tVhE1d\tC\t50
bread\tbrE1d\tCU\t48
red\trE1d\tC\t52
read\trE1d\tC\t55
read\tri1d\tCU\t55
Ed\tE1d\tW\t30
said\tsE1d\tC\t60
rabbit\tra1bIt\tC\t40
habit\tha1bVt\tC\t40
cabinet\tka1bVnVt\tC\t40
ice cream\tY1s kri2m\tW\t45
Polish\tpo1lIS\tC\t43
polish\tpA1lIS\tC\t43
orange\tO1rVnJ\tCU\t46
Orange\tO1rVnJ\tC\t46
the\tDV\tC\t77
`;

const { attribution, entries } = parsePronunciations(DATA);
const rhymes = new Rhymes(entries);
const entry = (word, pron) => entries.find((e) => e.word === word && (!pron || e.pron === pron));

test("parses the header and entries", () => {
  assert.equal(attribution, "From [somewhere](https://example.com).");
  assert.equal(entries.length, 18);
  assert.deepEqual(entries[0], { word: "head", pron: "hE1d", sources: "CU", zipf: 50 });
});

test("shows pronunciations in IPA, stress marks before the syllable", () => {
  assert.equal(toIpa("hV1mbV2g"), "ˈhʌmˌbʌɡ");
  assert.equal(toIpa("dI1kSVnE2ri"), "ˈdɪkʃəˌnɛɹi");
  assert.equal(toIpa("IntrE1st"), "ɪnˈtɹɛst");
  assert.equal(toIpa("bR1dR"), "ˈbɝdɚ");
  assert.equal(toIpa("Y1s kri2m"), "ˈaɪs ˌkɹim");
  assert.equal(toIpa("sI1Nr"), "ˈsɪŋɹ");
});

test("finds the rhyme and onset", () => {
  assert.deepEqual(rhymeParts("bIhE1d"), { rhyme: "Ed", onset: "h", ipa: "ˈɛd" });
  assert.deepEqual(rhymeParts("brE1d"), { rhyme: "Ed", onset: "br", ipa: "ˈɛd" });
  assert.equal(rhymeParts("E1d").onset, "");
  // unstressed ɪ and ə are the same, and secondary stress is ignored
  assert.equal(rhymeParts("ra1bIt").rhyme, rhymeParts("ha1bVt").rhyme);
  assert.equal(rhymeParts("hV1mbV2g").rhyme, rhymeParts("hV1mbVg").rhyme);
  // phrases rhyme across word breaks, and the onset stays within the word
  assert.deepEqual(rhymeParts("Y1s kri2m"), { rhyme: "Yskrim", onset: "", ipa: "ˈaɪs ˌkɹim" });
  // with no primary stress, the last vowel
  assert.equal(rhymeParts("DV").rhyme, "V");
});

test("perfect rhymes have a different onset", () => {
  assert.deepEqual(rhymes.perfect(entry("head")), ["bread", "Ed", "read", "red", "said"]);
  assert.deepEqual(rhymes.perfect(entry("bread")), ["ahead", "behead", "Ed", "head", "read", "red", "said"]);
  assert.deepEqual(rhymes.perfect(entry("rabbit")), ["habit"]);
  assert.deepEqual(rhymes.perfect(entry("read", "ri1d")), []);
});

test("looks words up regardless of case and apostrophes", () => {
  assert.equal(lookupKey("  Rock’n  Roll "), "rock'n roll");
  assert.deepEqual(rhymes.pronunciations("Polish").map((e) => e.word), ["Polish", "polish"]);
  assert.deepEqual(rhymes.pronunciations("polish").map((e) => e.word), ["polish", "Polish"]);
  assert.deepEqual(rhymes.pronunciations("read").map((e) => e.pron), ["ri1d", "rE1d"]);
  assert.deepEqual(rhymes.pronunciations("xyzzy"), []);
  // a pronunciation shared by two spellings is only given once, for the one typed
  assert.deepEqual(rhymes.pronunciations("Orange").map((e) => e.word), ["Orange"]);
  assert.deepEqual(rhymes.pronunciations("orange").map((e) => e.word), ["orange"]);
});
