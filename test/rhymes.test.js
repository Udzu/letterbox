import { test } from "node:test";
import assert from "node:assert/strict";

import { COMMON, RARE, Rhymes, lookupKey, parsePronunciations, parseSounds, rhymeParts, letterCount, splitCluster, syllableCount, toIpa } from "../src/rhymes/rhymes.js";

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

test("arranges rhymes by frequency, with phrases apart", () => {
  const r = new Rhymes(parsePronunciations(`
day\tde1\tC\t60
may\tme1\tC\t60
May\tme1\tC\t60
a\te1\tC\t74
a.\te1\tC\t74
A\te1\tC\t15
Bray\tbre1\tC\t25
fray\tfre1\tC\t25
sley\tsle1\tC\t0
one-way\twV1nwe1\tC\t50
far away\tfA1r Vwe1\tW\t40
far-away\tfA1r Vwe1\tP\t40
x-ray\te2ks re1\tC\t45
X ray\te2ks re1\tP\t45
be\tbi1\tC\t68
be\tbe1\tW\t15
`).entries);
  const bands = r.arrange(r.matches(r.pronunciations("day")[0]));
  const show = (items) => items.map((i) => [i.word, ...i.variants].join("/"));
  assert.deepEqual(show(bands.common), ["a/a./A", "may/May"]);
  assert.deepEqual(show(bands.uncommon), ["Bray", "fray"]);
  // a word's rare pronunciation counts as rare, whatever its other pronunciations
  assert.deepEqual(show(bands.rare), ["be", "sley"]);
  // hyphen and space spellings are one item, shown with spaces if otherwise tied
  assert.deepEqual(show(bands.phrases), ["far away/far-away", "one-way", "x-ray/X ray"]);
  assert.ok(COMMON > RARE);
});

test("the cot-caught merger makes ɔ the same as ɑ, except before r", () => {
  const r = new Rhymes(parsePronunciations(`
caught\tkO1t\tC\t49
cot\tkA1t\tC\t32
taught\ttO1t\tC\t40
hot\thA1t\tC\t55
horse\thO1rs\tC\t50
farce\tfA1rs\tC\t30
course\tkO1rs\tC\t55
Gloucester\tglA1stR\tC\t35
Gloucester\tglO1stR\tU\t35
Foster\tfO1stR\tC\t40
coster\tkA1stR\tC\t10
boy\tbQ1\tC\t55
bah\tbA1\tC\t30
`).entries);
  const find = (w, o) => r.find(r.pronunciations(w)[0], o);
  assert.deepEqual(find("caught"), ["taught"]);
  // cot and caught become homophones, so they aren't perfect rhymes
  assert.deepEqual(find("caught", { cotCaught: true }), ["hot", "taught"]);
  assert.deepEqual(find("caught", { cotCaught: true, sameOnset: true }), ["cot", "hot", "taught"]);
  assert.deepEqual(find("hot", { cotCaught: true }), ["caught", "cot", "taught"]);
  assert.deepEqual(find("horse", { cotCaught: true }), ["course"]);
  assert.deepEqual(find("boy", { cotCaught: true }), []);
  assert.deepEqual(r.pronunciationGroups("Gloucester").length, 2);
  assert.deepEqual(r.pronunciationGroups("Gloucester", { cotCaught: true }).map((g) => g.others.length), [1]);
  assert.deepEqual(find("Gloucester", { cotCaught: true }), ["coster", "Foster"]);
  assert.deepEqual(find("Gloucester", { cotCaught: true, looseOnsets: true }), ["coster", "Foster"]);
});

