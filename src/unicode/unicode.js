// The Unicode page's data: parsing unicode/characters.txt (see scripts/unicode-data.py for its format),
// naming any codepoint, and searching characters and sequences by name.

const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, "0");
export const codepoints = (cps) => cps.map((cp) => `U+${hex(cp)}`).join(" ");
const parseSeq = (field) => field.split(" ").map((h) => parseInt(h, 16));
const key = (cps) => cps.filter((cp) => cp !== 0xfe0f).join(" ");

export const TONES = [0x1f3fb, 0x1f3fc, 0x1f3fd, 0x1f3fe, 0x1f3ff];

// the major general categories, for filtering
export const CATEGORIES = { L: "Letters", M: "Marks", N: "Numbers", P: "Punctuation", S: "Symbols", Z: "Separators", C: "Other" };

// how to describe a match on each kind of alias (see NameAliases.txt)
export const ALIAS_TYPES = {
  correction: "corrected name",
  control: "control name",
  alternate: "alternate name",
  figment: "unapproved name",
  abbreviation: "abbreviation",
};

// Hangul syllable names, from their jamo (Unicode chapter 3.12)
const JAMO_L = ["G", "GG", "N", "D", "DD", "R", "M", "B", "BB", "S", "SS", "", "J", "JJ", "C", "K", "T", "P", "H"];
const JAMO_V = ["A", "AE", "YA", "YAE", "EO", "E", "YEO", "YE", "O", "WA", "WAE", "OE", "YO", "U", "WEO", "WE", "WI", "YU", "EU", "YI", "I"];
const JAMO_T = ["", "G", "GG", "GS", "N", "NJ", "NH", "D", "L", "LG", "LM", "LB", "LS", "LT", "LP", "LH", "M", "B", "BS", "S", "SS", "NG", "J", "C", "K", "T", "P", "H"];
function hangulName(cp) {
  const s = cp - 0xac00;
  return `HANGUL SYLLABLE ${JAMO_L[Math.floor(s / 588)]}${JAMO_V[Math.floor((s % 588) / 28)]}${JAMO_T[s % 28]}`;
}

// The name of a codepoint in a @ranges row: the prefix and its hex codepoint, a number counted from
// the first codepoint, a Hangul syllable name, or none.
function rangeName(range, cp) {
  const { name, first } = range;
  if (name === "hangul") return hangulName(cp);
  const number = name.indexOf("#");
  if (number < 0) return name && name + hex(cp);
  const start = name.slice(number + 1);
  return name.slice(0, number) + String(Number(start) + cp - first).padStart(start.length, "0");
}

// the value of the range containing cp, in a sorted list of {first, last}, by binary search
function inRanges(ranges, cp) {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid].first) hi = mid - 1;
    else if (cp > ranges[mid].last) lo = mid + 1;
    else return ranges[mid];
  }
  return null;
}

// Search text: lowercase, with hyphens, colons and commas as spaces, so that "no break" finds
// NO-BREAK SPACE and "flag wales" finds "flag: Wales".
export const normalize = (text) => text.toLowerCase().replace(/[-:,]/g, " ").replace(/\s+/g, " ").trim();

// How well a search term matches a label (normalized, with a space at each end): whole word 0, start
// of a word 1, inside a word 2.
function termLevel(label, term) {
  if (label.includes(` ${term} `)) return 0;
  return label.includes(` ${term}`) ? 1 : 2;
}

// How a search's terms match keywords: each term must be a whole word (level 0) or the start of a word
// (level 1) in some keyword. Returns null, or the worst level as the rank and a label listing the best
// keyword for each term.
function keywordMatch(keywords, terms) {
  const used = [];
  let rank = 0;
  for (const term of terms) {
    let best = null;
    for (const k of keywords) {
      if (!k.norm.includes(` ${term}`)) continue;
      const level = termLevel(k.norm, term);
      if (!best || level < best.level || (level === best.level && k.norm.length < best.k.norm.length)) best = { k, level };
    }
    if (!best) return null;
    rank = Math.max(rank, best.level);
    if (!used.includes(best.k)) used.push(best.k);
  }
  const text = used.map((k) => k.text).join(", ");
  return { rank, label: { kind: KEYWORDS, text, norm: ` ${used.map((k) => k.norm.trim()).join(" ")} ` } };
}

