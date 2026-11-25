// Filtering the Lingtape songs by continent, family (and branch), country and a text search, with
// counts for each choice given the other filters, and the selection as a URL hash.

export const CONTINENTS = {
  AF: "Africa",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
};

// the filters, in the order they appear in the URL hash
export const KEYS = ["continent", "family", "branch", "country", "q"];

// lower case without accents, so "cote" finds Côte d'Ivoire and "sami" finds Sámi
export const fold = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const searchText = (song) => fold([song.language, song.iso, song.family, song.branch, song.country, song.song, song.artist].filter(Boolean).join("\n"));

// Whether a song passes the filters in selection, ignoring the one named skip (for facet counts).
export function matches(song, selection, skip = null) {
  const { continent, family, branch, country, q } = selection;
  if (continent && skip !== "continent" && song.continent !== continent) return false;
  if (family && skip !== "family" && song.family !== family) return false;
  if (branch && skip !== "family" && song.branch !== branch) return false;
  if (country && skip !== "country" && song.country !== country) return false;
  if (q && skip !== "q") {
    const text = searchText(song);
    if (!fold(q).split(/\s+/).filter(Boolean).every((word) => text.includes(word))) return false;
  }
  return true;
}

export const filterSongs = (songs, selection) => songs.filter((song) => matches(song, selection));

// The number of songs for each value of a facet ("continent", "family", "branch" or "country") among
// the songs that pass the other filters (for branches, those of the selected family).
export function counts(songs, selection, facet) {
  const skip = facet === "branch" ? "family" : facet;
  const result = new Map();
  for (const song of songs) {
    if (!matches(song, selection, skip)) continue;
    if (facet === "branch" && song.family !== selection.family) continue;
    const value = song[facet];
    if (value) result.set(value, (result.get(value) ?? 0) + 1);
  }
  return result;
}

// the selection as a URL hash (#continent=EU&family=Indo-European), and back
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
  if (!selection.family) selection.branch = null;
  return selection;
}

// YouTube links that play the given videos as an unnamed playlist, at most 50 per link (YouTube's
// limit), as [{ from, to, url }] with 1-based positions.
export const PLAYLIST_LIMIT = 50;
export function playlistLinks(videos) {
  const links = [];
  for (let i = 0; i < videos.length; i += PLAYLIST_LIMIT) {
    const chunk = videos.slice(i, i + PLAYLIST_LIMIT);
    links.push({ from: i + 1, to: i + chunk.length, url: `https://www.youtube.com/watch_videos?video_ids=${chunk.join(",")}` });
  }
  return links;
}
