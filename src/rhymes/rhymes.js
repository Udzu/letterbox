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
  // works on the string directly rather than on phonemes, as it's run on every pronunciation when the
  // page loads: a vowel's stress is the digit after it, if any
  let start = pron.lastIndexOf("1") - 1;
  for (let j = pron.length - 1; start < 0 && j >= 0; j--) if (VOWELS.has(pron[j])) start = j;
  let i = start - 1;
  while (i >= 0 && pron[i] !== " " && !VOWELS.has(pron[i]) && pron[i] !== "1" && pron[i] !== "2") i--;
  const cluster = pron.slice(i + 1, start);
  const onset = i < 0 || pron[i] === " " ? cluster : splitCluster(cluster)[1];
  if (start < 0) start = pron.length - 1; // no vowel (hm): no onset, and the rhyme is the last sound
  let rhyme = "";
  let loose = "";
  let between = "";
  for (let j = start; j < pron.length; j++) {
    const c = pron[j];
    if (c === "1" || c === "2") continue;
    if (!VOWELS.has(c)) {
      if (c !== " ") rhyme += c;
      between += c;
      continue;
    }
    const unstressed = j > start && pron[j + 1] !== "1" && pron[j + 1] !== "2";
    const v = unstressed && (c === "I" || c === "U" || c === "V") ? "V" : c;
    rhyme += v;
    loose += splitCluster(between)[0] + v;
    between = "";
  }
  loose += between.replaceAll(" ", "");
  const tail = pron.slice(start);
  // ipa is only worked out when it's asked for, as indexing every pronunciation doesn't need it
  return {
    rhyme, loose, onset,
    get ipa() { return toIpa(tail); },
  };
}

// the number of syllables in a pronunciation: its number of vowels
export const syllableCount = (pron) => phonemes(pron).filter((x) => VOWELS.has(x.p)).length;

// A pronunciation file's attribution and entries ({ word, pron, sources, zipf }), or an error naming
// the first bad line. Lines starting with # are comments ("# attribution: …" gives the attribution),
// and blank lines are skipped. Each other line has a word and a pronunciation, separated by a tab,
// optionally followed by sources and a frequency (see the top of this file). Without a frequency, a
// word counts as common.
const PRONUNCIATION = /^(?:[AaVOWYEReIioQUu][12]?|[bCdDfghJklmnNprsStTvwjzZ ])+$/;

export function parsePronunciations(text) {
  const entries = [];
  let attribution = "";
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("#")) {
      const match = /^# attribution: (.*)$/.exec(line);
      if (match) attribution = match[1];
      return;
    }
    if (!line.trim()) return;
    const [word, pron, sources = "", zipf = "", ...rest] = line.split("\t");
    const where = `line ${i + 1}`;
    if (!word?.trim() || pron === undefined) throw new Error(`${where}: expected a word and a pronunciation separated by a tab`);
    if (rest.length) throw new Error(`${where}: too many columns`);
    if (!PRONUNCIATION.test(pron)) throw new Error(`${where}: "${pron}" isn't a pronunciation in the file's phoneme codes`);
    if (!/^[A-Za-z]*$/.test(sources)) throw new Error(`${where}: sources should be letters, not "${sources}"`);
    if (!/^\d*$/.test(zipf)) throw new Error(`${where}: frequency should be a whole number, not "${zipf}"`);
    entries.push({ word: word.trim(), pron, sources, zipf: zipf === "" ? COMMON : Number(zipf) });
  });
  if (entries.length === 0) throw new Error("no pronunciations found");
  return { attribution, entries };
}

// a word as looked up: case, the kind of apostrophe and how accents are encoded don't matter
// (most words need no cleaning up, which is checked first as this runs on every word when the page loads)
const UNCLEAN = /^\s|\s$|\s\s|[^\S ]|[‘’ʼ]|[^\x00-\x7f]/;
export const lookupKey = (word) =>
  (UNCLEAN.test(word) ? word.normalize("NFC").trim().replace(/\s+/g, " ").replace(/[‘’ʼ]/g, "'") : word).toLowerCase();

