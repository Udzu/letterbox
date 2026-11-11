// Pronunciations and rhymes for the Rhymes page.
//
// rhymes/pronunciations.txt (built by scripts/rhymes-data.py) has a header of "# key: value" lines,
// then one line per pronunciation: word, pronunciation, sources, frequency and (for common single
// words) parts of speech, separated by tabs. A
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

// A pronunciation typed as sounds, in IPA or in ASCII (based on X-SAMPA, as given in the page's help),
// or a mix: { pron, assumed }, where pron is in the file's codes and assumed says whether the stress
// was guessed. Throws an error naming the first sound it doesn't know. A stress mark (ˈ or ' for
// primary, ˌ or , for secondary) goes before its syllable; without a primary one, the first vowel is
// stressed (so /Ed/ and /Edi/ rhyme on -ed and -eddy). Spaces separate words, and syllable breaks,
// length marks and hyphens are ignored (so /-Ed/ works too).
const SOUND_SYMBOLS = Object.entries({
  // longest first
  tʃ: "C", dʒ: "J", eɪ: "e", aɪ: "Y", aʊ: "W", oʊ: "o", ɔɪ: "Q", "ɜ˞": "R",
  tS: "C", dZ: "J", eI: "e", aI: "Y", aU: "W", oU: "o", OI: "Q", "@`": "R",
  ɑ: "A", ɒ: "A", æ: "a", ʌ: "V", ə: "V", ɐ: "V", ɔ: "O", ɛ: "E", ɝ: "R", ɚ: "R", ɜ: "R", ɪ: "I", ᵻ: "I",
  ʊ: "U", ʃ: "S", ʒ: "Z", θ: "T", ð: "D", ŋ: "N", ɹ: "r", ɡ: "g", ɾ: "t", ʔ: "t", ɫ: "l",
  A: "A", a: "a", "^": "V", "@": "V", O: "O", E: "E", 3: "R", I: "I", i: "i", U: "U", u: "u", e: "e", o: "o",
  S: "S", Z: "Z", T: "T", D: "D", N: "N", y: "j",
  ...Object.fromEntries([..."bdfghjklmnprstvwz"].map((c) => [c, c])),
}).sort(([a], [b]) => b.length - a.length);

export function parseSounds(text) {
  const out = []; // { p, stress } for vowels, { p } for consonants and " " between words
  let mark = 0; // the stress mark waiting for its vowel
  const s = text.replace(/[\u0361\u035c]/g, ""); // tie bars, as in t͡ʃ
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/\s/.test(c)) {
      if (out.length && out.at(-1).p !== " ") out.push({ p: " " });
      i++;
    } else if ("ˈ'’ʼ".includes(c) || "ˌ,".includes(c)) {
      mark = "ˌ,".includes(c) ? 2 : 1;
      i++;
    } else if (".:ːˑ-‿".includes(c)) {
      i++;
    } else if (c === "\u0329" || c === "\u030d") {
      // a syllabic consonant, as in /ˈbʌʔn̩/: a vowel before it
      if (out.length && !VOWELS.has(out.at(-1).p) && out.at(-1).p !== " ") out.splice(-1, 0, { p: "V", stress: mark });
      mark = 0;
      i++;
    } else {
      const found = SOUND_SYMBOLS.find(([symbol]) => s.startsWith(symbol, i));
      if (!found) throw new Error(`Unknown sound “${c}”`);
      const [symbol, code] = found;
      if (VOWELS.has(code)) {
        out.push({ p: code, stress: mark });
        mark = 0;
      } else out.push({ p: code });
      i += symbol.length;
    }
  }
  if (out.at(-1)?.p === " ") out.pop();
  // ʌr and ɝr not before a vowel are ɝ (/ˈbʌtər/ as /ˈbʌtɚ/)
  for (let k = out.length - 2; k >= 0; k--) {
    if ((out[k].p === "V" || out[k].p === "R") && out[k + 1].p === "r" && !VOWELS.has(out[k + 2]?.p)) {
      out[k].p = "R";
      out.splice(k + 1, 1);
    }
  }
  const vowels = out.filter((x) => VOWELS.has(x.p));
  if (vowels.length === 0) throw new Error("No vowel");
  const assumed = !vowels.some((x) => x.stress);
  if (!vowels.some((x) => x.stress === 1)) (vowels.find((x) => x.stress === 2) ?? vowels[0]).stress = 1;
  return { pron: out.map((x) => x.p + (x.stress ? x.stress : "")).join(""), assumed: assumed && vowels.length > 1 };
}

