// Filtering the Classical playlist's pairs (a pop song and the classical piece it's based on) by section
// (adaptations or samples), the piece's era, composer and a text search, with counts for each choice
// given the other filters, sorting them by pop song or by when the piece was composed, and the selection
// (filters, sort order, and which videos the play links play) as a URL hash.

export const SECTIONS = { adaptation: "Adaptations", sample: "Samples" };

// what the play links play: each pop song followed by its piece (the default, null), or just one side
export const PLAYS = { pop: "Pop songs", piece: "Pieces" };
export const playVideos = (pairs, play) =>
  pairs.flatMap((p) => (play === "pop" ? [p.pop] : play === "piece" ? [p.piece] : [p.pop, p.piece])).map((t) => t.video).filter(Boolean);

// the eras, with their years: a piece's era is the one its year falls in, unless the playlist says
// otherwise (see scripts/classical-data.mjs)
export const ERAS = { Baroque: [1600, 1750], Classical: [1750, 1820], Romantic: [1820, 1910], Modern: [1910, null] };
export const eraOf = (year) => Object.keys(ERAS).find((era) => ERAS[era][1] == null || year < ERAS[era][1]);
export const eraYears = (era) => `${ERAS[era][0]}–${ERAS[era][1] ?? ""}`;

// the filters, in the order they appear in the URL hash
export const KEYS = ["section", "era", "composer", "q"];

// the year as shown: "~1710" for an approximate one
export const yearText = (pair) => `${pair.approx ? "~" : ""}${pair.year}`;

// lower case without accents, so "dvorak" finds Dvořák
export const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// "Johann Sebastian Bach" → "Bach", "Ludwig van Beethoven" → "Beethoven", "Eduardo di Capua" → "di Capua"
export function surname(name) {
  const words = name.split(" ");
  const i = words.length > 2 && /^(di|de|da|del)$/.test(words.at(-2)) ? words.length - 2 : words.length - 1;
  return words.slice(i).join(" ");
}

const searchText = (pair) => fold([...pair.composers, String(pair.year), ...[pair.pop, pair.piece].flatMap((t) => [t.song, t.artist, t.album])]
  .filter(Boolean).join("\n"));

// Whether a pair passes the filters in selection, ignoring the one named skip (for facet counts).
export function matches(pair, selection, skip = null) {
  const { section, era, composer, q } = selection;
  if (section && skip !== "section" && pair.section !== section) return false;
  if (era && skip !== "era" && pair.era !== era) return false;
  if (composer && skip !== "composer" && !pair.composers.includes(composer)) return false;
  if (q && skip !== "q") {
    const text = searchText(pair);
    if (!fold(q).split(/\s+/).filter(Boolean).every((word) => text.includes(word))) return false;
  }
  return true;
}

export const filterPairs = (pairs, selection) => pairs.filter((pair) => matches(pair, selection));

// sorted by when the piece was composed (keeping playlist order for the same year), or as they are
export const sortPairs = (pairs, sort) => (sort === "year" ? [...pairs].sort((a, b) => a.year - b.year) : pairs);

// The number of pairs for each value of a facet ("section", "era" or "composer") among the pairs that
// pass the other filters, counting a pair for each of its composers.
export function counts(pairs, selection, facet) {
  const result = new Map();
  for (const pair of pairs) {
    if (!matches(pair, selection, facet)) continue;
    for (const value of facet === "composer" ? pair.composers : [pair[facet]]) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

// the selection as a URL hash (#section=sample&composer=Johann+Sebastian+Bach&sort=year&play=piece), and back
export function toHash(selection) {
  const params = new URLSearchParams();
  for (const key of KEYS) if (selection[key]) params.set(key, selection[key]);
  if (selection.sort) params.set("sort", selection.sort);
  if (selection.play) params.set("play", selection.play);
  const s = params.toString();
  return s ? `#${s}` : "";
}

export function fromHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const selection = {};
  for (const key of KEYS) selection[key] = params.get(key) || null;
  selection.sort = params.get("sort") === "year" ? "year" : null;
  selection.play = params.get("play") in PLAYS ? params.get("play") : null;
  if (selection.section && !(selection.section in SECTIONS)) selection.section = null;
  if (selection.era && !(selection.era in ERAS)) selection.era = null;
  return selection;
}