// A word without its accents (café as cafe, Brontë as Bronte), with æ, œ and ß as two letters and
// letters like ø and ł without their strokes, as on the Anagrams page.
const UNDECOMPOSED = { ø: "o", Ø: "O", ł: "l", Ł: "L", đ: "d", Đ: "D", ı: "i", ħ: "h", Ħ: "H", ŧ: "t", Ŧ: "T", æ: "ae", Æ: "AE", œ: "oe", Œ: "OE", ß: "ss" };
export const withoutAccents = (word) => (/[^\x00-\x7f]/.test(word)
  ? [...word.normalize("NFD").replace(/\p{M}/gu, "")].map((c) => UNDECOMPOSED[c] ?? c).join("")
  : word);

// Zipf frequencies (× 10) at or above which a word counts as common, and below which it's rare
export const COMMON = 30;
export const RARE = 20;

// Sound mergers that some speakers have, each as a function on pronunciations (in the file's codes,
// with stress digits) that makes the merged sounds the same. They work on whole pronunciations rather
// than rhymes, as loose rhymes leave out consonants that some depend on (the r of hurry, the n of
// penny).
// - cotCaught: ɔ is the same as ɑ (caught and cot), except before r (horse isn't hearse or hard)
// - maryMarryMerry: stressed æ and eɪ are ɛ before r and a vowel (marry and Mary are merry)
// - hurryFurry: stressed ʌ before r and a vowel is ɝ (hurry is furry)
// - cureForce: stressed ʊ before r is ɔ (poor is pour, tour is tore)
// - flapping: t between a vowel (or r) and an unstressed vowel is d (latter is ladder, dirty wordy)
// - pinPen: stressed ɛ is ɪ before m or n (pen is pin, hem him)
// As rhymes ignore secondary stress and word breaks, so do the mergers, so that they never make
// pronunciations that rhyme stop rhyming: "stressed" means primary stress (the vowel a rhyme starts
// from), and "unstressed" means without it.
const VOWEL = "[AaVOWYEReIioQUu]";
const re = (source, flags) => new RegExp(source.replaceAll("VOWEL", VOWEL), flags);
const BEFORE_R_AND_VOWEL = re("[ae]1(?= ?r ?VOWEL)", "g");
const STRESSED_V_R = re("V1( ?)r(?= ?VOWEL)", "g");
const FLAPPED_T = re("(?<=(?:VOWEL[12]?|r) ?)t(?= ?VOWEL(?!1))", "g");
export const MERGERS = {
  cotCaught: (pron) => pron.replace(/O(?![12]? ?r)/g, "A"),
  maryMarryMerry: (pron) => pron.replace(BEFORE_R_AND_VOWEL, "E1"),
  hurryFurry: (pron) => pron.replace(STRESSED_V_R, "R1$1"),
  cureForce: (pron) => pron.replace(/U1( ?)r/g, "O1$1r"),
  flapping: (pron) => pron.replace(FLAPPED_T, "d"),
  pinPen: (pron) => pron.replace(/E1(?= ?[mn])/g, "I1"),
};

// a pronunciation with the given mergers applied ({ cotCaught: true, ... }), always in the same order
export function merge(pron, mergers = {}) {
  return Object.entries(MERGERS).reduce((p, [name, f]) => (mergers[name] ? f(p) : p), pron);
}
// the sounds that some merger changes, so pronunciations without them are the same with every merger
const MERGEABLE = /O|[aeVUE]1|t/;
const ALL_MERGERS = Object.values(MERGERS);
const mergeAll = (pron) => ALL_MERGERS.reduce((p, f) => f(p), pron);
// A loose rhyme with the sounds that any merger can change made the same. Loose rhymes leave out
// consonants that mergers depend on (the r of hurry, the m of pen), so two that are the same can
// differ once merged: this key, which no merger changes, finds the candidates.
const VOWEL_CLASSES = { O: "A", U: "A", a: "E", e: "E", I: "E", V: "R" };
const looseIndexKey = (loose) => loose.replace(/Vr/g, "R").replace(/[OUaeIV]/g, (c) => VOWEL_CLASSES[c]).replaceAll("t", "d");

