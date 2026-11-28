// Filtering the Classical playlist's pairs (a pop song and the classical piece it's based on) by section
// (adaptations or samples), composer and a text search, with counts for each choice given the other
// filters, and the selection as a URL hash.

export const SECTIONS = { adaptation: "Adaptations", sample: "Samples" };

// the filters, in the order they appear in the URL hash
export const KEYS = ["section", "composer", "q"];

// lower case without accents, so "dvorak" finds Dvořák
export const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// "Johann Sebastian Bach" → "Bach", "Ludwig van Beethoven" → "Beethoven", "Eduardo di Capua" → "di Capua"
export function surname(name) {
  const words = name.split(" ");
  const i = words.length > 2 && /^(di|de|da|del)$/.test(words.at(-2)) ? words.length - 2 : words.length - 1;
  return words.slice(i).join(" ");
}

const searchText = (pair) => fold([...pair.composers, ...[pair.pop, pair.piece].flatMap((t) => [t.song, t.artist, t.album])]
  .filter(Boolean).join("\n"));

// Whether a pair passes the filters in selection, ignoring the one named skip (for facet counts).
export function matches(pair, selection, skip = null) {
  const { section, composer, q } = selection;
  if (section && skip !== "section" && pair.section !== section) return false;
  if (composer && skip !== "composer" && !pair.composers.includes(composer)) return false;
  if (q && skip !== "q") {
    const text = searchText(pair);
    if (!fold(q).split(/\s+/).filter(Boolean).every((word) => text.includes(word))) return false;
  }
  return true;
}

export const filterPairs = (pairs, selection) => pairs.filter((pair) => matches(pair, selection));

// The number of pairs for each value of a facet ("section" or "composer") among the pairs that pass the
// other filters, counting a pair for each of its composers.
export function counts(pairs, selection, facet) {
  const result = new Map();
  for (const pair of pairs) {
    if (!matches(pair, selection, facet)) continue;
    for (const value of facet === "section" ? [pair.section] : pair.composers) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

// the selection as a URL hash (#section=sample&composer=Johann+Sebastian+Bach), and back
export function toHash(selection) {
  const params = new URLSearchParams();
  for (const key of KEYS) if (selection[key]) params.set(key, selection[key]);
  const s = params.toString();
  return s ? `#${s}` : "";
}

export function fromHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const selection = {};
  for (const key of KEYS) selection[key] = params.get(key) || null;
  if (selection.section && !(selection.section in SECTIONS)) selection.section = null;
  return selection;
}
