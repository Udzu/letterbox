// The Palindromes page's word suggestions: ways to extend the words at the four ends of the
// two boxes from the word list, and what clicking one does to both boxes.
//
// The four ends, in the order they appear on the page:
//   0: the start of the forwards box, whose added letters go, reversed, at the end of the backwards box
//   1: the end of the forwards box, mirrored at the start of the backwards box
//   2: the start of the backwards box, mirrored at the end of the forwards box
//   3: the end of the backwards box, mirrored at the start of the forwards box

// letters are handled as code points, case-insensitively, as by the page's mirroring
export const isLetter = (ch) => /[\p{L}0-9]/u.test(ch);
const lettersOf = (chars) => chars.filter(isLetter).map((ch) => ch.toLowerCase()).join("");

export const ENDS = [
  { box: "left", at: "start" },
  { box: "left", at: "end" },
  { box: "right", at: "start" },
  { box: "right", at: "end" },
];

// The word at one end of a box's text, as { text, letters }, while the end is open: the text
// starts (or ends) with a letter, so typing there would extend the word. Otherwise null, so a
// space or punctuation closes an end. The word is the run of letters there, including
// apostrophes and hyphens between letters (o'cl, well-kn).
export function fragment(value, at) {
  const chars = at === "start" ? [...value] : [...value].reverse();
  if (chars.length === 0 || !isLetter(chars[0])) return null;
  let i = 1;
  while (i < chars.length && (isLetter(chars[i]) || (/['’-]/u.test(chars[i]) && isLetter(chars[i + 1] ?? "")))) i++;
  const word = chars.slice(0, i);
  if (at === "end") word.reverse();
  return { text: word.join(""), letters: lettersOf(word) };
}

// An entry's characters, its letters (lowercase) and where each letter is, for matching.
export function entryInfo(entry) {
  const chars = [...entry];
  const positions = [];
  chars.forEach((ch, i) => { if (isLetter(ch)) positions.push(i); });
  if (positions.length === 0) return null;
  return { entry, chars, positions, letters: [...lettersOf(chars)] };
}

// The entries that extend a fragment's letters at the given end of its word: at the start of a
// box (at = "start") they end with its letters, and at the end they start with them, with at
// least one more letter. Each is { entry, added, matched, mirror } in the list's order, where
// the entry's text is split into the part that is added and the part matching the fragment
// (added + matched or matched + added), and mirror is the added letters reversed, which go
// at the other end.
export function extensions(infos, letters, at) {
  const want = [...letters];
  const n = want.length;
  const out = [];
  for (const info of infos) {
    const total = info.letters.length;
    if (total <= n) continue;
    const offset = at === "start" ? total - n : 0;
    let ok = true;
    for (let i = 0; i < n; i++) {
      if (info.letters[offset + i] !== want[i]) { ok = false; break; }
    }
    if (!ok) continue;
    let added, matched, addedLetters;
    if (at === "start") {
      const cut = info.positions[total - n];
      added = info.chars.slice(0, cut).join("");
      matched = info.chars.slice(cut).join("");
      addedLetters = info.letters.slice(0, total - n);
    } else {
      const cut = info.positions[n - 1] + 1;
      matched = info.chars.slice(0, cut).join("");
      added = info.chars.slice(cut).join("");
      addedLetters = info.letters.slice(n);
    }
    out.push({ entry: info.entry, added, matched, mirror: [...addedLetters].reverse().join("") });
  }
  return out;
}

// What each end's column shows: { fragment } for an open end, whose word can be extended;
// { reversible: true } for a closed end whose paired end (the one its added letters are mirrored
// at: 0 with 3, 1 with 2) is also closed, so whole words can go at both; otherwise null. The
// words for a pair are only shown under the forwards box, as the backwards box's column would
// list the same pairs mirrored, and only once while both boxes are empty, as both pairs are
// then the same place.
export function endModes(left, right) {
  const frags = ENDS.map(({ box, at }) => fragment(box === "left" ? left : right, at));
  return ENDS.map((_, i) => {
    if (frags[i] !== null) return { fragment: frags[i] };
    if (i > 1 || frags[3 - i] !== null) return null;
    if (i === 1 && left === "" && right === "") return null;
    return { reversible: true };
  });
}

// The entries whose letters reversed are also an entry's, to add as whole words at a closed
// pair of ends, in the list's order: palindromes (madam … madam) and others (live … evil). Each
// is an extension (see extensions) that adds the whole entry, with the reversed entry as its
// mirror, and `whole` set.
export function reversibles(infos) {
  const byLetters = new Map();
  for (const info of infos) {
    const key = info.letters.join("");
    if (!byLetters.has(key)) byLetters.set(key, info);
  }
  const out = [];
  for (const info of infos) {
    const key = info.letters.join("");
    const reversed = [...info.letters].reverse().join("");
    const partner = byLetters.get(reversed);
    if (partner === undefined) continue;
    const palindrome = key === reversed;
    out.push({ entry: info.entry, added: info.entry, matched: "", mirror: palindrome ? info.entry : partner.entry, whole: true });
  }
  return out;
}

// Put letters at the start or end of a box's text. They join a word there, or follow a space,
// but are kept apart from punctuation by a space ("Panama!" + "m" → "Panama! m").
function attach(value, letters, at) {
  if (value === "") return letters;
  if (at === "start") {
    const first = [...value][0];
    return letters + (isLetter(first) || /\s/u.test(first) ? "" : " ") + value;
  }
  const last = [...value].at(-1);
  return value + (isLetter(last) || /\s/u.test(last) ? "" : " ") + letters;
}

// What both boxes become when an extension is chosen at an end: the added text goes next to
// the fragment, and its mirror at the opposite end of the other box; a whole word is kept
// apart from the box's text by a space. Returns { left, right, inserted }, where inserted is
// what was added to the end's own box.
export function extend(left, right, end, extension) {
  const { box, at } = ENDS[end];
  const own = box === "left" ? left : right;
  const other = box === "left" ? right : left;
  let inserted = extension.added;
  if (extension.whole && own !== "" && !/\s/u.test(at === "start" ? [...own][0] : [...own].at(-1))) {
    inserted = at === "start" ? inserted + " " : " " + inserted;
  }
  const grown = at === "start" ? inserted + own : own + inserted;
  const mirrored = attach(other, extension.mirror, at === "start" ? "end" : "start");
  return box === "left" ? { left: grown, right: mirrored, inserted } : { left: mirrored, right: grown, inserted };
}