// A rhyming dictionary over a list of entries.
export class Rhymes {
  constructor(entries) {
    this.entries = entries;
    this.byWord = new Map(); // lookup key -> entries
    this.accented = new Map(); // lookup key without accents -> lookup keys with them
    // rhymes with every merger applied, and loose rhymes as looseIndexKey -> [{ entry, rhyme, loose,
    // onset }] (the parts without mergers), from which find picks the ones that match with the mergers
    // chosen
    this.byRhyme = new Map();
    this.byLoose = new Map();
    const add = (map, key, value) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    const rhymeKeys = new Map(); // the rhyme part of a pronunciation -> its key in byRhyme
    const looseKeys = new Map(); // a loose rhyme -> its key in byLoose
    for (const entry of entries) {
      const key = lookupKey(entry.word);
      if (!this.byWord.has(key) && withoutAccents(key) !== key) add(this.accented, withoutAccents(key), key);
      add(this.byWord, key, entry);
      const { rhyme, loose, onset } = rhymeParts(entry.pron);
      const item = { entry, rhyme, loose, onset };
      // the mergers only need to see the rhyme, from the stressed vowel on, and as the same rhymes and
      // loose rhymes come up again and again, their keys are cached
      const stress = entry.pron.lastIndexOf("1");
      const tail = stress > 0 ? entry.pron.slice(stress - 1) : entry.pron;
      let rhymeKey = MERGEABLE.test(tail) ? rhymeKeys.get(tail) : rhyme;
      if (rhymeKey === undefined) {
        const merged = mergeAll(tail);
        rhymeKey = merged === tail ? rhyme : rhymeParts(merged).rhyme;
        rhymeKeys.set(tail, rhymeKey);
      }
      let looseKey = looseKeys.get(loose);
      if (looseKey === undefined) looseKeys.set(loose, (looseKey = looseIndexKey(loose)));
      add(this.byRhyme, rhymeKey, item);
      add(this.byLoose, looseKey, item);
    }
  }

  // A word's pronunciations, best first: those written the way it was typed, then those of other
  // spellings that only differ in case, then those with accents, each with the ones with the most
  // sources first. Accents only count one way: a word typed without them (cafe, Bronte) also finds
  // spellings with them (café, Brontë), but one typed with them only finds those, unless there's no
  // such spelling (naïve finds naive). A pronunciation shared by spellings that only differ in case
  // (orange, Orange) is only given once.
  pronunciations(word) {
    const typed = word.normalize("NFC").trim();
    const key = lookupKey(word);
    const plain = withoutAccents(key);
    const keys = plain === key || !this.byWord.has(key) ? [plain, ...(this.accented.get(plain) ?? [])] : [key];
    const found = keys.flatMap((k) => this.byWord.get(k) ?? []);
    const rank = (e) => (e.word === typed ? 0 : lookupKey(e.word) === key ? 1 : 2);
    const sorted = found.sort((a, b) => rank(a) - rank(b) || b.sources.length - a.sources.length);
    const seen = new Set();
    const seenKey = (entry) => `${lookupKey(entry.word)}\t${entry.pron}`;
    return sorted.filter((entry) => !seen.has(seenKey(entry)) && seen.add(seenKey(entry)));
  }

