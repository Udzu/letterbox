// Build the data for the Countries page: playlists of songs named after countries, and a world map.
//
// Usage: node scripts/countries-data.mjs COUNTRIES_50M_JSON
//
// COUNTRIES_50M_JSON is countries-50m.json from the world-atlas npm package (see world-map.mjs). The
// playlists are kept in this repo, as CSV files to edit directly:
// - src/countries/countries.csv: each modern country's name (as used in the playlists), ISO 3166 code
//   (for its flag) and continent (AF, AS, EU, NA, OC or SA)
// - src/countries/independent-nations.csv: the Independent Nations playlist, a song for each country
//   (the independent nations, and a few others: Greenland, Kosovo, Taiwan and Western Sahara),
//   with the country, song, artist, album, ISRC and YouTube link
// - src/countries/jazz.csv: the Jazz Countries playlist, likewise, but with a "Modern countries" column
//   for songs named after historical countries (Abyssinia, Prussia): the modern countries they map to,
//   separated by semicolons
// Songs without a YouTube link are left out. Writes src/countries/data.json:
// - lists: for each playlist, its songs in order, each with the country as named (name), the modern
//   countries it maps to (countries: just the country itself, unless it's historical) and their flags
//   and continents, and the song, artist, album and YouTube video ID
// - width, height, countries: the world map, with countries named as in countries.csv (see ALIASES)
// The build fails on a modern country that isn't in countries.csv or on the map, or a link it can't read.

import { readFile, writeFile } from "node:fs/promises";
import { parseCsv } from "./csv.mjs";
import { worldMap } from "./world-map.mjs";

const [topoPath] = process.argv.slice(2);
if (!topoPath) {
  console.error("Usage: node scripts/countries-data.mjs COUNTRIES_50M_JSON");
  process.exit(1);
}

const LISTS = { nations: "independent-nations.csv", jazz: "jazz.csv" };

// Natural Earth names that countries.csv names differently, and Natural Earth areas drawn as part of
// another country (as on the Lingtape map)
const ALIASES = {
  "Antigua and Barb.": "Antigua and Barbuda",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Cabo Verde": "Cape Verde",
  "Central African Rep.": "Central African Republic",
  "Côte d'Ivoire": "Ivory Coast",
  "Dem. Rep. Congo": "DR Congo",
  "Dominican Rep.": "Dominican Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "eSwatini": "Eswatini",
  "Fr. Polynesia": "French Polynesia",
  "Macedonia": "North Macedonia",
  "Marshall Is.": "Marshall Islands",
  "S. Sudan": "South Sudan",
  "Solomon Is.": "Solomon Islands",
  "Somaliland": "Somalia",
  "St. Kitts and Nevis": "Saint Kitts and Nevis",
  "St. Vin. and Gren.": "Saint Vincent and the Grenadines",
  "São Tomé and Principe": "São Tomé and Príncipe",
  "United States of America": "United States",
  "Vatican": "Vatican City",
  "W. Sahara": "Western Sahara",
};
// countries too small for the 1:50m map, at [longitude, latitude]
const POINTS = { Tuvalu: [179.2, -8.5], Gibraltar: [-5.35, 36.14] };

const src = (file) => new URL(`../src/countries/${file}`, import.meta.url);
const flag = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0)));

const places = {};
for (const [name, code, continent] of parseCsv(await readFile(src("countries.csv"), "utf8")).slice(1).map((r) => r.map((s) => s.trim()))) {
  if (!name) continue;
  if (!/^[A-Z]{2}$/.test(code) || !["AF", "AS", "EU", "NA", "OC", "SA"].includes(continent)) throw new Error(`countries.csv: bad row for ${name}`);
  places[name] = { flag: flag(code), continent };
}

const lists = {};
for (const [list, file] of Object.entries(LISTS)) {
  lists[list] = [];
  const [header, ...rows] = parseCsv(await readFile(src(file), "utf8"));
  const col = (r, name) => (r[header.indexOf(name)] ?? "").trim();
  let unlinked = 0;
  for (const r of rows) {
    const [name, song, artist, album, link] = ["Country", "Song", "Artist", "Album", "YouTube link"].map((c) => col(r, c));
    if (!song) continue;
    const countries = col(r, "Modern countries") ? col(r, "Modern countries").split(";").map((s) => s.trim()) : [name];
    for (const c of countries) if (!places[c]) throw new Error(`${file}: ${song}: unknown country ${c} (add it to countries.csv)`);
    if (!link) { unlinked++; continue; }
    const id = link.match(/youtu(?:\.be\/|be\.com\/watch\?v=)([\w-]{11})\b/);
    if (!id) throw new Error(`${file}: ${song}: unrecognised YouTube link ${link}`);
    lists[list].push({ name, countries, flags: countries.map((c) => places[c].flag),
      continents: [...new Set(countries.map((c) => places[c].continent))], song, artist, album, video: id[1] });
  }
  if (unlinked) console.log(`${file}: ${unlinked} songs without a link left out`);
}

const { width, height, countries } = worldMap(JSON.parse(await readFile(topoPath, "utf8")), { aliases: ALIASES, points: POINTS });
const names = new Set(countries.map((c) => c.name));
const missing = [...new Set(Object.values(lists).flat().flatMap((s) => s.countries).filter((c) => !names.has(c)))];
if (missing.length) {
  console.error(`Countries not on the map: ${missing.join(", ")} (add them to ALIASES or POINTS)`);
  process.exit(1);
}

const json = JSON.stringify({ lists, width, height, countries });
await writeFile(src("data.json"), json);
console.log(`Wrote src/countries/data.json: ${Object.entries(lists).map(([l, s]) => `${s.length} ${l} songs`).join(", ")}, ${countries.length} map countries, ${Math.round(json.length / 1024)} KB`);
