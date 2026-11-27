// Filtering a Countries playlist by continent, country and a text search, with counts for each choice
// given the other filters, and the selection as a URL hash. A song can map to several modern countries
// (Prussia: Germany and Poland), and matches any of them. The selection's list is "jazz" for the
// Jazz Countries playlist, or null for Independent Nations.

export const CONTINENTS = {
  AF: "Africa",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
};

// the filters, in the order they appear in the URL hash
export const KEYS = ["continent", "country", "q"];

// lower case without accents, so "sao tome" finds São Tomé
export const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const searchText = (song) => fold([song.name, ...song.countries, song.song, song.artist, song.album].filter(Boolean).join("\n"));

// Whether a song passes the filters in selection, ignoring the one named skip (for facet counts).
export function matches(song, selection, skip = null) {
  const { continent, country, q } = selection;
  if (continent && skip !== "continent" && !song.continents.includes(continent)) return false;
  if (country && skip !== "country" && !song.countries.includes(country)) return false;
  if (q && skip !== "q") {
    const text = searchText(song);
    if (!fold(q).split(/\s+/).filter(Boolean).every((word) => text.includes(word))) return false;
  }
  return true;
}

export const filterSongs = (songs, selection) => songs.filter((song) => matches(song, selection));

// The number of songs for each value of a facet ("continent" or "country") among the songs that pass
// the other filters, counting a song for each of its values.
export function counts(songs, selection, facet) {
  const result = new Map();
  for (const song of songs) {
    if (!matches(song, selection, facet)) continue;
    for (const value of facet === "country" ? song.countries : song.continents) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

// the selection as a URL hash (#continent=EU&q=love, or #jazz&continent=EU), and back
export function toHash(selection) {
  const params = new URLSearchParams();
  for (const key of KEYS) if (selection[key]) params.set(key, selection[key]);
  const s = [selection.list === "jazz" ? "jazz" : "", params.toString()].filter(Boolean).join("&");
  return s ? `#${s}` : "";
}

export function fromHash(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const selection = { list: params.has("jazz") ? "jazz" : null };
  for (const key of KEYS) selection[key] = params.get(key) || null;
  if (selection.continent && !(selection.continent in CONTINENTS)) selection.continent = null;
  return selection;
}
