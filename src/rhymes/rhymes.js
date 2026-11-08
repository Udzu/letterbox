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
// - onset: the consonants just before the rhyme, within its word
// - ipa: the rhyme in IPA
export function rhymeParts(pron) {
  const ps = phonemes(pron);
  let start = ps.findLastIndex((x) => x.stress === 1);
  if (start < 0) start = ps.findLastIndex((x) => VOWELS.has(x.p));
  let onset = "";
  for (let i = start - 1; i >= 0 && !VOWELS.has(ps[i].p) && ps[i].p !== " "; i--) onset = ps[i].p + onset;
  const tail = ps.slice(start);
  const vowel = (x, i) => (i > 0 && x.stress === 0 && "IUV".includes(x.p) ? "V" : x.p);
  const rhyme = tail.filter((x) => x.p !== " ").map(vowel).join("");
  let loose = "";
  let cluster = "";
  tail.forEach((x, i) => {
    if (!VOWELS.has(x.p)) {
      cluster += x.p;
      return;
    }
    loose += splitCluster(cluster)[0] + vowel(x, i);
    cluster = "";
  });
  loose += cluster.replaceAll(" ", "");
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

// A rhyming dictionary over a list of entries.
export class Rhymes {
  constructor(entries) {
    this.entries = entries;
    this.byWord = new Map(); // lookup key -> entries
    this.byRhyme = new Map(); // rhyme -> [{ entry, onset }]
    this.byLoose = new Map(); // loose rhyme -> [{ entry, onset }]
    const add = (map, key, value) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(value);
    };
    for (const entry of entries) {
      add(this.byWord, lookupKey(entry.word), entry);
      const { rhyme, loose, onset } = rhymeParts(entry.pron);
      add(this.byRhyme, rhyme, { entry, onset });
      add(this.byLoose, loose, { entry, onset });
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

  // The rhymes for an entry's pronunciation, alphabetically: other words with the same rhyme. By
  // default these are perfect rhymes, with a different onset (so not head and behead, or homophones)
  // and the same consonants throughout the rhyme. Options:
  // - sameOnset: allow the same onset too
  // - looseOnsets: allow different consonants at the start of the syllables after the stressed one
  //   (so hip-hop and flip-flop)
  find(entry, { sameOnset = false, looseOnsets = false } = {}) {
    const parts = rhymeParts(entry.pron);
    const candidates = looseOnsets ? this.byLoose.get(parts.loose) : this.byRhyme.get(parts.rhyme);
    const self = lookupKey(entry.word);
    const words = new Set();
    for (const other of candidates ?? []) {
      if ((sameOnset || other.onset !== parts.onset) && lookupKey(other.entry.word) !== self) words.add(other.entry.word);
    }
    return [...words].sort(compareWords);
  }
}

const collator = new Intl.Collator("en");
export const compareWords = (a, b) => collator.compare(a, b);
