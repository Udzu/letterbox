// The Guesses game's logic: turning list entries into puzzle keys, scoring guesses,
// checking locked letters, and finding the answers that still fit.

// Letters that don't decompose into a base letter and accents, mapped to A–Z.
const UNDECOMPOSED = { ø: "o", ł: "l", đ: "d", ı: "i", ħ: "h", ŧ: "t", æ: "ae", œ: "oe", ß: "ss", þ: "th", ð: "d" };

// An entry's letters, without accents, in capitals: "Fiancée" → "FIANCEE", "a lot" → "ALOT".
// Anything that isn't a letter is dropped.
export function letters(entry) {
  const folded = [...entry.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")]
    .map((c) => UNDECOMPOSED[c] ?? c)
    .join("");
  return [...folded].filter((c) => /\p{L}/u.test(c)).join("").toUpperCase();
}

// What a puzzle needs to know about a list entry: its letters (null unless they're all
// A–Z once accents are removed) and whether it's a phrase (has spaces, hyphens, apostrophes
// or anything else that isn't a letter).
export function entryInfo(entry) {
  const key = letters(entry);
  return {
    entry,
    key: /^[A-Z]+$/.test(key) ? key : null,
    phrase: !/^\p{L}+$/u.test(entry.normalize("NFD").replace(/\p{M}/gu, "")),
  };
}

// An entry's key for a puzzle with the given settings, or null if it can't be used.
export function keyOf(entry, settings) {
  return usable(entryInfo(entry), settings) ? letters(entry) : null;
}

const usable = ({ key, phrase }, { length, phrases }) => key !== null && key.length === length && (phrases || !phrase);

// The keys among some entries' infos, each with the entries it came from (so "moon" and
// "Moon" are one answer).
export function keysOf(infos, settings) {
  const keys = new Map();
  for (const info of infos) {
    if (!usable(info, settings)) continue;
    if (!keys.has(info.key)) keys.set(info.key, []);
    keys.get(info.key).push(info.entry);
  }
  return keys;
}

// The answers and valid guesses, from the infos of the word list's and @ list's entries
// (null if there's no @ list): with an @ list, answers come from it and guesses from either
// list; otherwise both come from the word list. Without duplicates or capitals, answers
// can't repeat a letter or have a capital letter (guesses still can).
export function puzzleWords(words, at, settings) {
  const answers = keysOf(at ?? words, settings);
  const guesses = new Set(answers.keys());
  if (at) for (const key of keysOf(words, settings).keys()) guesses.add(key);
  if (settings.duplicates === false) {
    for (const key of answers.keys()) if (new Set(key).size < key.length) answers.delete(key);
  }
  // without capitals, an answer needs an entry with none, and only those are shown
  if (settings.capitals === false) {
    for (const [key, entries] of answers) {
      const lower = entries.filter((e) => !/\p{Lu}/u.test(e));
      if (lower.length) answers.set(key, lower);
      else answers.delete(key);
    }
  }
  return { answers, guesses };
}

// The colours for a guess: "g" (right letter, right place), "y" (in the answer, elsewhere)
// or "." (not in the answer, or not that many times), as in Wordle: greens first, then
// yellows from left to right while the answer has that letter left over.
export function score(guess, answer) {
  const result = Array(guess.length).fill(".");
  const left = new Map();
  for (let i = 0; i < answer.length; i++) {
    if (guess[i] === answer[i]) result[i] = "g";
    else left.set(answer[i], (left.get(answer[i]) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === "g") continue;
    const n = left.get(guess[i]) ?? 0;
    if (n > 0) {
      result[i] = "y";
      left.set(guess[i], n - 1);
    }
  }
  return result.join("");
}

const ORDINALS = ["1st", "2nd", "3rd"];
const ordinal = (n) => ORDINALS[n - 1] ?? `${n}th`;
const TIMES = ["", "", " twice", " three times", " four times"];
const times = (n) => TIMES[n] ?? ` ${n} times`;

// Why a guess breaks the locks, given the earlier guesses and their scores, or null if it
// doesn't. Locked greens must stay in place; locked yellows must be used somewhere (as
// often as they appeared in one guess, plus that guess's greens if those are locked too).
export function lockError(guess, history, { lockGreens, lockYellows }) {
  if (lockGreens) {
    for (const { guess: g, colours } of history) {
      for (let i = 0; i < g.length; i++) {
        if (colours[i] === "g" && guess[i] !== g[i]) return `The ${ordinal(i + 1)} letter must be ${g[i]}`;
      }
    }
  }
  if (lockYellows) {
    const needed = new Map();
    for (const { guess: g, colours } of history) {
      const counts = new Map();
      for (let i = 0; i < g.length; i++) {
        if (colours[i] === "y" || (lockGreens && colours[i] === "g")) counts.set(g[i], (counts.get(g[i]) ?? 0) + 1);
      }
      for (const [c, n] of counts) needed.set(c, Math.max(needed.get(c) ?? 0, n));
    }
    for (const [c, n] of needed) {
      const have = [...guess].filter((x) => x === c).length;
      if (have < n) return `The guess must use ${c}${times(n)}`;
    }
  }
  return null;
}

// The answers that fit every guess so far.
export function possible(answers, history) {
  return [...answers].filter((a) => history.every(({ guess, colours }) => score(guess, a) === colours));
}