  // A word's pronunciations (as given by pronunciations), grouped when they have the same rhymes
  // (with the mergers chosen, as for find): [{ entry, others }], where entry is the first in its group
  // and others are the rest.
  pronunciationGroups(word, options = {}) {
    const groups = new Map();
    for (const entry of this.pronunciations(word)) {
      const { rhyme, onset } = rhymeParts(merge(entry.pron, options));
      const key = `${onset}|${rhyme}`;
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

  // The rhymes as for find, as a map from each word to { zipf, syllables }: the highest Zipf frequency
  // (× 10) of its pronunciations that rhyme (so a word's rare pronunciations don't count as common),
  // and the set of their numbers of syllables.
  matches(entry, options = {}) {
    const { sameOnset = false, looseOnsets = false } = options;
    const mergers = Object.keys(MERGERS).some((name) => options[name]);
    const field = looseOnsets ? "loose" : "rhyme";
    const parts = rhymeParts(entry.pron);
    const target = mergers ? rhymeParts(merge(entry.pron, options))[field] : parts[field];
    const candidates = looseOnsets ? this.byLoose.get(looseIndexKey(parts.loose))
      : this.byRhyme.get(rhymeParts(mergeAll(entry.pron)).rhyme);
    const self = withoutAccents(lookupKey(entry.word));
    const words = new Map();
    for (const item of candidates ?? []) {
      const other = mergers ? rhymeParts(merge(item.entry.pron, options)) : item;
      if (other[field] !== target) continue;
      const { word, zipf } = item.entry;
      // (onsets as without mergers, which aren't meant to change them)
      if ((sameOnset || item.onset !== parts.onset) && withoutAccents(lookupKey(word)) !== self) {
        const match = words.get(word) ?? { zipf: 0, syllables: new Set() };
        match.zipf = Math.max(match.zipf, zipf);
        match.syllables.add(syllableCount(item.entry.pron));
        words.set(word, match);
      }
    }
    return words;
  }

  // Rhymes (as given by matches) as items for display. Words that only differ in case, accents, full
  // stops or hyphens for spaces (may, May; café, cafe; a, a.; hate crime, hate-crime) are merged into
  // one item, shown as its most frequent spelling (lowercase, then without hyphens, if tied): { word,
  // variants, zipf, syllables, band }. The band is common, uncommon or rare, by
  // frequency, or phrases (including hyphenated words, whose frequencies wordfreq can only estimate).
  items(matches) {
    const merged = new Map();
    for (const word of matches.keys()) {
      const key = withoutAccents(lookupKey(word)).replaceAll(".", "").replaceAll("-", " ");
      if (!merged.has(key)) merged.set(key, []);
      merged.get(key).push(word);
    }
    return [...merged.values()].map((spellings) => {
      const freq = (w) => matches.get(w).zipf;
      spellings.sort((a, b) => freq(b) - freq(a) || (b === b.toLowerCase()) - (a === a.toLowerCase())
        || a.includes("-") - b.includes("-") || compareWords(a, b));
      const [word, ...variants] = spellings;
      const zipf = freq(word);
      const syllables = new Set(spellings.flatMap((w) => [...matches.get(w).syllables]));
      const band = /[\s-]/.test(word) ? "phrases" : zipf >= COMMON ? "common" : zipf >= RARE ? "uncommon" : "rare";
      return { word, variants, zipf, syllables, band };
    });
  }

  // Rhymes grouped by frequency: { common, uncommon, rare, phrases }, each a list of items (see
  // items) in alphabetical order.
  arrange(matches) {
    const bands = { common: [], uncommon: [], rare: [], phrases: [] };
    for (const item of this.items(matches)) bands[item.band].push(item);
    for (const items of Object.values(bands)) items.sort((a, b) => compareWords(a.word, b.word));
    return bands;
  }

  // Rhymes grouped by number of syllables: [{ count, items }], fewest syllables first. Each group has
  // its common and uncommon words in alphabetical order, then its rare words, then its phrases. A word
  // whose rhyming pronunciations have different numbers of syllables is in each group.
  bySyllables(matches) {
    return groupByCount(this.items(matches), (item) => item.syllables);
  }

  // Rhymes grouped by number of letters (see letterCount), like bySyllables.
  byLetters(matches) {
    return groupByCount(this.items(matches), (item) => [letterCount(item.word)]);
  }
}

// Items grouped by the counts each has (see bySyllables).
function groupByCount(items, counts) {
  const groups = new Map();
  for (const item of items) {
    for (const n of counts(item)) {
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(item);
    }
  }
  const rank = { common: 0, uncommon: 0, rare: 1, phrases: 2 };
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([count, group]) => ({
    count,
    items: group.sort((a, b) => rank[a.band] - rank[b.band] || compareWords(a.word, b.word)),
  }));
}

// The number of letters and digits in a word, counted as on the Anagrams and Pangrams pages:
// accents are ignored, æ, œ and ß count as two letters, and spaces and punctuation don't count.
export const letterCount = (word) => [...withoutAccents(word)].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;

const collator = new Intl.Collator("en");
export const compareWords = (a, b) => collator.compare(a, b);
