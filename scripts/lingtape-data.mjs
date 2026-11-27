// Build the data for the Lingtape page: the songs from the LINGTAPE sheet and a world map.
//
// Usage: node scripts/lingtape-data.mjs SHEET_CSV COUNTRIES_50M_JSON
//
// SHEET_CSV is the LINGTAPE Google Sheet exported as CSV (File > Download > CSV), and
// COUNTRIES_50M_JSON is countries-50m.json from the world-atlas npm package (Natural Earth 1:50m
// country outlines, public domain, as TopoJSON). Writes src/lingtape/data.json:
// - songs: one per language, in the sheet's order, with the language's family split into family and
//   branch ("Indo-European / Slavic"), the continent the language comes from (which needn't be its main
//   country's), and the YouTube video ID, or null for songs that aren't on YouTube.
// - width, height, countries: the world map (see world-map.mjs), with countries named as in the sheet
//   where it has songs from them (see ALIASES), and otherwise as in Natural Earth.
// The build fails if a song's country isn't on the map.

import { readFile, writeFile } from "node:fs/promises";
import { parseCsv } from "./csv.mjs";
import { worldMap } from "./world-map.mjs";

const [csvPath, topoPath] = process.argv.slice(2);
if (!csvPath || !topoPath) {
  console.error("Usage: node scripts/lingtape-data.mjs SHEET_CSV COUNTRIES_50M_JSON");
  process.exit(1);
}

// sheet country names that Natural Earth names differently, and Natural Earth areas drawn as part of
// another country
const ALIASES = {
  "Bosnia and Herz.": "Bosnia",
  "Cabo Verde": "Cape Verde",
  "Central African Rep.": "CAR",
  "Dem. Rep. Congo": "DR Congo",
  "Macedonia": "North Macedonia",
  "Papua New Guinea": "PNG",
  "S. Sudan": "South Sudan",
  "United Kingdom": "UK",
  "United States of America": "USA",
  "Vatican": "Vatican City",
  "Somaliland": "Somalia",
};

const songs = [];
for (const r of parseCsv(await readFile(csvPath, "utf8")).slice(1)) {
  const [language, iso, family, continent, country, song, artist, link] = r.map((s) => s.trim());
  if (!language) continue;
  const [fam, branch = null] = family.split(" / ");
  const id = link.match(/youtu(?:\.be\/|be\.com\/watch\?v=)([\w-]{11})\b/);
  if (!id && link !== "not found on YouTube") throw new Error(`${language}: unrecognised YouTube link ${link}`);
  songs.push({ language, iso: iso === "-" ? null : iso, family: fam, branch, continent, country: country || null, song, artist, video: id ? id[1] : null });
}

const { width, height, countries } = worldMap(JSON.parse(await readFile(topoPath, "utf8")), { aliases: ALIASES });

const names = new Set(countries.map((c) => c.name));
const missing = [...new Set(songs.map((s) => s.country).filter((c) => c && !names.has(c)))];
if (missing.length) {
  console.error(`Countries not on the map: ${missing.join(", ")} (add them to ALIASES)`);
  process.exit(1);
}

const json = JSON.stringify({ width, height, songs, countries });
await writeFile(new URL("../src/lingtape/data.json", import.meta.url), json);
console.log(`Wrote src/lingtape/data.json: ${songs.length} songs, ${countries.length} countries, ${Math.round(json.length / 1024)} KB`);
