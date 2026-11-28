// Filtering the Stage playlist (a song from a musical or opera for every year from 1637 to 2024) by era
// (which of the three playlists it's from), decade and year, language, composer and a text search, with counts for
// each choice given the other filters, sorting newest or oldest first, and the selection as a URL hash.

// the eras, one for each playlist, newest first
export const ERAS = { musicals: "Musicals", operas: "Operas", baroque: "Baroque operas" };

// the filters, in the order they appear in the URL hash
export const KEYS = ["era", "decade", "year", "language", "composer", "q"];

export const decade = (year) => `${Math.floor(year / 10) * 10}s`;

// lower case without accents, so "boheme" finds Bohème
export const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// the names composers are known by, where that's not just the last word of their name
const SURNAMES = {
  "Andrew Lloyd Webber": "Lloyd Webber",
  "Élisabeth Jacquet de La Guerre": "Jacquet de La Guerre",
  "Joseph Bologne, Chevalier de Saint-Georges": "Saint-Georges",
  "Tomás de Torrejón y Velasco": "Torrejón y Velasco",
};

// "Wolfgang Amadeus Mozart" → "Mozart", "Johann Strauss II" → "Strauss II", "Andrew Lloyd Webber" →
// "Lloyd Webber"
export function surname(name) {
  if (name in SURNAMES) return SURNAMES[name];
  const words = name.split(" ");
  return words.slice(words.length > 2 && /^(I+|Jr\.)$/.test(words.at(-1)) ? -2 : -1).join(" ");
}

// what the search covers: just what the cards show in words (not the performers or album, or the
// language, which only shows as a flag)
const searchText = (song) => fold([song.song, song.work, ...song.composers, String(song.year), ERAS[song.era]].filter(Boolean).join("\n"));

// whether some word in text starts with word ("kander" finds Kander but not Iskander)
const startsWord = (text, word) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u").test(text);

// Whether a song passes the filters in selection, ignoring the one named skip (for facet counts).
export function matches(song, selection, skip = null) {
  const { era, language, composer, q } = selection;
  if (era && skip !== "era" && song.era !== era) return false;
  if (selection.decade && skip !== "decade" && decade(song.year) !== selection.decade) return false;
  if (selection.year && skip !== "decade" && skip !== "year" && String(song.year) !== selection.year) return false;
  if (language && skip !== "language" && song.language !== language) return false;
  if (composer && skip !== "composer" && !song.composers.includes(composer)) return false;
  if (q && skip !== "q") {
    const text = searchText(song);
    if (!fold(q).split(/\s+/).filter(Boolean).every((word) => startsWord(text, word))) return false;
  }
  return true;
}

export const filterSongs = (songs, selection) => songs.filter((song) => matches(song, selection));

// newest first (as the playlists are), or oldest first
export const sortSongs = (songs, sort) => [...songs].sort((a, b) => (sort === "oldest" ? a.year - b.year : b.year - a.year));

const VALUES = {
  era: (song) => [song.era],
  decade: (song) => [decade(song.year)],
  year: (song) => [String(song.year)],
  language: (song) => [song.language],
  composer: (song) => song.composers,
};

// The number of songs for each value of a facet ("era", "decade", "year", "language" or "composer") among the songs
// that pass the other filters (for decades, ignoring the year too), counting a song for each composer.
export function counts(songs, selection, facet) {
  const result = new Map();
  for (const song of songs) {
    if (!matches(song, selection, facet)) continue;
    for (const value of VALUES[facet](song)) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

// the selection as a URL hash (#era=operas&decade=1780s&composer=Antonio+Salieri&sort=oldest), and back
export function toHash(selection) {
  const params = new URLSearchParams();
  for (const key of KEYS) if (selection[key]) params.set(key, selection[key]);
  if (selection.sort) params.set("sort", selection.sort);
  const s = params.toString();
  return s ? `#${s}` : "";
}

export function fromHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const selection = {};
  for (const key of KEYS) selection[key] = params.get(key) || null;
  selection.sort = params.get("sort") === "oldest" ? "oldest" : null;
  if (selection.era && !(selection.era in ERAS)) selection.era = null;
  if (selection.decade && !/^\d{3}0s$/.test(selection.decade)) selection.decade = null;
  // a year needs its decade
  if (selection.year && !(/^\d{4}$/.test(selection.year) && decade(Number(selection.year)) === selection.decade)) selection.year = null;
  return selection;
}
