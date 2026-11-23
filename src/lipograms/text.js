// The Lipograms page's text logic: folding letters, finding words, checking word lengths
// against a sequence (Pilish), acrostics, and which word list entries fit what comes next.

// Letters that don't decompose into a base letter and accents, and what they count as. The
// single letters are the ones the Patterns page's (?d:...) also treats as unaccented; the
// Anagrams and Pangrams pages have the same table.
const UNDECOMPOSED = { ø: "o", ł: "l", đ: "d", ı: "i", ħ: "h", ŧ: "t", æ: "ae", œ: "oe", ß: "ss" };

// the case-insensitive and accent-insensitive letters a character counts as (É → e), which
// can be two for letters like œ (so œ breaks a lipogram in e)
export const fold = (ch) => [...ch.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")].flatMap((c) => [...(UNDECOMPOSED[c] ?? c)]);

// The letters a box of avoided letters stands for (folded, ignoring whitespace), in the
// order first seen.
export function avoidedLetters(value) {
  const out = new Set();
  for (const ch of value) if (!/\s/.test(ch)) for (const f of fold(ch)) out.add(f);
  return [...out];
}

// Words are runs of letters and digits (accents and other marks aren't counted).
// Apostrophes are dropped without ending the word (don't = 4); anything else
// ends it (fun-filled = 3 6), as in Alphanumeric Pilish.
const isWordChar = (ch) => /[\p{L}\p{N}]/u.test(ch);
const isSilent = (ch) => /['’\p{M}]/u.test(ch);

// The words of a text: { start, end, last, length, line } for each, where `start` and `end`
// are string indexes, `last` is where the last letter (or digit) starts and `line` counts
// from 0.
export function findWords(value) {
  const words = [];
  let line = 0, word = null, index = 0;
  for (const ch of value) {
    if (isWordChar(ch)) {
      if (word === null) word = { start: index, length: 0, line };
      word.length++;
      word.last = index;
      word.end = index + ch.length;
    } else if (isSilent(ch) && word !== null) {
      // part of the word, but not counted
    } else if (!isSilent(ch)) {
      if (word !== null) words.push(word);
      word = null;
      if (ch === "\n") line++;
    }
    index += ch.length;
  }
  if (word !== null) words.push(word);
  return words;
}

// The index of the word (from findWords) that a cursor at string index `caret` is in or
// just after, with at least one of its letters before the cursor, or -1 if none.
export const wordAt = (words, caret) => words.findIndex((w) => w.start < caret && caret <= w.end);

// The letter (or digit) at index i of the text, with any accents after it, in capitals: ß
// becomes ẞ, and letters with no single capital (such as the ligature ﬁ) stay as they are.
export function capitalAt(value, i) {
  const letter = value.slice(i).match(/^.\p{M}*/su)[0].normalize("NFC");
  if (letter === "ß") return "ẞ";
  const upper = letter.toUpperCase();
  return [...upper.normalize("NFC")].length === [...letter].length ? upper : letter;
}

// The acrostic of the text: the first (or last) letters of its words, a row for each line
// with words, or of its lines, as one row with a space for each run of blank lines (lines
// with something but no words, such as "* * *", are skipped).
export function acrostic(value, words, which, unit) {
  const letterOf = (word) => capitalAt(value, which === "first" ? word.start : word.last);
  const byLine = new Map();
  for (const word of words) {
    if (!byLine.has(word.line)) byLine.set(word.line, []);
    byLine.get(word.line).push(word);
  }
  if (unit === "words") return [...byLine.values()].map((ws) => ws.map(letterOf).join(""));
  let row = "";
  value.split("\n").forEach((line, i) => {
    const ws = byLine.get(i);
    if (ws) row += letterOf(which === "first" ? ws[0] : ws.at(-1));
    else if (line.trim() === "" && row !== "" && !row.endsWith(" ")) row += " ";
  });
  return [row.trimEnd()];
}

// Digits of the constants (as strings, starting "31415…"), worked out with
// integers scaled up by 10^(DIGITS + 10), the extra 10 digits absorbing rounding.
export const DIGITS = 10000;
const SCALE = 10n ** BigInt(DIGITS + 10);
const digitsOf = (n) => n.toString().slice(0, DIGITS);

// π/4 = 4 arctan(1/5) − arctan(1/239) (Machin's formula)
function computePi() {
  const arctanInverse = (x) => {
    const x2 = BigInt(x * x);
    let term = SCALE / BigInt(x), sum = term;
    for (let k = 3n, sign = -1n; term !== 0n; k += 2n, sign = -sign) {
      term /= x2;
      sum += sign * (term / k);
    }
    return sum;
  };
  return digitsOf(4n * (4n * arctanInverse(5) - arctanInverse(239)));
}

// e = 1/0! + 1/1! + 1/2! + …
function computeE() {
  let term = SCALE, sum = 0n;
  for (let k = 1n; term !== 0n; k++) {
    sum += term;
    term /= k;
  }
  return digitsOf(sum);
}

// φ = (1 + √5) / 2, with the square root by Newton's method
function computePhi() {
  const n = 5n * SCALE * SCALE;
  let x = 3n * SCALE, y = (x + n / x) / 2n;
  while (y < x) [x, y] = [y, (y + n / y) / 2n];
  return digitsOf((SCALE + x) / 2n);
}

const CONSTANTS = {
  pi: { name: "π", compute: computePi },
  e: { name: "e", compute: computeE },
  phi: { name: "φ", compute: computePhi },
};

// What the word lengths are checked against: { digits } for a number read digit by
// digit as in Pilish, or { lengths } for a list of exact lengths. `finite` is false
// for the constants, which go on beyond the digits worked out here.
export function sequenceFor(choice, customText) {
  const constant = CONSTANTS[choice];
  if (constant) {
    constant.digits ??= constant.compute();
    return { digits: constant.digits, name: constant.name, finite: false };
  }
  if (choice !== "custom") return null;
  const custom = customText.trim();
  // with no numbers, the lengths are just shown, without checking them
  if (custom === "") return { unchecked: true };
  // a single number, like 1.4142135, is read digit by digit
  if (/^(\d+\.?\d*|\.\d+)$/.test(custom)) return { digits: custom.replace(".", ""), name: "your number", finite: true };
  const parts = custom.split(/[\s,;]+/);
  const bad = parts.find((part) => !/^\d+$/.test(part) || Number(part) === 0);
  if (bad !== undefined) return { error: `“${bad}” isn't a word length.` };
  return { lengths: parts.map(Number), finite: true };
}

// Whether a sequence can be checked against (not missing, unchecked or invalid).
export const checkable = (seq) => seq !== null && !seq.error && !seq.unchecked;

// How many words match, and how far along the sequence they get (`used`: digits or
// lengths). For digits, Standard Pilish: a word of n < 10 letters stands for n,
// 10 letters for 0, and more than 10 letters for two digits (12 → 1, 2).
export function check(words, seq) {
  let used = 0;
  for (let i = 0; i < words.length; i++) {
    const n = words[i].length;
    if (seq.lengths) {
      if (used >= seq.lengths.length || n !== seq.lengths[used]) return { matched: i, used, wrong: true };
      used++;
      continue;
    }
    const wanted = n === 10 ? "0" : String(n);
    if (used + wanted.length > seq.digits.length) return { matched: i, used, wrong: seq.finite, beyond: !seq.finite };
    if (seq.digits.slice(used, used + wanted.length) !== wanted) return { matched: i, used, wrong: true };
    used += wanted.length;
  }
  return { matched: words.length, used };
}

// The next few word lengths, reading one word per digit (10 letters for 0) or per
// length, followed by "…" if the sequence goes on after them. Empty at the end.
export function upcoming(seq, used, count = 7) {
  const all = seq.lengths ? seq.lengths.map(String) : [...seq.digits];
  const lengths = all.slice(used, used + count).map((d) => (d === "0" && !seq.lengths ? "10" : d));
  if (used + count < all.length || (!seq.finite && lengths.length > 0)) lengths.push("…");
  return lengths;
}

// The rest of a sequence after `used` digits or lengths, which the next words must match.
export const restOf = (seq, used) =>
  seq.lengths ? { ...seq, lengths: seq.lengths.slice(used) } : { ...seq, digits: seq.digits.slice(used) };

// The lengths the next word can have, given the rest of a sequence (from restOf): the next
// length, or for digits, the next digit (10 letters for 0) or, as in Standard Pilish, a
// word of more than 10 letters standing for it and the digit after it (1, 4 → 1 or 14).
export function nextLengths(rest) {
  if (rest.lengths) return rest.lengths.slice(0, 1);
  if (rest.digits === "") return [];
  const d = Number(rest.digits[0]);
  const two = Number(rest.digits.slice(0, 2));
  return [d === 0 ? 10 : d, ...(d > 0 && rest.digits.length > 1 && two > 10 ? [two] : [])];
}

// What the word list filter needs to know about an entry, or null if it has no words: its
// words (with their lengths, as the text counts them), all the characters it uses (folded,
// so "Éa" has "ea"), and just its letters and digits (folded, so "Don't!" has "dont"), for
// matching the start and end.
export function entryInfo(entry) {
  const words = findWords(entry);
  if (words.length === 0) return null;
  const letters = [...entry].flatMap(fold).join("");
  return { entry, words, letters, plain: plainLetters(entry) };
}

// The letters and digits of some text, folded, without anything else ("-ING" → "ing").
export const plainLetters = (value) => [...value].flatMap(fold).filter(isWordChar).join("");

// A test for which entries' infos fit: none of the `avoided` letters, letters they start and
// end with (folded, from plainLetters, "" for any; `typed` is the start of a word being typed,
// which they must also start with), and, if `rest` is a sequence, words whose lengths match its
// start (so a phrase must match as many lengths as it has words).
export function entryFilter({ avoided = [], first = "", last = "", typed = "", rest = null }) {
  return (info) =>
    avoided.every((f) => !info.letters.includes(f)) &&
    info.plain.startsWith(first) &&
    info.plain.startsWith(typed) &&
    info.plain.endsWith(last) &&
    (rest === null || isPrefix(info.words, rest));
}

function isPrefix(words, rest) {
  const result = check(words, rest);
  return result.matched === words.length;
}