// Default ignorable characters that show nothing: variation selectors, tags and the like.
export const INVISIBLE = /^[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\u{1bca0}-\u{1bca3}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}]$/u;

// Whether an entry shows nothing, or only space: a space, control, format character or other default
// ignorable character (such as a variation selector).
export function isInvisible(entry) {
  return entry.cps.length === 1 && (/^C[cfsno]|^Z/.test(entry.gc) || INVISIBLE.test(String.fromCodePoint(entry.cps[0])));
}

// Whether an entry is more than one character (not counting an emoji presentation selector).
export const isSequence = (entry) => entry.cps.filter((cp) => cp !== 0xfe0f).length > 1;

// The kinds of label an entry can be found by, best first: its name, emoji name, aliases, CLDR short
// name (like "euro") and CLDR keywords.
const NAME = 0;
export const EMOJI = 1;
const ALIAS = 2;
export const SHORT = 3;
export const KEYWORDS = 4;

export class Unicode {
  constructor(text) {
    const sections = {};
    let rows = null;
    for (const line of text.split("\n")) {
      if (line.startsWith("@")) sections[line.slice(1)] = rows = [];
      else if (line && !line.startsWith("#") && rows) rows.push(line.split("\t"));
    }
    const range = ([first, last, ...rest]) => ({ first: parseInt(first, 16), last: parseInt(last, 16), rest });
    this.scriptNames = Object.fromEntries(sections.scripts);
    this.blocks = sections.blocks.map(range).map(({ first, last, rest: [name] }) => ({ first, last, name }));
    this.scripts = sections.script.map(range).map(({ first, last, rest: [code] }) => ({ first, last, code }));
    this.ages = sections.age.map(range).map(({ first, last, rest: [age] }) => ({ first, last, age }));
    this.latest = this.ages.map((a) => a.age).reduce((a, b) => (Number(b) > Number(a) ? b : a));
    this.ranges = sections.ranges.map(range).map(({ first, last, rest: [gc, name = "", flag = ""] }) => ({ first, last, gc, name, omit: flag === "omit" }));
    this.groups = sections.groups.map(([group, subgroup]) => ({ group, subgroup }));
    this.variants = sections.variants.map(([s, description]) => ({ cps: parseSeq(s), description }));

    // the listed characters
    this.chars = new Map();
    for (const [h, gc, name, aliases] of sections.chars) {
      const cp = parseInt(h, 16);
      this.chars.set(cp, {
        gc,
        name,
        aliases: aliases ? aliases.split("|").map((a) => ({ type: a.slice(0, a.indexOf(":")), alias: a.slice(a.indexOf(":") + 1) })) : [],
      });
    }

    // the searchable entries: characters (with Hangul syllables), then emoji and named sequences, each
    // sequence attached to its single character or placed after its first one
    const entries = [];
    const byKey = new Map();
    const add = (entry) => {
      entries.push(entry);
      byKey.set(key(entry.cps), entry);
      return entry;
    };
    for (const [cp, { gc, name, aliases }] of this.chars) add({ cps: [cp], name, aliases, gc });
    for (const r of this.ranges) {
      if (r.name && !r.omit) for (let cp = r.first; cp <= r.last; cp++) add(this.entry(cp));
    }
    sections.emoji.forEach(([s, name, group, version, tones, mixed], i) => {
      const cps = parseSeq(s);
      const emoji = { name, group: Number(group), version, tones: tones ? parseSeq(tones.replaceAll("*", "0")) : null, mixed: mixed ? parseSeq(mixed.replaceAll("*", "0")) : null, order: i };
      const entry = byKey.get(key(cps)) ?? add({ cps, name: "", aliases: [], gc: this.info(cps[0]).gc });
      entry.cps = cps;
      entry.emoji = emoji;
    });
    for (const [s, name] of sections.sequences) {
      const cps = parseSeq(s);
      const entry = byKey.get(key(cps)) ?? add({ cps, name: "", aliases: [], gc: this.info(cps[0]).gc });
      entry.name ||= name;
    }
    for (const [s, short, words] of sections.keywords) {
      const entry = byKey.get(key(parseSeq(s)));
      if (!entry) continue;
      if (short) entry.short = short;
      entry.keywords = words ? words.split("|").map((text) => ({ text, norm: ` ${normalize(text)} ` })) : [];
    }
    const compare = (a, b) => {
      for (let i = 0; i < Math.min(a.cps.length, b.cps.length); i++) if (a.cps[i] !== b.cps[i]) return a.cps[i] - b.cps[i];
      return a.cps.length - b.cps.length;
    };
    entries.sort(compare);
    entries.forEach((entry, i) => {
      entry.order = i;
      entry.script = this.script(entry.cps[0]);
      entry.block = this.block(entry.cps[0]);
      entry.age = entry.cps.map((cp) => this.age(cp)).reduce((a, b) => (Number(b) > Number(a) ? b : a));
      // since Emoji 11.0, emoji versions match Unicode versions
      if (entry.emoji && Number(entry.emoji.version) >= 11 && Number(entry.emoji.version) > Number(entry.age)) entry.age = entry.emoji.version;
      const labels = [];
      const label = (kind, text, type) => labels.push({ kind, text, type, norm: ` ${normalize(text)} ` });
      if (entry.name) label(NAME, entry.name);
      if (entry.emoji) label(EMOJI, entry.emoji.name);
      for (const { type, alias } of entry.aliases) label(ALIAS, alias, type);
      if (entry.short) label(SHORT, entry.short);
      entry.labels = labels;
    });
    this.entries = entries;
  }

