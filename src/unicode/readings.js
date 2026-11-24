// Readings of CJK ideographs, from unicode/readings.txt (see scripts/unihan-data.py for its format), and
// searching them: zh:shui (Mandarin), yue:seoi (Cantonese), ja:mizu or ja:みず (Japanese), ko:su or
// ko:수 (Korean), vi:thuy (Vietnamese).

// the languages, in the data's order, with the lists of common characters that rank first (see the
// script), best first
export const LANGUAGES = {
  zh: { name: "Mandarin", common: "TI" },
  yue: { name: "Cantonese", common: "GIT" },
  ja: { name: "Japanese", common: "JMI" },
  ko: { name: "Korean", common: "EKI" },
  vi: { name: "Vietnamese", common: "I" },
};
const CODES = Object.keys(LANGUAGES);

// A reading search, like "ja:mizu": its language code and the readings asked for, or null.
export function readingQuery(query) {
  const match = /^\s*([a-z]+)\s*:(.*)$/is.exec(query);
  const lang = match?.[1].toLowerCase();
  if (!LANGUAGES[lang]) return null;
  return { lang, terms: [...new Set(match[2].trim().split(/\s+/).filter(Boolean))] };
}

// --- Mandarin and Cantonese: a syllable without its tone, and the tone (0 for any)

const PINYIN_TONES = { "\u0304": 1, "\u0301": 2, "\u030c": 3, "\u0300": 4 };

// Pinyin, with tone marks or a tone number (5 or 0 for the neutral tone), as [syllable, tone], with
// ü written v (so lü is lv, and lu stays lu); syllables with neither have tone 0 unless marked, in
// which case they're neutral (5).
export function pinyin(text, marked = false) {
  let s = text.toLowerCase().normalize("NFD").replace(/u:/g, "v").replace(/u\u0308/g, "v").replace(/\u0302/g, "");
  let tone = 0;
  for (const [mark, t] of Object.entries(PINYIN_TONES)) {
    if (s.includes(mark)) {
      tone = t;
      s = s.replace(mark, "");
    }
  }
  const number = /[0-5]$/.exec(s);
  if (number) {
    tone = Number(number[0]) || 5;
    s = s.slice(0, -1);
  } else if (marked && !tone) tone = 5;
  return [s.normalize("NFC"), tone];
}

// Jyutping, with or without its tone number, as [syllable, tone]
export function jyutping(text) {
  const s = text.toLowerCase();
  const number = /[1-6]$/.exec(s);
  return number ? [s.slice(0, -1), Number(number[0])] : [s, 0];
}

// --- Japanese: everything as hiragana

const toHiragana = (text) => text.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

// romaji syllables, as kana (Hepburn and the usual typing alternatives)
const KANA = {};
const rows = {
  "": "あいうえお", k: "かきくけこ", g: "がぎぐげご", s: "さしすせそ", z: "ざじずぜぞ", t: "たちつてと", d: "だぢづでど",
  n: "なにぬねの", h: "はひふへほ", b: "ばびぶべぼ", p: "ぱぴぷぺぽ", m: "まみむめも", r: "らりるれろ",
};
for (const [c, kana] of Object.entries(rows)) [..."aiueo"].forEach((v, i) => (KANA[c + v] = kana[i]));
Object.assign(KANA, { ya: "や", yu: "ゆ", yo: "よ", wa: "わ", wi: "ゐ", we: "ゑ", wo: "を", shi: "し", chi: "ち", tsu: "つ", fu: "ふ", ji: "じ" });
for (const [c, i] of Object.entries({ k: "き", g: "ぎ", n: "に", h: "ひ", b: "び", p: "ぴ", m: "み", r: "り", s: "し", z: "じ", t: "ち", d: "ぢ" })) {
  for (const [v, small] of Object.entries({ a: "ゃ", u: "ゅ", o: "ょ" })) KANA[`${c}y${v}`] = i + small;
}
for (const [c, i] of Object.entries({ sh: "し", j: "じ", ch: "ち" })) {
  for (const [v, small] of Object.entries({ a: "ゃ", u: "ゅ", e: "ぇ", o: "ょ" })) KANA[c + v] = i + small;
}
const MACRONS = { ā: "aa", ī: "ii", ū: "uu", ē: "ei", ō: "ou", â: "aa", î: "ii", û: "uu", ê: "ei", ô: "ou" };

// Romaji (or kana) as hiragana, or null if it isn't valid romaji. Long vowels can be written with a
// macron (ō is ou), and ん as n, nn or n'.
export function kana(text) {
  let s = text.toLowerCase().replace(/[āīūēōâîûêô]/g, (c) => MACRONS[c]);
  if (!/[a-z]/.test(s)) return toHiragana(s);
  let out = "";
  while (s) {
    if (s[0] === "n" && (s[1] === "'" || s[1] === "n")) {
      out += "ん";
      s = s.slice(2);
    } else if (s[0] === "n" && !/^[aiueoy]/.test(s.slice(1))) {
      out += "ん";
      s = s.slice(1);
    } else if (/^([bcdfghjkmprstwz])\1/.test(s) || s.startsWith("tch")) {
      out += "っ";
      s = s.slice(1);
    } else {
      const length = [3, 2, 1].find((n) => KANA[s.slice(0, n)]);
      if (!length) return null;
      out += KANA[s.slice(0, length)];
      s = s.slice(length);
    }
  }
  return out;
}