// A pronunciation file's attribution and entries ({ word, pron, sources, zipf }), or an error naming
// the first bad line. Lines starting with # are comments ("# attribution: …" gives the attribution),
// and blank lines are skipped. Each other line has a word and a pronunciation, separated by a tab,
// optionally followed by sources, a frequency and parts of speech (see the top of this file and
// MOSAIC_TAILS). Without a frequency, a word counts as common.
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
    const [word, pron, sources = "", zipf = "", pos = "", ...rest] = line.split("\t");
    const where = `line ${i + 1}`;
    if (!word?.trim() || pron === undefined) throw new Error(`${where}: expected a word and a pronunciation separated by a tab`);
    if (rest.length) throw new Error(`${where}: too many columns`);
    if (!PRONUNCIATION.test(pron)) throw new Error(`${where}: "${pron}" isn't a pronunciation in the file's phoneme codes`);
    if (!/^[A-Za-z]*$/.test(sources)) throw new Error(`${where}: sources should be letters, not "${sources}"`);
    if (!/^\d*$/.test(zipf)) throw new Error(`${where}: frequency should be a whole number, not "${zipf}"`);
    if (!/^[nvp]*$/.test(pos)) throw new Error(`${where}: parts of speech should be n, v or p, not "${pos}"`);
    const entry = { word: word.trim(), pron, sources, zipf: zipf === "" ? COMMON : Number(zipf) };
    if (pos) entry.pos = pos;
    entries.push(entry);
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
// - nonRhotic: r is dropped unless a vowel follows (even in the next word, as in far away): ɔr is ɔ
//   (court is caught), unstressed ɚ is ə (letter rhymes with Etta), stressed ɝ stays a vowel of its
//   own, and other vowels end in ə instead (beer is bɪə, fire faɪə like Maya). ɑr is left alone, as
//   GenAm's ɑ is both father's and bother's, and r-less accents keep car's vowel apart from cot's.
// As rhymes ignore secondary stress and word breaks, so do the mergers, so that they never make
// pronunciations that rhyme stop rhyming: "stressed" means primary stress (the vowel a rhyme starts
// from), and "unstressed" means without it.
const VOWEL = "[AaVOWYEReIioQUu]";
const re = (source, flags) => new RegExp(source.replaceAll("VOWEL", VOWEL), flags);
const BEFORE_R_AND_VOWEL = re("[ae]1(?= ?r ?VOWEL)", "g");
const STRESSED_V_R = re("V1( ?)r(?= ?VOWEL)", "g");
const FLAPPED_T = re("(?<=(?:VOWEL[12]?|r) ?)t(?= ?VOWEL(?!1))", "g");
const CODA_R = "( ?)r(?! ?VOWEL)";
const R_LESS = [
  [re("(O[12]?|R1?)" + CODA_R, "g"), "$1$2"], // court, Rr: just drop it
  [re("V1" + CODA_R, "g"), "R1$1"], // stressed ʌr is ɝ
  [re("V(2?)" + CODA_R, "g"), "V$1$2"], // unstressed ʌr is ɚ, so ə
  [re("([aWYEeIiQUuo][12]?)" + CODA_R, "g"), "$1V$2"], // beer: bɪə
  [re("R(2?)(?= ?VOWEL)", "g"), "V$1r"], // unstressed ɚ before a vowel: əɹ
  [/R(?![12])|R(?=2)/g, "V"], // and otherwise ə
];
export const MERGERS = {
  cotCaught: (pron) => pron.replace(/O(?![12]? ?r)/g, "A"),
  maryMarryMerry: (pron) => pron.replace(BEFORE_R_AND_VOWEL, "E1"),
  hurryFurry: (pron) => pron.replace(STRESSED_V_R, "R1$1"),
  cureForce: (pron) => pron.replace(/U1( ?)r/g, "O1$1r"),
  flapping: (pron) => pron.replace(FLAPPED_T, "d"),
  pinPen: (pron) => pron.replace(/E1(?= ?[mn])/g, "I1"),
  nonRhotic: (pron) => R_LESS.reduce((p, [from, to]) => p.replace(from, to), pron),
};

// a pronunciation with the given mergers applied ({ cotCaught: true, ... }), always in the same order
export function merge(pron, mergers = {}) {
  return Object.entries(MERGERS).reduce((p, [name, f]) => (mergers[name] ? f(p) : p), pron);
}
// A rhyme or loose rhyme with the sounds that any merger can change made the same: no merger changes
// this key, so it finds the candidates for find to check with the mergers chosen. (Merging whole
// rhymes wouldn't do: mergers interact, as poor is pour and so paw with cure-force and r-dropping,
// but cot-caught leaves the ɔ of pour, and loose rhymes leave out consonants that mergers depend on,
// such as the r of hurry and the m of pen.) Every r in a loose rhyme ends a syllable, and r-dropping
// can drop any other, and with it the ə said instead.
const VOWEL_CLASSES = { O: "A", U: "A", a: "E", e: "E", I: "E", V: "R" };
const indexKey = (rhyme) => rhyme.replace(/Vr/g, "R").replace(/[OUaeIV]/g, (c) => VOWEL_CLASSES[c]).replaceAll("t", "d")
  .replaceAll("r", "").replace(/(?<=[AERWYioQu])R+/g, "");

