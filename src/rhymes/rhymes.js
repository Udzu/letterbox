// Pronunciations and rhymes for the Rhymes page.
//
// rhymes/pronunciations.txt (built by scripts/rhymes-data.py) has a header of "# key: value" lines,
// then one line per pronunciation: word, pronunciation, sources and frequency, separated by tabs. A
// pronunciation has one character per phoneme (see IPA), with a stress digit after a vowel when
// it's stressed (1 primary, 2 secondary), and a space between the words of a phrase.

// each phoneme's code and IPA (ʌ/ə and ɝ/ɚ are the same phonemes, told apart by stress)
const IPA = {
  A: "ɑ", a: "æ", V: "ʌ", O: "ɔ", W: "aʊ", Y: "aɪ", E: "ɛ", R: "ɝ", e: "eɪ", I: "ɪ", i: "i", o: "oʊ", Q: "ɔɪ", U: "ʊ", u: "u",
  b: "b", C: "tʃ", d: "d", D: "ð", f: "f", g: "ɡ", h: "h", J: "dʒ", k: "k", l: "l", m: "m", n: "n", N: "ŋ", p: "p", r: "ɹ",
  s: "s", S: "ʃ", t: "t", T: "θ", v: "v", w: "w", j: "j", z: "z", Z: "ʒ",
};
const UNSTRESSED = { V: "ə", R: "ɚ" };
export const VOWELS = new Set("AaVOWYEReIioQUu");

// consonant clusters that can start an English syllable, for placing stress marks in IPA
const ONSETS = new Set([
  "pl", "bl", "kl", "gl", "fl", "sl", "pr", "br", "tr", "dr", "kr", "gr", "fr", "Tr", "Sr", "sp", "st", "sk", "sm",
  "sn", "sw", "sf", "tw", "dw", "kw", "gw", "Tw", "spl", "spr", "str", "skr", "skw", "skl",
  ...[..."pbtdkgfvTszmnhl"].map((c) => c + "j"), "spj", "skj",
]);

// a pronunciation as a list of phonemes: { p, stress } for vowels (stress 0, 1 or 2), { p } for
// consonants, and { p: " " } between words
export function phonemes(pron) {
  const out = [];
  for (const c of pron) {
    if (c === "1" || c === "2") out[out.length - 1].stress = Number(c);
    else out.push(VOWELS.has(c) ? { p: c, stress: 0 } : { p: c });
  }
  return out;
}

// the pronunciation in IPA, with stress marks before the stressed syllables
export function toIpa(pron) {
  const ps = phonemes(pron);
  const marks = new Map(); // phoneme index -> stress mark before it
  ps.forEach((x, i) => {
    if (!x.stress) return;
    let start = i;
    while (start > 0 && !VOWELS.has(ps[start - 1].p) && ps[start - 1].p !== " ") start--;
    // the longest cluster before the vowel that can start a syllable
    let onset = start;
    while (onset < i && i - onset > 1 && !ONSETS.has(ps.slice(onset, i).map((y) => y.p).join(""))) onset++;
    if (onset < i && ps[onset].p === "N") onset++;
    marks.set(onset, x.stress === 1 ? "ˈ" : "ˌ");
  });
  return ps.map((x, i) => (marks.get(i) ?? "") + (x.p === " " ? " " : !x.stress && UNSTRESSED[x.p] ? UNSTRESSED[x.p] : IPA[x.p])).join("");
}

// The consonants between two vowels, split into the end of one syllable and the start of the next:
// at a word break if there is one, and otherwise with as many consonants as can start a syllable
// going to the next one (so hip-hop's p.h, and happy's .p).
export function splitCluster(cluster) {
  const space = cluster.lastIndexOf(" ");
  if (space >= 0) return [cluster.slice(0, space).replaceAll(" ", ""), cluster.slice(space + 1)];
  let k = 0;
  while (k < cluster.length - 1 && !ONSETS.has(cluster.slice(k))) k++;
  if (cluster.slice(k) === "N") k++;
  return [cluster.slice(0, k), cluster.slice(k)];
}