test("groups rhymes by syllables, rare words and then phrases last", () => {
  const r = new Rhymes(parsePronunciations(`
head\thE1d\tC\t55
bed\tbE1d\tC\t50
sked\tskE1d\tC\t10
abed\tVbE1d\tC\t25
instead\tInstE1d\tC\t52
adread\tVdrE1d\tC\t0
co-ed\tko1E1d\tC\t30
sliced bread\tslY1st brE1d\tW\t40
orred\tO1rEd\tC\t30
orred\tO1rVrE1d\tW\t30
`).entries);
  const groups = r.bySyllables(r.matches(r.pronunciations("head")[0]));
  const show = groups.map((g) => `${g.count}: ${g.items.map((i) => i.word).join(" ")}`);
  // orred only counts with its 3-syllable pronunciation, the one that rhymes
  assert.deepEqual(show, ["1: bed sked", "2: abed instead adread co-ed sliced bread", "3: orred"]);
  assert.equal(syllableCount("Y1s kri2m"), 2);
});

test("groups rhymes by letters, ignoring spaces and punctuation", () => {
  assert.equal(letterCount("ice cream"), 8);
  assert.equal(letterCount("co-ed"), 4);
  assert.equal(letterCount("e.g."), 2);
  assert.equal(letterCount("K2"), 2);
  assert.equal(letterCount("café"), 4);
  assert.equal(letterCount("Cæsar"), 6);
  const r = new Rhymes(parsePronunciations(`
head\thE1d\tC\t55
bed\tbE1d\tC\t50
sked\tskE1d\tC\t10
bread\tbrE1d\tC\t50
co-ed\tko1E1d\tC\t30
instead\tInstE1d\tC\t52
`).entries);
  const show = r.byLetters(r.matches(r.pronunciations("head")[0])).map((g) => `${g.count}: ${g.items.map((i) => i.word).join(" ")}`);
  assert.deepEqual(show, ["3: bed", "4: sked co-ed", "5: bread", "7: instead"]);
});

