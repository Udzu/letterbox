// Filtering the Jewish Christmas songs (or the Gentile Hanukkah ones) by language, songwriter nationality,
// decade (and year), songwriters (just Jewish ones, or with non-Jewish co-writers, and the other way round
// for Hanukkah), a songwriter and a text search, with counts for each choice given the other filters, and
// the selection as a URL hash. The selection's list is "hanukkah" for the Hanukkah songs, or null.

// the filters, in the order they appear in the URL hash
export const KEYS = ["language", "nationality", "decade", "year", "team", "writer", "q"];

export const TEAMS = {
  christmas: { jewish: "Only Jewish songwriters", mixed: "With non-Jewish co-writers" },
  hanukkah: { gentile: "Only Gentile songwriters", mixed: "With Jewish co-writers" },
};
export const teams = (list) => TEAMS[list ?? "christmas"];

// "1950s", or "Before 1900" for the few older songs
export const decade = (year) => (year < 1900 ? "Before 1900" : `${Math.floor(year / 10) * 10}s`);
export const team = (song, list) => (song.mixed ? "mixed" : list === "hanukkah" ? "gentile" : "jewish");

// the year as shown: "~1450" for an approximate one
export const yearText = (song) => `${song.approx ? "~" : ""}${song.year}`;

// lower case without accents, so "noel" finds Noël
export const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// what the search covers: just what the cards show in words (the language and nationality only show as
// flags, so are left to the filters)
const searchText = (song) => fold([song.song, song.artist, ...song.writers, song.note, yearText(song)].filter(Boolean).join("\n"));

// "A, B & C Smith (a note)" → { writers: ["A", "B Smith", "C Smith"], note: "(a note)" }: songwriters
// as written in the sheet, split into names, with any note in brackets at the end kept apart
export function parseWriters(text) {
  const note = text.match(/\s*(\(.*\))\s*$/);
  const names = (note ? text.slice(0, note.index) : text).split(",").map((s) => s.trim()).filter(Boolean);
  const writers = names.flatMap((name) => {
    const pair = name.match(/^(\S+) (?:&|and) (\S+) (.+)$/); // first names sharing a surname
    return pair ? [`${pair[1]} ${pair[3]}`, `${pair[2]} ${pair[3]}`] : [name];
  });
  return { writers, note: note ? note[1] : null };
}

// Whether a song passes the filters in selection, ignoring the one named skip (for facet counts).
export function matches(song, selection, skip = null) {
  const { language, nationality, q } = selection;
  if (language && skip !== "language" && song.language !== language) return false;
  if (nationality && skip !== "nationality" && song.nationality !== nationality) return false;
  if (selection.decade && skip !== "decade" && decade(song.year) !== selection.decade) return false;
  if (selection.year && skip !== "decade" && skip !== "year" && String(song.year) !== selection.year) return false;
  if (selection.team && skip !== "team" && team(song, selection.list) !== selection.team) return false;
  if (selection.writer && skip !== "writer" && !song.writers.includes(selection.writer)) return false;
  if (q && skip !== "q") {
    const text = searchText(song);
    if (!fold(q).split(/\s+/).filter(Boolean).every((word) => text.includes(word))) return false;
  }
  return true;
}

export const filterSongs = (songs, selection) => songs.filter((song) => matches(song, selection));

const VALUES = {
  language: (song) => [song.language],
  nationality: (song) => [song.nationality],
  decade: (song) => [decade(song.year)],
  year: (song) => [String(song.year)],
  team: (song, list) => [team(song, list)],
  writer: (song) => song.writers,
};

// The number of songs for each value of a facet ("language", "nationality", "decade", "year", "team"
// or "writer") among the songs that pass the other filters (for decades, ignoring the year too).
export function counts(songs, selection, facet) {
  const result = new Map();
  for (const song of songs) {
    if (!matches(song, selection, facet)) continue;
    for (const value of VALUES[facet](song, selection.list)) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

// the selection as a URL hash (#language=French&decade=1960s, or #hanukkah&decade=1990s), and back
export function toHash(selection) {
  const params = new URLSearchParams();
  for (const key of KEYS) if (selection[key]) params.set(key, selection[key]);
  const s = [selection.list === "hanukkah" ? "hanukkah" : "", params.toString()].filter(Boolean).join("&");
  return s ? `#${s}` : "";
}

export function fromHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const selection = { list: params.has("hanukkah") ? "hanukkah" : null };
  for (const key of KEYS) selection[key] = params.get(key) || null;
  if (selection.team && !(selection.team in teams(selection.list))) selection.team = null;
  // a year needs its decade
  if (selection.year && !(/^\d{4}$/.test(selection.year) && decade(Number(selection.year)) === selection.decade)) selection.year = null;
  return selection;
}