// The parts of a pronunciation that matter for rhyming:
// - rhyme: the last primary-stressed vowel and everything after it (or from the last vowel if
//   nothing has primary stress), ignoring word breaks, differences between unstressed ɪ, ʊ and ə,
//   and between secondary stress and none
// - loose: the rhyme without the consonants that start the syllables after the stressed one
// - onset: the consonants just before the rhyme that start its syllable (so s in quicksilver, as in
//   silver, but br in bread), or all of them at the start of a word
// - ipa: the rhyme in IPA
export function rhymeParts(pron) {
  const ps = phonemes(pron);
  let start = ps.findLastIndex((x) => x.stress === 1);
  if (start < 0) start = ps.findLastIndex((x) => VOWELS.has(x.p));
  let cluster = "";
  let i = start - 1;
  for (; i >= 0 && !VOWELS.has(ps[i].p) && ps[i].p !== " "; i--) cluster = ps[i].p + cluster;
  const onset = i < 0 || ps[i].p === " " ? cluster : splitCluster(cluster)[1];
  const tail = ps.slice(start);
  const vowel = (x, i) => (i > 0 && x.stress === 0 && "IUV".includes(x.p) ? "V" : x.p);
  const rhyme = tail.filter((x) => x.p !== " ").map(vowel).join("");
  let loose = "";
  let between = "";
  tail.forEach((x, k) => {
    if (!VOWELS.has(x.p)) {
      between += x.p;
      return;
    }
    loose += splitCluster(between)[0] + vowel(x, k);
    between = "";
  });
  loose += between.replaceAll(" ", "");
  return { rhyme, loose, onset, ipa: toIpa(tail.map((x) => x.p + (x.stress || "")).join("")) };
}

// The pronunciation file's attribution and entries ({ word, pron, sources, zipf }).
export function parsePronunciations(text) {
  const entries = [];
  let attribution = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) {
      const match = /^# attribution: (.*)$/.exec(line);
      if (match) attribution = match[1];
      continue;
    }
    if (!line) continue;
    const [word, pron, sources, zipf] = line.split("\t");
    entries.push({ word, pron, sources, zipf: Number(zipf) });
  }
  return { attribution, entries };
}

// a word as looked up: case and the kind of apostrophe don't matter
export const lookupKey = (word) => word.trim().replace(/\s+/g, " ").replace(/[‘’ʼ]/g, "'").toLowerCase();

// Zipf frequencies (× 10) at or above which a word counts as common, and below which it's rare
export const COMMON = 30;
export const RARE = 20;

// Sound mergers that some speakers have, each as a function on rhymes (strings of phoneme codes,
// without stress digits) that makes the merged sounds the same:
// - cotCaught: ɔ is the same as ɑ (caught and cot), except before r (horse isn't hearse or hard)
export const MERGERS = {
  cotCaught: (key) => key.replace(/O(?!r)/g, "A"),
};

// a rhyme with the given mergers applied ({ cotCaught: true, ... })
export function merge(key, mergers = {}) {
  return Object.entries(MERGERS).reduce((k, [name, f]) => (mergers[name] ? f(k) : k), key);
}
const ALL_MERGERS = Object.fromEntries(Object.keys(MERGERS).map((name) => [name, true]));