  // what is known about any codepoint: its category and name (if it has one), aliases, and whether
  // it's left out of searches
  info(cp) {
    const char = this.chars.get(cp);
    if (char) return { ...char, omit: false };
    const range = inRanges(this.ranges, cp);
    if (range) return { gc: range.gc, name: rangeName(range, cp), aliases: [], omit: range.omit, unnamed: !range.name };
    return { gc: "Cn", name: "", aliases: [], omit: false, unassigned: true };
  }

  script(cp) {
    return inRanges(this.scripts, cp)?.code ?? "Zzzz";
  }

  block(cp) {
    return inRanges(this.blocks, cp)?.name ?? "No block";
  }

  age(cp) {
    return inRanges(this.ages, cp)?.age ?? "";
  }

  // an entry for a single codepoint (searchable or not)
  entry(cp) {
    const { gc, name, aliases, omit, unassigned, unnamed } = this.info(cp);
    return { cps: [cp], name, aliases, gc, omit, unassigned, unnamed };
  }

  // Entries matching a search, each with the label it matched by (null when listed by filters
  // alone or looked up directly), best first. Each term of the query must be found in the same
  // label (a name, emoji name, alias or short name), or else each term must be a whole word or the
  // start of a word in one of the entry's keywords (which can differ between terms, so "happy cry"
  // finds 😂 by "happy" and "crying"); a keyword match is then a label listing the keywords used.
  // Results are ranked by how well the worst term matches (the whole label first, then whole words,
  // then starts of words, then anywhere), then by the kind of label (names first, keywords last),
  // then shorter labels first. A codepoint (U+1F600) or non-ASCII text is looked up directly.
  search(query, filter = () => true) {
    const direct = this.lookup(query);
    if (direct) return direct.map((entry) => ({ entry, label: null }));
    const norm = normalize(query);
    if (!norm) return this.entries.filter(filter).map((entry) => ({ entry, label: null }));
    const terms = [...new Set(norm.split(" "))];
    const found = [];
    for (const entry of this.entries) {
      let best = null;
      for (const label of entry.labels) {
        if (!terms.every((t) => label.norm.includes(t))) continue;
        const rank = label.norm === ` ${norm} ` ? -1 : Math.max(...terms.map((t) => termLevel(label.norm, t)));
        if (!best || rank < best.rank || (rank === best.rank && label.kind < best.label.kind)) best = { rank, label };
      }
      if (entry.keywords && !(best?.rank <= 0)) {
        const keywords = keywordMatch(entry.keywords, terms);
        if (keywords && !(best?.rank <= keywords.rank)) best = keywords;
      }
      if (best && filter(entry)) found.push({ entry, label: best.label, rank: best.rank });
    }
    const words = (label) => label.norm.split(" ").length;
    return found.sort((a, b) => a.rank - b.rank || a.label.kind - b.label.kind || words(a.label) - words(b.label) || a.entry.order - b.entry.order);
  }

