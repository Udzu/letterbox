// Readings of CJK ideographs, from unicode/readings.txt (see scripts/unihan-data.py for its format), and
// searching them: zh:shui (Mandarin), yue:seoi (Cantonese), ja:mizu or ja:みず (Japanese), ko:su or
// ko:수 (Korean), vi:thuy (Vietnamese). Also their English definitions, which a search can match
// whole ("water" finds 水). And their radicals: rs:85 or rs:水 lists the characters with radical 85,
// rs:85+3 those with 3 more strokes.

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

// Kana as romaji, spelled the way searches take it (so they can be copied into one): shi, tsu, ja, ou
// for a long o, っ doubling the next consonant (tch before ch), and n' for ん before a vowel or y.
const ROMAJI = Object.fromEntries(Object.entries(KANA).reverse().map(([r, k]) => [k, r]));
Object.assign(ROMAJI, { し: "shi", ち: "chi", つ: "tsu", ふ: "fu", じ: "ji", ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o" });
for (const [r, k] of Object.entries(KANA)) if (k.length === 2 && /^(sh|ch|j)/.test(r)) ROMAJI[k] = r;
export function romaji(text) {
  const syllables = [];
  const k = toHiragana(text);
  for (let i = 0; i < k.length; i++) {
    const two = ROMAJI[k.slice(i, i + 2)] && k.slice(i, i + 2);
    const syllable = two || k[i];
    if (two) i++;
    syllables.push(syllable);
  }
  let out = "";
  syllables.forEach((s, i) => {
    const next = syllables[i + 1] ? ROMAJI[syllables[i + 1]] ?? "" : "";
    if (s === "っ") out += next.startsWith("ch") ? "t" : next[0] ?? "";
    else if (s === "ん") out += /^[aiueoy]/.test(next) ? "n'" : "n";
    else if (s === "ー") out += out.at(-1) ?? "";
    else out += ROMAJI[s] ?? s;
  });
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

// a definition as a search would be normalized (see normalize in unicode.js), without a leading "to"
const meaningKey = (text) => text.toLowerCase().replace(/[-:,]/g, " ").replace(/\s+/g, " ").trim().replace(/^to /, "");

// A radical search, like "rs:85+3": {radical, extra}, where radical is a number (with ' for a
// simplified form, like 120'), a character standing for one (水, 氵, ⺡), or "" for none (to list the
// radicals), and extra is the number of strokes beyond the radical, or null for any. Null if the
// query isn't one.
export function radicalQuery(query) {
  const match = /^\s*rs\s*:\s*(.*?)\s*$/is.exec(query);
  if (!match) return null;
  const [, radical, extra] = /^(.*?)(?:\s*[+.]\s*(-?\d+))?$/s.exec(match[1]);
  return { radical, extra: extra === undefined ? null : Number(extra) };
}

// a radical with its strokes: [radical, extra] from Unihan's kRSUnicode (like "120'.3"), or null
const splitRS = (rs) => {
  const match = /^(\d+'*)\.(-?\d+)$/.exec(rs);
  return match && [match[1], Number(match[2])];
};

export class Readings {
  constructor(text) {
    this.rows = new Map();
    this.radicals = new Map(); // radical: {radical, char, ideograph, strokes}, in order
    this.forms = new Map(); // character: radical
    let cp = 0;
    let section = null;
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("@")) {
        section = line.slice(1);
        continue;
      }
      const fields = line.split("\t");
      if (section === "radicals") {
        const [radical, char, ideograph] = fields;
        this.radicals.set(radical, { radical, char: char ? parseInt(char, 16) : null, ideograph: parseInt(ideograph, 16) });
      } else if (section === "forms") this.forms.set(parseInt(fields[0], 16), fields[1]);
      else {
        cp += parseInt(fields[0], 16);
        this.rows.set(cp, fields.slice(1));
      }
    }
    for (const r of this.radicals.values()) r.strokes = Number(this.rows.get(r.ideograph)?.[CODES.length + 1]) || null;
    this.indexes = {};
  }

  // what's known about an ideograph: its readings in each language, radical and strokes, or null
  get(cp) {
    const fields = this.rows.get(cp);
    if (!fields) return null;
    const readings = Object.fromEntries(CODES.map((code, i) => [code, fields[i] ? fields[i].split(" ") : []]));
    const [radical = "", strokes = "", common = "", , definition = ""] = fields.slice(CODES.length);
    return { readings, radical, strokes: Number(strokes) || null, common, definition };
  }

  // Ideographs with a definition that is exactly this search (normalized as in unicode.js, ignoring a
  // leading "to", so "strike" finds "to strike"), as {cp, meaning}: the more common first.
  define(norm) {
    if (!this.definitions) {
      this.definitions = new Map();
      for (const [cp, fields] of this.rows) {
        for (const meaning of (fields[CODES.length + 4] ?? "").split(/[;,]/)) {
          const key = meaningKey(meaning);
          if (!key) continue;
          if (!this.definitions.has(key)) this.definitions.set(key, new Map());
          if (!this.definitions.get(key).has(cp)) this.definitions.get(key).set(cp, meaning.trim());
        }
      }
    }
    const found = [...(this.definitions.get(meaningKey(norm))?.entries() ?? [])].map(([cp, meaning]) => ({ cp, meaning }));
    return found.sort((a, b) => this.commonness(a.cp, "TIJG") - this.commonness(b.cp, "TIJG") || this.frequency(b.cp) - this.frequency(a.cp) || a.cp - b.cp);
  }

  // where an ideograph comes in a list of common-character lists (their letters, best first), or the
  // list's length if it's in none, and how often it appears in Chinese
  commonness(cp, lists) {
    const flags = this.rows.get(cp)[CODES.length + 2] ?? "";
    const tier = [...lists].findIndex((c) => flags.includes(c));
    return tier < 0 ? lists.length : tier;
  }

  frequency(cp) {
    return Number(this.rows.get(cp)[CODES.length + 3]) || 0;
  }

  // The radical a search names (see radicalQuery): its number, as in @radicals, or null.
  radical(name) {
    if (/^\d+'*$/.test(name)) return this.radicals.has(name) ? name : null;
    const chars = [...name];
    return chars.length === 1 ? this.forms.get(name.codePointAt(0)) ?? null : null;
  }

  // the radical and strokes of an ideograph, as [radical, extra], or null
  radicalOf(cp) {
    const fields = this.rows.get(cp);
    return fields ? splitRS(fields[CODES.length]) : null;
  }

  // Ideographs with a radical (and, unless extra is null, that many strokes beyond it), as
  // {cp, radical, extra}: a radical without ' also finds its simplified forms (85 finds 85'), which
  // come after it; then by strokes, then the more common first.
  byRadical(radical, extra = null) {
    if (!this.byRadicalIndex) {
      this.byRadicalIndex = new Map();
      for (const cp of this.rows.keys()) {
        const rs = this.radicalOf(cp);
        if (!rs) continue;
        const base = rs[0].replace(/'+$/, "");
        if (!this.byRadicalIndex.has(base)) this.byRadicalIndex.set(base, []);
        this.byRadicalIndex.get(base).push({ cp, radical: rs[0], extra: rs[1] });
      }
    }
    const simplified = radical.includes("'");
    const found = (this.byRadicalIndex.get(radical.replace(/'+$/, "")) ?? [])
      .filter((r) => (!simplified || r.radical === radical) && (extra === null || r.extra === extra));
    const primes = (r) => r.radical.length - r.radical.replace(/'+$/, "").length;
    return found.sort((a, b) => primes(a) - primes(b) || a.extra - b.extra ||
      this.commonness(a.cp, "TIJG") - this.commonness(b.cp, "TIJG") || this.frequency(b.cp) - this.frequency(a.cp) || a.cp - b.cp);
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
        found.set(cp, { cp, reading, rank: [t, this.commonness(cp, common), -this.frequency(cp), position, cp] });
      }
    }
    const compare = (a, b) => a.rank.reduce((d, x, i) => d || x - b.rank[i], 0);
    return [...found.values()].sort(compare).map(({ cp, reading }) => ({ cp, reading }));
  }
}
