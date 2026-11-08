import { test } from "node:test";
import assert from "node:assert/strict";

import { Rhymes, lookupKey, parsePronunciations, rhymeParts, splitCluster, toIpa } from "../src/rhymes/rhymes.js";

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
hip-hop\thI1phAp\tU\t41
flip-flop\tflI1pflA2p\tU\t35
kick-shop\tkI1kSAp\tU\t0
hip hop\thI1p hA2p\tW\t40
happy\tha1pi\tCU\t54
daddy\tda1di\tCU\t44
Orange\tO1rVnJ\tC\t46
orange\tO1rInJ\tE\t46
orange\tA1rVnJ\tU\t46
Orange\tA1rInJ\tU\t46
orange\tO1rnJ\tU\t46
the\tDV\tC\t77
silver\tsI1lvR\tCUE\t48
quicksilver\tkwI1ksI1lvR\tC\t29
gilver\tgI1lvR\tC\t0
tsunami\ttsunA1mi\tC\t40
salami\tsVlA1mi\tC\t40
`;

const { attribution, entries } = parsePronunciations(DATA);
const rhymes = new Rhymes(entries);
const entry = (word, pron) => entries.find((e) => e.word === word && (!pron || e.pron === pron));

test("parses the header and entries", () => {
  assert.equal(attribution, "From [somewhere](https://example.com).");
  assert.equal(entries.length, 33);
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
  assert.deepEqual(rhymeParts("bIhE1d"), { rhyme: "Ed", loose: "Ed", onset: "h", ipa: "ˈɛd" });
  assert.deepEqual(rhymeParts("brE1d"), { rhyme: "Ed", loose: "Ed", onset: "br", ipa: "ˈɛd" });
  assert.equal(rhymeParts("E1d").onset, "");
  // unstressed ɪ and ə are the same, and secondary stress is ignored
  assert.equal(rhymeParts("ra1bIt").rhyme, rhymeParts("ha1bVt").rhyme);
  assert.equal(rhymeParts("hV1mbV2g").rhyme, rhymeParts("hV1mbVg").rhyme);
  // phrases rhyme across word breaks, and the onset stays within the word
  assert.deepEqual(rhymeParts("Y1s kri2m"), { rhyme: "Yskrim", loose: "Ysim", onset: "", ipa: "ˈaɪs ˌkɹim" });
  // with no primary stress, the last vowel
  assert.equal(rhymeParts("DV").rhyme, "V");
});

test("the onset is the consonants that start the syllable", () => {
  assert.equal(rhymeParts("kwI1ksI1lvR").onset, "s");
  assert.equal(rhymeParts("IntrE1st").onset, "tr");
  assert.equal(rhymeParts("tsunA1mi").onset, "n");
  assert.equal(rhymeParts("tsu1").onset, "ts");
  assert.equal(rhymeParts("Y1s kri2m").onset, "");
  assert.deepEqual(rhymes.find(entry("silver")), ["gilver"]);
  assert.deepEqual(rhymes.find(entry("silver"), { sameOnset: true }), ["gilver", "quicksilver"]);
});

test("perfect rhymes have a different onset", () => {
  assert.deepEqual(rhymes.find(entry("head")), ["bread", "Ed", "read", "red", "said"]);
  assert.deepEqual(rhymes.find(entry("bread")), ["ahead", "behead", "Ed", "head", "read", "red", "said"]);
  assert.deepEqual(rhymes.find(entry("rabbit")), ["habit"]);
  assert.deepEqual(rhymes.find(entry("read", "ri1d")), []);
});

test("splits consonants between syllables", () => {
  assert.deepEqual(splitCluster("ph"), ["p", "h"]);
  assert.deepEqual(splitCluster("pfl"), ["p", "fl"]);
  assert.deepEqual(splitCluster("p"), ["", "p"]);
  assert.deepEqual(splitCluster("ntr"), ["n", "tr"]);
  assert.deepEqual(splitCluster("Ng"), ["N", "g"]);
  assert.deepEqual(splitCluster("s kr"), ["s", "kr"]);
  assert.deepEqual(splitCluster(""), ["", ""]);
});

test("loose rhymes leave out the onsets after the stressed syllable", () => {
  assert.equal(rhymeParts("hI1phAp").loose, "IpAp");
  assert.equal(rhymeParts("flI1pflA2p").loose, "IpAp");
  assert.equal(rhymeParts("ha1pi").loose, "ai");
  assert.equal(rhymeParts("hE1d").loose, "Ed");
});

test("options allow the same onset, and different onsets after the stress", () => {
  assert.deepEqual(rhymes.find(entry("head"), { sameOnset: true }), ["ahead", "behead", "bread", "Ed", "read", "red", "said"]);
  assert.deepEqual(rhymes.find(entry("read", "rE1d"), { sameOnset: true }), ["ahead", "behead", "bread", "Ed", "head", "red", "said"]);
  assert.deepEqual(rhymes.find(entry("hip-hop")), []);
  assert.deepEqual(rhymes.find(entry("hip-hop"), { looseOnsets: true }), ["flip-flop"]);
  assert.deepEqual(rhymes.find(entry("hip-hop"), { looseOnsets: true, sameOnset: true }), ["flip-flop", "hip hop"]);
  assert.deepEqual(rhymes.find(entry("happy"), { looseOnsets: true }), ["daddy"]);
});

test("looks words up regardless of case and apostrophes", () => {
  assert.equal(lookupKey("  Rock’n  Roll "), "rock'n roll");
  assert.deepEqual(rhymes.pronunciations("Polish").map((e) => e.word), ["Polish", "polish"]);
  assert.deepEqual(rhymes.pronunciations("polish").map((e) => e.word), ["polish", "Polish"]);
  assert.deepEqual(rhymes.pronunciations("read").map((e) => e.pron), ["ri1d", "rE1d"]);
  assert.deepEqual(rhymes.pronunciations("xyzzy"), []);
  // a pronunciation shared by two spellings is only given once, for the one typed
  assert.deepEqual(rhymes.pronunciations("Orange").map((e) => e.word + " " + e.pron), ["Orange O1rVnJ", "Orange A1rInJ", "orange O1rInJ", "orange A1rVnJ", "orange O1rnJ"]);
  assert.deepEqual(rhymes.pronunciations("orange").map((e) => e.pron), ["O1rVnJ", "O1rInJ", "A1rVnJ", "O1rnJ", "A1rInJ"]);
});

test("groups pronunciations that have the same rhymes", () => {
  const groups = rhymes.pronunciationGroups("orange").map((g) => [g.entry.pron, ...g.others.map((e) => e.pron)]);
  assert.deepEqual(groups, [["O1rVnJ", "O1rInJ"], ["A1rVnJ", "A1rInJ"], ["O1rnJ"]]);
  assert.deepEqual(rhymes.pronunciationGroups("polish").map((g) => g.others.length), [0, 0]);
});