  // A direct lookup: a codepoint like U+1F600, or text with non-ASCII characters, or null. Text is
  // split into graphemes: one that is an emoji or named sequence (or a skin-tone variant of one) is
  // a single result, and any other is split into its codepoints. Repeats are left out.
  lookup(query) {
    const text = query.trim();
    const code = /^u\+([0-9a-f]{1,6})$/i.exec(text);
    if (code) {
      const cp = parseInt(code[1], 16);
      return cp <= 0x10ffff ? [this.find([cp]) ?? this.entry(cp)] : [];
    }
    if (!/[^\x00-\x7f]/.test(text)) return null;
    const found = new Map();
    const add = (entry) => found.has(key(entry.cps)) || found.set(key(entry.cps), entry);
    for (const { segment } of new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)) {
      const cps = [...segment].map((c) => c.codePointAt(0));
      const whole = cps.length > 1 && (this.find(cps) ?? this.findToned(cps));
      if (whole) add(whole);
      else for (const cp of cps) add(this.find([cp]) ?? this.entry(cp));
    }
    return [...found.values()];
  }

  // the searchable entry with these codepoints (ignoring emoji presentation selectors), if any
  find(cps) {
    this.byKey ??= new Map(this.entries.map((e) => [key(e.cps), e]));
    return this.byKey.get(key(cps)) ?? null;
  }

  // the emoji with tones these codepoints are a skin-tone variant of, as that variant, if any
  findToned(cps) {
    const untoned = cps.filter((cp) => !TONES.includes(cp));
    if (untoned.length === cps.length) return null;
    const tones = cps.filter((cp) => TONES.includes(cp));
    const entry = this.entries.find((e) => e.emoji?.tones && withTones(e, tones) && key(withTones(e, tones)) === key(cps));
    return entry ? { ...entry, cps } : null;
  }

  // the variation sequences for a character
  variantsOf(cp) {
    return this.variants.filter((v) => v.cps[0] === cp);
  }
}

// An emoji with a skin tone: the tone template with every tone slot filled. Entries without tones are
// returned unchanged.
export function withTone(entry, tone) {
  const template = entry.emoji?.tones;
  if (!tone || !template) return entry.cps;
  return template.map((cp) => (cp === 0 ? tone : cp));
}

// An emoji with a tone for each person in turn: its single-tone form if they're all the same, its
// mixed template filled in if they differ, or null if it has no such form.
export function withTones(entry, tones) {
  if (tones.every((t) => t === tones[0])) return withTone(entry, tones[0]);
  if (!entry.emoji?.mixed || entry.emoji.mixed.filter((cp) => cp === 0).length !== tones.length) return null;
  let i = 0;
  return entry.emoji.mixed.map((cp) => (cp === 0 ? tones[i++] : cp));
}

// The name to show for an entry: its name, or its emoji name, or (for controls) its first alias.
export function displayName(entry) {
  return entry.name || entry.emoji?.name || entry.aliases[0]?.alias || "";
}