// --- Korean: Hangul syllables, also found by their Revised Romanization

const RR_L = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const RR_V = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const RR_T = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

// Hangul in the Revised Romanization, syllable by syllable (as hanja readings are single syllables)
export function romanize(hangul) {
  return [...hangul].map((c) => {
    const s = c.codePointAt(0) - 0xac00;
    if (s < 0 || s >= 11172) return c;
    return RR_L[Math.floor(s / 588)] + RR_V[Math.floor((s % 588) / 28)] + RR_T[s % 28];
  }).join("");
}

// --- Vietnamese: the letters with their vowel marks, and the tone mark, so that thủy and thuỷ match

const VI_TONES = /[\u0300\u0301\u0303\u0309\u0323]/g;
export function vietnamese(text) {
  const d = text.toLowerCase().normalize("NFD");
  const tone = (d.match(VI_TONES) ?? []).join("");
  const base = d.replace(VI_TONES, "").normalize("NFC");
  const plain = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
  return { exact: `${base}${tone}`, plain };
}

// --- The data

// The key a reading is indexed by in each language, and a test of whether a search term matches
// it more exactly (by tone, say): [key, check] for a term, or null if the term can't be a reading.
const KEYS = {
  zh: {
    reading: (r) => [pinyin(r, true)[0]],
    term: (t) => {
      const [s, tone] = pinyin(t);
      return [s, (r) => !tone || pinyin(r, true)[1] === tone];
    },
  },
  yue: {
    reading: (r) => [jyutping(r)[0]],
    term: (t) => {
      const [s, tone] = jyutping(t);
      return [s, (r) => !tone || jyutping(r)[1] === tone];
    },
  },
  ja: {
    reading: (r) => [toHiragana(r)],
    term: (t) => {
      const k = kana(t);
      return k && [k, () => true];
    },
  },
  ko: {
    reading: (r) => [r, romanize(r)],
    term: (t) => [/[\uac00-\ud7a3]/.test(t) ? t : t.toLowerCase(), () => true],
  },
  vi: {
    reading: (r) => [vietnamese(r).plain],
    term: (t) => {
      const { exact, plain } = vietnamese(t);
      // a term with no marks matches any marks
      return [plain, (r) => exact === plain || vietnamese(r).exact === exact];
    },
  },
};

export class Readings {
  constructor(text) {
    this.rows = new Map();
    let cp = 0;
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const [delta, ...fields] = line.split("\t");
      cp += parseInt(delta, 16);
      this.rows.set(cp, fields);
    }
    this.indexes = {};
  }

  // what's known about an ideograph: its readings in each language, radical and strokes, or null
  get(cp) {
    const fields = this.rows.get(cp);
    if (!fields) return null;
    const readings = Object.fromEntries(CODES.map((code, i) => [code, fields[i] ? fields[i].split(" ") : []]));
    const [radical = "", strokes = "", common = ""] = fields.slice(CODES.length);  // (then frequency)
    return { readings, radical, strokes: Number(strokes) || null, common };
  }

  // every reading in a language, by key: {key: [[cp, reading, position], ...]}, made when first needed
  index(lang) {
    if (this.indexes[lang]) return this.indexes[lang];
    const index = new Map();
    const column = CODES.indexOf(lang);
    for (const [cp, fields] of this.rows) {
      if (!fields[column]) continue;
      fields[column].split(" ").forEach((reading, position) => {
        for (const key of new Set(KEYS[lang].reading(reading))) {
          if (!index.has(key)) index.set(key, []);
          index.get(key).push([cp, reading, position]);
        }
      });
    }
    return (this.indexes[lang] = index);
  }

  // Ideographs with any of these readings in a language, as {cp, reading}: those for the first term
  // first, and for each term the more common first (in the language's lists in LANGUAGES, then more
  // frequent in Chinese), then those for which it's an earlier reading, then in codepoint order (which
  // within a block is by radical and strokes).
  search(lang, terms) {
    const index = this.index(lang);
    const common = LANGUAGES[lang].common;
    const found = new Map();
    for (const [t, term] of terms.entries()) {
      const key = KEYS[lang].term(term);
      if (!key) continue;
      const [k, check] = key;
      for (const [cp, reading, position] of index.get(k) ?? []) {
        if (found.has(cp) || !check(reading)) continue;
        const [, , flags = "", frequency = 0] = this.rows.get(cp).slice(CODES.length);
        const tier = [...common].findIndex((c) => flags.includes(c));
        found.set(cp, { cp, reading, rank: [t, tier < 0 ? common.length : tier, -frequency, position, cp] });
      }
    }
    const compare = (a, b) => a.rank.reduce((d, x, i) => d || x - b.rank[i], 0);
    return [...found.values()].sort(compare).map(({ cp, reading }) => ({ cp, reading }));
  }
}