// Mosaic rhymes: a stressed word followed by an unstressed word that leans on it, like know it for
// poet, get her for letter or cat'll for battle. Each tail has its unstressed pronunciation (as said
// after another word: her without its h; him isn't needed, as /ɪm/ rhymes like 'em) and the parts of speech (see the data file) that
// the word before it must be able to have: n for the nouns and pronouns that 'll follows, v and p for
// the verbs and prepositions that object pronouns and articles follow. It and you can also be
// subjects, after the conjunctions and adverbs in BEFORE_SUBJECT (then you, so it).
export const MOSAIC_TAILS = [
  ["it", "It", "vp"], ["her", "R", "vp"], ["'em", "Vm", "vp"], ["us", "Vs", "vp"],
  ["me", "mi", "vp"], ["you", "ju", "vp"], ["a", "V", "vp"], ["in", "In", "v"], ["'ll", "Vl", "n"],
].map(([word, pron, after]) => ({ word, pron, after, rhyme: pron.replace(/[IU]/g, "V"), attached: word === "'ll" }));
const BEFORE_SUBJECT = new Set("when then if so as than now how where why because though and but".split(" "));
// words that are never the stressed word of a mosaic rhyme, though Wiktionary says they can be verbs or
// nouns: forms of be, modals and the like (but not do, have and had, as in do it)
const UNSTRESSED_HEADS = new Set(`be been being is are was were am shall should will would can cannot could may might
must ought gonna wanna gotta`.split(/\s+/));
const TAIL_PRONS = new Map(MOSAIC_TAILS.map((t) => [t.word, t.pron]));
// what a mosaic rhyme's stressed word must look like: a word of two or more letters, not a compound or
// abbreviation (wordfreq gives off-set and a-flat the frequencies of their parts)
const MOSAIC_WORD = /^\p{L}[\p{Ll}']*\p{Ll}$/u;

// Words that are unstressed in a phrase built from its words, and the particles that take the stress at
// the end of one (give up), as in scripts/rhymes-data/phrases.py.
const FUNCTION_WORDS = new Set(`a an the of to in on at by for with from into onto upon about as than via per off out up
down over and or but nor if that i me my mine you your yours he him his she her hers it its we us our ours they them
their theirs one's oneself someone someone's somebody somebody's something anyone anyone's anything who whom whose
which is are was were be been being am do does did has have had will would shall should can could may might must 's
'd 'll 're 've 'em`.split(/\s+/));
const PARTICLES = new Set("up down out off in on over away back around about through along by apart aside".split(" "));

// A rhyming dictionary over a list of entries.
export class Rhymes {
  constructor(entries) {
    this.entries = entries;
    this.byWord = new Map(); // lookup key -> entries
    this.accented = new Map(); // lookup key without accents -> lookup keys with them
    // rhymes and loose rhymes as indexKey -> [{ entry, rhyme, loose, onset }] (the parts without
    // mergers), from which find picks the ones that match with the mergers chosen
    this.byRhyme = new Map();
    this.byLoose = new Map();
    const add = (map, key, value) => {
      const list = map.get(key);
      if (list) list.push(value);
      else map.set(key, [value]);
    };
    // as the same rhymes and loose rhymes come up again and again, their keys are cached
    const keys = new Map();
    const keyOf = (rhyme) => {
      let key = keys.get(rhyme);
      if (key === undefined) keys.set(rhyme, (key = indexKey(rhyme)));
      return key;
    };
    for (const entry of entries) {
      const key = lookupKey(entry.word);
      if (!this.byWord.has(key) && withoutAccents(key) !== key) add(this.accented, withoutAccents(key), key);
      add(this.byWord, key, entry);
      const { rhyme, loose, onset } = rhymeParts(entry.pron);
      const item = { entry, rhyme, loose, onset };
      add(this.byRhyme, keyOf(rhyme), item);
      add(this.byLoose, keyOf(loose), item);
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

  // The words pronounced like a pronunciation (ignoring secondary stress, word breaks and differences
  // between unstressed ɪ, ʊ and ə), as a map like matches gives. The index for this is only built
  // the first time it's needed.
  homophones(pron) {
    const key = (p) => p.replace(/[ 2]/g, "").replace(/[IUV](?!1)/g, "V");
    if (!this.bySound) {
      this.bySound = new Map();
      for (const entry of this.entries) {
        const k = key(entry.pron);
        if (!this.bySound.has(k)) this.bySound.set(k, []);
        this.bySound.get(k).push(entry);
      }
    }
    const words = new Map();
    for (const { word, zipf, pron: p } of this.bySound.get(key(pron)) ?? []) {
      const match = words.get(word) ?? { zipf: 0, syllables: new Set() };
      match.zipf = Math.max(match.zipf, zipf);
      match.syllables.add(syllableCount(p));
      words.set(word, match);
    }
    return words;
  }

  // A pronunciation for a phrase that has none of its own, built from its words' (as the data file builds
  // those in the English phrases list): function words unstressed, in their weak forms, the last other
  // word (or a final particle) with the primary stress, and other words with secondary stress. 'll and
  // 'd count as words (cat'll). Returns an entry with sources "" and no frequency, or null if a word
  // has no pronunciation or there's only one word.
  phrasePronunciation(phrase) {
    const parts = phrase.trim().split(/[\s-]+|(?='(?:ll|d)$)/).filter(Boolean);
    if (parts.length < 2) return null;
    const lower = parts.map((w) => lookupKey(w));
    const isFunction = (i) => FUNCTION_WORDS.has(lower[i]) && !(i === parts.length - 1 && PARTICLES.has(lower[i]));
    let main = parts.length - 1;
    while (main > 0 && isFunction(main)) main--;
    const prons = [];
    for (const [i, word] of lower.entries()) {
      const tail = TAIL_PRONS.get(word);
      const found = this.pronunciations(word);
      if (!tail && !found.length) return null;
      let pron;
      if (i !== main && isFunction(i)) pron = tail ?? (found.find((e) => !/[12]/.test(e.pron)) ?? found[0]).pron.replace(/[12]/g, "");
      else pron = (found[0]?.pron ?? tail).replace(/1/g, i === main ? "1" : "2");
      prons.push(pron);
    }
    return { word: phrase.trim(), pron: prons.join(" "), sources: "", zipf: 0, built: true };
  }

  // Mosaic rhymes for an entry (see MOSAIC_TAILS), as a map like matches gives, from each phrase to
  // the frequency of its stressed word: the phrases whose rhyme, as one pronunciation, would be a rhyme
  // for the entry with the same options as matches. The stressed word must be a single word (see
  // MOSAIC_WORD) with parts of speech in the data that the tail can follow.
  mosaic(entry, options = {}) {
    const { sameOnset = false, looseOnsets = false } = options;
    const mergers = Object.keys(MERGERS).some((name) => options[name]);
    const parts = rhymeParts(entry.pron);
    const target = mergers ? rhymeParts(merge(entry.pron, options)) : parts;
    const self = lookupKey(entry.word);
    const words = new Map();
    for (const tail of MOSAIC_TAILS) {
      if (!parts.rhyme.endsWith(tail.rhyme) || parts.rhyme.length === tail.rhyme.length) continue;
      for (const item of this.byRhyme.get(indexKey(parts.rhyme.slice(0, -tail.rhyme.length))) ?? []) {
        const { word, pron, pos, zipf } = item.entry;
        const subject = (tail.word === "it" || tail.word === "you") && BEFORE_SUBJECT.has(word);
        if (!subject && (!pos || ![...tail.after].some((c) => pos.includes(c)))) continue;
        if (!MOSAIC_WORD.test(word)) continue;
        if (!tail.after.includes("n") && word[0] !== word[0].toLowerCase()) continue; // names aren't verbs
        if (UNSTRESSED_HEADS.has(word)) continue;
        const phrase = tail.attached ? word + tail.word : `${word} ${tail.word}`;
        const whole = rhymeParts(merge(`${pron} ${tail.pron}`, options));
        if (whole.rhyme !== target.rhyme && !(looseOnsets && whole.loose === target.loose)) continue;
        if ((!sameOnset && item.onset === parts.onset) || lookupKey(phrase) === self) continue;
        const match = words.get(phrase) ?? { zipf: 0, syllables: new Set() };
        match.zipf = Math.max(match.zipf, zipf);
        match.syllables.add(syllableCount(pron) + syllableCount(tail.pron));
        words.set(phrase, match);
      }
    }
    return words;
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
    const parts = rhymeParts(entry.pron);
    const target = mergers ? rhymeParts(merge(entry.pron, options)) : parts;
    // Loose rhymes also include the strict ones: as loose rhymes split consonants at word breaks, the
    // same sounds can give different loose rhymes (the r of care of ends a syllable, but where've's
    // starts one), so they wouldn't always.
    const strict = this.byRhyme.get(indexKey(parts.rhyme)) ?? [];
    const candidates = looseOnsets ? [...strict, ...(this.byLoose.get(indexKey(parts.loose)) ?? [])] : strict;
    const self = withoutAccents(lookupKey(entry.word));
    const words = new Map();
    for (const item of candidates) {
      const other = mergers ? rhymeParts(merge(item.entry.pron, options)) : item;
      if (other.rhyme !== target.rhyme && !(looseOnsets && other.loose === target.loose)) continue;
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