test("parses custom files, with optional sources and frequency, and reports bad lines", () => {
  const { entries } = parsePronunciations("# a comment\n\nhead\thE1d\r\nbed\tbE1d\tC\t12\n");
  assert.deepEqual(entries, [
    { word: "head", pron: "hE1d", sources: "", zipf: COMMON },
    { word: "bed", pron: "bE1d", sources: "C", zipf: 12 },
  ]);
  assert.throws(() => parsePronunciations("head hE1d\n"), /line 1: expected a word and a pronunciation/);
  assert.throws(() => parsePronunciations("head\thEd1\n"), /line 1: "hEd1" isn't a pronunciation/);
  assert.throws(() => parsePronunciations("#\nhead\thE1d\tC\tlots\n"), /line 2: frequency/);
  assert.throws(() => parsePronunciations("# only comments\n"), /no pronunciations/);
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

test("a word typed without accents also finds spellings with them, but not the other way round", () => {
  const r = new Rhymes(parsePronunciations(`
cafe\tkVfe1\tC\t40
cafe\tka1fe\tC\t40
café\tka2fe1\tU\t35
resume\trIzu1m\tC\t45
resume\trE1zVme2\tC\t45
résumé\trE1zVme\tU\t40
naive\tnAi1v\tC\t40
ne\tni1\tC\t40
ne\tne1\tC\t40
Ne\tne1\tC\t15
né\tne1\tW\t20
Brontë\tbrA1nti\tU\t25
day\tde1\tC\t60
fey\tfe1\tC\t20
`).entries);
  const words = (w) => r.pronunciations(w).map((e) => `${e.word} ${e.pron}`);
  assert.deepEqual(words("cafe"), ["cafe kVfe1", "cafe ka1fe", "café ka2fe1"]);
  assert.deepEqual(words("café"), ["café ka2fe1"]);
  assert.deepEqual(words("CAFÉ"), ["café ka2fe1"]);
  assert.deepEqual(words("Bronte"), ["Brontë brA1nti"]);
  // with no spelling with those accents, the one without them
  assert.deepEqual(words("naïve"), ["naive nAi1v"]);
  // however the accents are encoded
  assert.deepEqual(words("café"), ["café ka2fe1"]);
  // résumé is in the same group as resume's pronunciation that rhymes the same way
  const groups = r.pronunciationGroups("resume").map((g) => [g.entry, ...g.others].map((e) => e.word).join(" "));
  assert.deepEqual(groups, ["resume", "resume résumé"]);
  assert.deepEqual(r.pronunciationGroups("résumé").length, 1);
  // a pronunciation shared with a spelling with accents is kept, so the spelling is shown, but not one
  // shared with a spelling that only differs in case
  assert.deepEqual(words("ne"), ["ne ni1", "ne ne1", "né ne1"]);
  // spellings that only differ in accents are one rhyme, and not rhymes of each other
  const items = (w, o) => r.items(r.matches(r.pronunciations(w)[0], o)).map((i) => [i.word, ...i.variants].join("/"));
  assert.deepEqual(items("day"), ["cafe/café", "ne/né/Ne", "fey"]);
  assert.deepEqual(items("café", { sameOnset: true }), ["ne/né/Ne", "day", "fey"]);
});

test("other mergers: Mary-marry-merry, hurry-furry, cure-force, flapping and pin-pen", () => {
  const r = new Rhymes(parsePronunciations(`
carry\tka1ri\tU\t40
merry\tmE1ri\tC\t40
Mary\tme1ri\tC\t40
hurry\thV1ri\tU\t40
furry\tfR1i\tC\t40
poor\tpU1r\tC\t50
door\tdO1r\tC\t50
tour\ttU1r\tC\t50
latter\tla1tR\tC\t40
madder\tma1dR\tC\t40
Aarti\tA1rti2\tC\t20
hardy\thA1rdi\tC\t40
get it\tgE1t It\tC\t40
fed it\tfE1d It\tC\t40
attack\tVta1k\tC\t40
back\tba1k\tC\t50
pen\tpE1n\tC\t50
win\twI1n\tC\t50
`).entries);
  const find = (w, o) => r.find(r.pronunciations(w)[0], o);
  assert.deepEqual(find("carry"), []);
  assert.deepEqual(find("carry", { maryMarryMerry: true }), ["Mary", "merry"]);
  assert.deepEqual(find("hurry", { hurryFurry: true }), ["furry"]);
  assert.deepEqual(find("poor", { cureForce: true }), ["door", "tour"]);
  // flapping: t before a vowel without primary stress (including across a word break), but not attack's
  assert.deepEqual(find("latter", { flapping: true }), ["madder"]);
  assert.deepEqual(find("Aarti", { flapping: true }), ["hardy"]);
  assert.deepEqual(find("get it", { flapping: true }), ["fed it"]);
  assert.deepEqual(find("back", { flapping: true }), ["attack"]);
  assert.deepEqual(find("pen", { pinPen: true }), ["win"]);
  // they work with loose rhymes too, though those leave out the r of hurry and the m of pen
  assert.deepEqual(find("hurry", { hurryFurry: true, looseOnsets: true }), ["furry"]);
  assert.deepEqual(find("pen", { pinPen: true, looseOnsets: true }), ["win"]);
  assert.deepEqual(find("pen", { looseOnsets: true }), []);
});

test("the non-rhotic merger drops r unless a vowel follows", () => {
  const r = new Rhymes(parsePronunciations(`
court\tkO1rt\tC\t50
taught\ttO1t\tC\t50
cot\tkA1t\tC\t50
letter\tlE1tR\tC\t50
Etta\tE1tV\tC\t30
car\tkA1r\tC\t50
spa\tspA1\tC\t40
fire\tfY1r\tC\t50
higher\thY1R\tC\t50
Maya\tmY1V\tC\t40
beer\tbI1r\tC\t50
idea\tYdi1V\tC\t50
bird\tbR1d\tC\t50
heard\thR1d\tC\t50
poor\tpU1r\tC\t50
law\tlO1\tC\t50
warmer\twO1rmR\tC\t40
trauma\ttrO1mV\tC\t40
hurry\thV1ri\tC\t40
cherry\tCE1ri\tC\t40
care of\tkE1r Vv\tC\t30
there of\tDE1 Vv\tC\t30
`).entries);
  const find = (w, o) => r.find(r.pronunciations(w)[0], o);
  const nonRhotic = { nonRhotic: true };
  assert.deepEqual(find("court", nonRhotic), ["taught"]);
  assert.deepEqual(find("court"), []);
  assert.deepEqual(find("letter", nonRhotic), ["Etta"]);
  // car's vowel stays apart from spa's and cot's
  assert.deepEqual(find("car", nonRhotic), []);
  // other vowels end in ə instead
  assert.deepEqual(find("fire", nonRhotic), ["higher", "Maya"]);
  assert.deepEqual(find("beer", nonRhotic), []);
  assert.deepEqual(find("bird", nonRhotic), ["heard"]);
  // r stays before a vowel, even in the next word
  assert.deepEqual(find("hurry", nonRhotic), []);
  assert.deepEqual(find("care of", nonRhotic), []);
  // with the other mergers: poor is pour, so law; but cot-caught leaves the ɔ that was before r
  assert.deepEqual(find("poor", nonRhotic), []);
  assert.deepEqual(find("poor", { ...nonRhotic, cureForce: true }), ["law"]);
  assert.deepEqual(find("warmer", nonRhotic), ["trauma"]);
  assert.deepEqual(find("warmer", { ...nonRhotic, cotCaught: true }), []);
  assert.deepEqual(find("trauma", { ...nonRhotic, looseOnsets: true }), ["warmer"]);
  assert.deepEqual(find("warmer", { ...nonRhotic, looseOnsets: true }), ["trauma"]);
});

test("reads pronunciations typed in IPA or ASCII", () => {
  const sounds = (text) => {
    const { pron, assumed } = parseSounds(text);
    return assumed ? `${pron} (assumed)` : pron;
  };
  assert.equal(sounds("ˈhɛd"), "hE1d");
  assert.equal(sounds("'hEd"), "hE1d");
  // one vowel needs no stress mark; with several, the first is taken as stressed
  assert.equal(sounds("Ed"), "E1d");
  assert.equal(sounds("-Edi"), "E1di (assumed)");
  assert.equal(sounds("@'lON"), "VlO1N");
  assert.equal(sounds("əˈlɔŋ"), "VlO1N");
  assert.equal(sounds("'m^Nki"), "mV1Nki");
  assert.equal(sounds("t͡ʃɪp"), "CI1p");
  assert.equal(sounds("'tSIp"), "CI1p");
  assert.equal(sounds("'mEZ3"), "mE1ZR");
  assert.equal(sounds("'jEs"), sounds("'yEs"));
  assert.equal(sounds(",kat'bOI"), "ka2tbQ1");
  assert.equal(sounds("'hIp 'hAp"), "hI1p hA1p");
  // ər not before a vowel is ɚ, and syllabic consonants get a vowel
  assert.equal(sounds("ˈbʌtər"), "bV1tR");
  assert.equal(sounds("ˈbʌʔn̩"), "bV1tVn");
  // syllable breaks and length marks are ignored
  assert.equal(sounds("ˈhɛ.dːi"), "hE1di");
  assert.throws(() => parseSounds("'hEx"), /Unknown sound “x”/);
  assert.throws(() => parseSounds("st"), /No vowel/);
});

test("finds the words pronounced a given way", () => {
  const r = new Rhymes(parsePronunciations(`
night\tnY1t\tC\t50
knight\tnY1t\tC\t40
Knight\tnY1t\tC\t15
nite\tnY1t\tC\t20
kite\tkY1t\tC\t30
rabbit\tra1bIt\tC\t40
`).entries);
  const words = (pron) => r.items(r.homophones(pron)).map((i) => [i.word, ...i.variants].join("/")).sort();
  assert.deepEqual(words(parseSounds("'naIt").pron), ["knight/Knight", "night", "nite"]);
  // unstressed ɪ and ə are the same
  assert.deepEqual(words(parseSounds("'rab@t").pron), ["rabbit"]);
  assert.deepEqual(words(parseSounds("'blIrfIN").pron), []);
});

test("allowing different onsets after the stress never loses a rhyme", () => {
  const r = new Rhymes(parsePronunciations(`
care of\tkE1r Vv\tP\t56
where've\twE1rVv\tC\t30
eruv\tE1rUv\tU\t20
`).entries);
  const find = (w, o) => r.find(r.pronunciations(w)[0], o);
  // the r ends a syllable in care of (before a word break) but starts one in where've
  assert.deepEqual(find("care of"), ["eruv", "where've"]);
  assert.deepEqual(find("care of", { looseOnsets: true }), ["eruv", "where've"]);
});

test("mosaic rhymes: a stressed word that can come before an unstressed tail", () => {
  const rhymes = new Rhymes(parsePronunciations(`poet\tpo1It\tCU\t42
know\tno1\tCU\t60\tv
show\tSo1\tCU\t58\tnv
no\tno1\tCU\t65
dough\tdo1\tCU\t35\tn
po\tpo1\tC\t30\tv
go\tgo1\tCU\t70\ti
glow\tglo1\tCU\t45\ti
owen\to1In\tCU\t40
boa\tbo1V\tCU\t35
letter\tlE1tR\tCU\t52
get\tgE1t\tCU\t65\tv
pet\tpE1t\tCU\t48\tnv
off-set\tO2fsE1t\tU\t40\tv
battle\tba1tVl\tCU\t50
cat\tka1t\tCU\t50\tnv
sat\tsa1t\tCU\t50\tv
it\tI1t\tCU\t70\tn
her\thR1\tCU\t70\tn
'll\tVl\tW\t47
`).entries);
  const mosaic = (word, options) => [...rhymes.mosaic(rhymes.pronunciations(word)[0], options).keys()].sort();
  // know and show can be verbs that take an object, and go it is an idiom; no, dough (a noun), glow (an
  // intransitive verb) and po (the same onset as poet) can't come before it
  assert.deepEqual(mosaic("poet"), ["go it", "know it", "show it"]);
  // in and a can follow intransitive verbs too
  assert.deepEqual(mosaic("owen"), ["glow in", "go in", "know in", "po in", "show in"]);
  assert.deepEqual(mosaic("boa"), ["glow a", "go a", "know a", "po a", "show a"]);
  assert.deepEqual(mosaic("poet", { sameOnset: true }), ["go it", "know it", "po it", "show it"]);
  // her without its h; not compounds like off-set
  assert.deepEqual(mosaic("letter"), ["get her", "pet her"]);
  // 'll after nouns
  assert.deepEqual(mosaic("battle"), ["cat'll"]);
  assert.deepEqual(rhymes.mosaic(rhymes.pronunciations("letter")[0]).get("get her").zipf, 65);
  // you and it can be subjects after conjunctions and adverbs, which have no parts of speech in the data
  const menu = new Rhymes(parsePronunciations("menu\tmE1nju\tCU\t43\nthen\tDE1n\tCU\t61\nden\tdE1n\tCU\t40\tn\n").entries);
  assert.deepEqual([...menu.mosaic(menu.pronunciations("menu")[0]).keys()], ["then you"]);
  // and after verbs that Wiktionary calls intransitive but can be followed by a clause
  const clause = new Rhymes(parsePronunciations(`lopit\tlo1pIt\tW\t20
hope\tho1p\tCU\t55\ti
cope\tko1p\tCU\t40\ti
subleeit\tsVbli1It\tW\t20
agree\tVgri1\tCU\t50\ti
`).entries);
  const subjects = (word) => [...clause.mosaic(clause.pronunciations(word)[0]).keys()].sort();
  assert.deepEqual(subjects("lopit"), ["hope it"]);
  assert.deepEqual(subjects("subleeit"), ["agree it"]);
});

test("phrases with no pronunciation of their own are built from their words", () => {
  const rhymes = new Rhymes(parsePronunciations(`poet\tpo1It\tCU\t42
know\tno1\tCU\t60\tv
it\tI1t\tCU\t70\tn
cat\tka1t\tCU\t50\tnv
give\tgI1v\tCU\t60\tv
up\tV1p\tCU\t60\tp
the\tDV\tC\t75
the\tDV1\tC\t75
black\tbla1k\tCU\t55
`).entries);
  // function words are unstressed (it as /ɪt/, not /hɪt/-like forms), so know it rhymes with poet
  assert.equal(rhymes.phrasePronunciation("know it").pron, "no1 It");
  assert.deepEqual(rhymes.find(rhymes.phrasePronunciation("know it")), ["poet"]);
  assert.equal(rhymes.phrasePronunciation("cat'll").pron, "ka1t Vl");
  // a final particle takes the stress, and earlier words keep theirs as secondary stress
  assert.equal(rhymes.phrasePronunciation("give up").pron, "gI2v V1p");
  assert.equal(rhymes.phrasePronunciation("the black cat").pron, "DV bla2k ka1t");
  assert.ok(rhymes.phrasePronunciation("know it").built);
  // every word needs a pronunciation, and one word isn't a phrase
  assert.equal(rhymes.phrasePronunciation("know zzyzx"), null);
  assert.equal(rhymes.phrasePronunciation("know"), null);
});

test("parses parts of speech as an optional fifth field", () => {
  const { entries } = parsePronunciations("cat\tka1t\tCU\t50\tnv\nthe\tDV\tC\t75\ngo\tgo1\tCU\t70\ti\n");
  assert.equal(entries[0].pos, "nv");
  assert.equal(entries[1].pos, undefined);
  assert.equal(entries[2].pos, "i");
  assert.throws(() => parsePronunciations("cat\tka1t\tCU\t50\tnoun\n"), /line 1: parts of speech/);
  assert.throws(() => parsePronunciations("cat\tka1t\tCU\t50\tn\tx\n"), /line 1: too many columns/);
});

test("near rhymes: consonants after the stressed vowel may differ within a family", () => {
  const rhymes = new Rhymes(parsePronunciations(`rhyme\trY1m
mine\tmY1n
time\ttY1m
thing\tTI1N
ride\trY1d
lied\tlY1d
bite\tbY1t
like\tlY1k
lice\tlY1s
cap\tka1p
bat\tba1t
bad\tba1d
happy\tha1pi
tabby\tta1bi
daddy\tda1di
owen\to1In
know\tno1\tCU\t60\tv
`).entries);
  const find = (word, options) => rhymes.find(rhymes.pronunciations(word)[0], options);
  assert.deepEqual(find("rhyme"), ["time"]);
  // nasals, but not other consonants, and still not the same onset
  assert.deepEqual(find("rhyme", { type: "near" }), ["mine", "time"]);
  // voiceless stops, not voiced ones or fricatives
  assert.deepEqual(find("bite", { type: "near" }), ["like"]);
  assert.deepEqual(find("cap", { type: "near" }), ["bat"]);
  // including the consonants that start later syllables (happy and tabby, but not daddy)
  assert.deepEqual(find("tabby", { type: "near" }), ["daddy"]);
  assert.deepEqual(find("happy", { type: "near" }), []);
  // with flapping, t is d, so a voiced stop
  assert.deepEqual(find("bite", { type: "near", flapping: true }), ["like"]);
  // mosaic rhymes too: know 'em for owen
  const mosaic = (word, options) => [...rhymes.mosaic(rhymes.pronunciations(word)[0], options).keys()].sort();
  assert.deepEqual(mosaic("owen"), ["know in"]);
  assert.deepEqual(mosaic("owen", { type: "near" }), ["know 'em", "know in"]);
});

test("additive rhymes: one may have an extra s, z, t, d, m, n or ŋ next to a consonant or at the end", () => {
  const rhymes = new Rhymes(parsePronunciations(`glance\tgla1ns
pants\tpa1nts
plan\tpla1n
bee\tbi1
team\tti1m
seat\tsi1t
leaf\tli1f
coal\tko1l
bold\tbo1ld
poet\tpo1It
going\tgo1IN
showed it\tSo1d It
`).entries);
  const find = (word, options) => rhymes.find(rhymes.pronunciations(word)[0], options);
  assert.deepEqual(find("glance"), []);
  // an extra t inside a cluster, or s at the end
  assert.deepEqual(find("glance", { type: "additive" }), ["pants", "plan"]);
  // an extra m or t at the end, but not f
  assert.deepEqual(find("bee", { type: "additive" }), ["seat", "team"]);
  assert.deepEqual(find("coal", { type: "additive" }), ["bold"]);
  // not a consonant between vowels, which would start a syllable
  assert.deepEqual(find("poet", { type: "additive" }), []);
});

test("same consonants: the same consonants between the vowels, whatever the vowels and stress", () => {
  const rhymes = new Rhymes(parsePronunciations(`abet\tVbE1t
Abbott\ta1bVt
obit\to1bIt
I bet\tY1 bE1t
rabbit\tra1bIt
bet\tbE1t
boot\tbu1t
betty\tbE1ti
let\tlE1t
cart\tkA1rt
court\tkO1rt
carrot\tkE1rVt
cut\tkV1t
caught\tkO1t
bird\tbR1d
bored\tbO1rd
bud\tbV1d
metal\tmE1tVl
model\tmA1dVl
`).entries);
  const find = (word, options = {}) => rhymes.find(rhymes.pronunciations(word)[0], { type: "consonants", ...options });
  assert.deepEqual(find("abet"), ["Abbott", "I bet", "obit"]);
  assert.deepEqual(find("bet"), ["boot"]);
  assert.deepEqual(find("cart"), ["court"]);
  // ɝ is a vowel and r
  assert.deepEqual(find("bird"), ["bored"]);
  // mergers still apply: flapping makes metal match model, and r-dropping makes court match cut (and caught a homophone)
  assert.deepEqual(find("metal"), []);
  assert.deepEqual(find("metal", { flapping: true }), ["model"]);
  assert.deepEqual(find("court", { nonRhotic: true }), ["cut"]);
  // no mosaic rhymes
  assert.deepEqual([...rhymes.mosaic(rhymes.pronunciations("abet")[0], { type: "consonants" }).keys()], []);
});

test("same vowels: the same vowels in order, with the same primary stress, whatever the consonants", () => {
  const rhymes = new Rhymes(parsePronunciations(`abet\tVbE1t
a pet\tV pE1t
Annette\tVnE1t
upset\tV2psE1t
Abbott\ta1bVt
bet\tbE1t
beer bread\tbI2r brE1d
caught\tkO1t
pod\tpA1d
pen\tpE1n
tin\ttI1n
`).entries);
  const find = (word, options = {}) => rhymes.find(rhymes.pronunciations(word)[0], { type: "vowels", ...options });
  // not Abbott (different vowels), bet (fewer) or beer bread (ɪ with secondary stress isn't ə)
  assert.deepEqual(find("abet"), ["a pet", "Annette", "upset"]);
  // mergers still apply
  assert.deepEqual(find("caught"), []);
  assert.deepEqual(find("caught", { cotCaught: true }), ["pod"]);
  assert.deepEqual(find("pen", { pinPen: true }), ["tin"]);
});