// A rhyming dictionary over a list of entries.
export class Rhymes {
  constructor(entries) {
    this.entries = entries;
    this.byWord = new Map(); // lookup key -> entries
    // rhymes and loose rhymes with every merger applied -> [{ entry, rhyme, loose, onset }], from which
    // find picks the ones that match with the mergers chosen
    this.byRhyme = new Map();
    this.byLoose = new Map();
    const add = (map, key, value) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };
    for (const entry of entries) {
      add(this.byWord, lookupKey(entry.word), entry);
      const { rhyme, loose, onset } = rhymeParts(entry.pron);
      const item = { entry, rhyme, loose, onset };
      add(this.byRhyme, merge(rhyme, ALL_MERGERS), item);
      add(this.byLoose, merge(loose, ALL_MERGERS), item);
    }
  }

  // A word's pronunciations, best first: those written the way it was typed, then the ones with the
  // most sources. A pronunciation shared by several spellings (orange, Orange) is only given once.
  pronunciations(word) {
    const typed = word.trim();
    const found = this.byWord.get(lookupKey(word)) ?? [];
    const sorted = [...found].sort((a, b) => (b.word === typed) - (a.word === typed) || b.sources.length - a.sources.length);
    const seen = new Set();
    return sorted.filter((entry) => !seen.has(entry.pron) && seen.add(entry.pron));
  }

  // A word's pronunciations (as given by pronunciations), grouped when they have the same rhymes
  // (with the mergers chosen, as for find): [{ entry, others }], where entry is the first in its group
  // and others are the rest.
  pronunciationGroups(word, options = {}) {
    const groups = new Map();
    for (const entry of this.pronunciations(word)) {
      const { rhyme, onset } = rhymeParts(entry.pron);
      const key = `${onset}|${merge(rhyme, options)}`;
      if (groups.has(key)) groups.get(key).others.push(entry);
      else groups.set(key, { entry, others: [] });
    }
    return [...groups.values()];
  }

  // The rhymes for an entry's pronunciation, alphabetically: other words with the same rhyme. By
  // default these are perfect rhymes, with a different onset (so not head and behead, or homophones)
  // and the same consonants throughout the rhyme. Options:
  // - sameOnset: allow the same onset too
  // - looseOnsets: allow different consonants at the start of the syllables after the stressed one
  //   (so hip-hop and flip-flop)
  // - any of the MERGERS, such as cotCaught: treat those sounds as the same
  find(entry, options = {}) {
    return [...this.matches(entry, options).keys()].sort(compareWords);
  }

  // The rhymes as for find, as a map from each word to the highest Zipf frequency (× 10) of its
  // pronunciations that rhyme (so a word's rare pronunciations don't count as common).
  matches(entry, options = {}) {
    const { sameOnset = false, looseOnsets = false } = options;
    const parts = rhymeParts(entry.pron);
    const field = looseOnsets ? "loose" : "rhyme";
    const target = merge(parts[field], options);
    const candidates = (looseOnsets ? this.byLoose : this.byRhyme).get(merge(parts[field], ALL_MERGERS));
    const self = lookupKey(entry.word);
    const words = new Map();
    for (const other of candidates ?? []) {
      if (merge(other[field], options) !== target) continue;
      const { word, zipf } = other.entry;
      if ((sameOnset || other.onset !== parts.onset) && lookupKey(word) !== self) words.set(word, Math.max(words.get(word) ?? 0, zipf));
    }
    return words;
  }

  // Rhymes (as given by matches) grouped for display. Words that only differ in case or full stops (may, May; a, a.) are
  // merged into one item, { word, variants, zipf }, shown as its most frequent spelling (lowercase if
  // tied). Items are split into common, uncommon and rare words, by frequency, and phrases (including
  // hyphenated words, whose frequencies wordfreq can only estimate), each alphabetical.
  arrange(matches) {
    const merged = new Map();
    for (const word of matches.keys()) {
      const key = word.toLowerCase().replaceAll(".", "");
      if (!merged.has(key)) merged.set(key, []);
      merged.get(key).push(word);
    }
    const bands = { common: [], uncommon: [], rare: [], phrases: [] };
    for (const spellings of merged.values()) {
      const freq = (w) => matches.get(w);
      spellings.sort((a, b) => freq(b) - freq(a) || (b === b.toLowerCase()) - (a === a.toLowerCase()) || compareWords(a, b));
      const [word, ...variants] = spellings;
      const item = { word, variants, zipf: freq(word) };
      const band = /[\s-]/.test(word) ? "phrases" : item.zipf >= COMMON ? "common" : item.zipf >= RARE ? "uncommon" : "rare";
      bands[band].push(item);
    }
    for (const items of Object.values(bands)) items.sort((a, b) => compareWords(a.word, b.word));
    return bands;
  }
}

const collator = new Intl.Collator("en");
export const compareWords = (a, b) => collator.compare(a, b);
