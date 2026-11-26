// Build the data for the Jewish Christmas page: the songs from the Jewish Christmas Songs sheet.
//
// Usage: node scripts/christmas-data.mjs SHEET_CSV
//
// SHEET_CSV is the sheet exported as CSV (File > Download > CSV). Its columns are the year the song was
// written (or published), a flag for the song's language (none for English, 🎵 for instrumentals), the
// song, the performer, a flag for the songwriters' nationality (none for American), a + if non-Jewish
// songwriters were involved too, the Jewish songwriters and a YouTube link (or "not found on YouTube").
// Songs without a link are left out. Writes src/christmas/data.json:
// - songs: in the sheet's order, each with its year, language, song, artist, nationality, mixed (the +),
//   writers (a list of names: "Ryan & Jack Met" becomes Ryan Met and Jack Met), a note on the writers
//   (any text in brackets, as in "Jack Antonoff (& St Vincent is ~20% Jewish)") and YouTube video ID
// - flags: the flag for each language and nationality name
// The build fails on flags it doesn't know or links it can't read.

import { readFile, writeFile } from "node:fs/promises";
import { parseCsv } from "./csv.mjs";
import { parseWriters } from "../src/christmas/filter.js";

const [csvPath] = process.argv.slice(2);
if (!csvPath) {
  console.error("Usage: node scripts/christmas-data.mjs SHEET_CSV");
  process.exit(1);
}

const LANGUAGES = {
  "": "English", "🎵": "Instrumental", "🇩🇪": "German", "🇪🇸": "Spanish", "🇫🇷": "French", "🇭🇷": "Croatian", "🇭🇺": "Hungarian",
  "🇰🇷": "Korean", "🇵🇱": "Polish", "🇷🇴": "Romanian", "🇷🇺": "Russian", "🇸🇪": "Swedish", "🇺🇦": "Ukrainian",
};
const NATIONALITIES = {
  "": "American", "🇦🇷": "Argentine", "🇦🇹": "Austrian", "🇦🇺": "Australian", "🇧🇬": "Bulgarian", "🇨🇦": "Canadian", "🇩🇪": "German",
  "🇫🇷": "French", "🇬🇧": "British", "🇭🇷": "Croatian", "🇭🇺": "Hungarian", "🇮🇱": "Israeli", "🇳🇱": "Dutch", "🇵🇱": "Polish",
  "🇷🇴": "Romanian", "🇷🇺": "Russian", "🇸🇪": "Swedish", "🇺🇦": "Ukrainian",
};
const FLAGS = { "English": "🇺🇸", "American": "🇺🇸" };

const songs = [];
const rows = parseCsv(await readFile(csvPath, "utf8")).slice(1);
for (const [n, r] of rows.entries()) {
  const [year, language, song, artist, nationality, plus, writers, link] = r.map((s) => s.trim());
  if (!song) continue;
  const where = `row ${n + 2} (${song})`;
  if (!/^\d{4}$/.test(year)) throw new Error(`${where}: unrecognised year ${year}`);
  if (!(language in LANGUAGES)) throw new Error(`${where}: unknown language flag ${language}`);
  if (!(nationality in NATIONALITIES)) throw new Error(`${where}: unknown nationality flag ${nationality}`);
  if (!["", "+"].includes(plus)) throw new Error(`${where}: expected + or nothing, not ${plus}`);
  if (!link || link === "not found on YouTube") continue;
  const id = link.match(/youtu(?:\.be\/|be\.com\/watch\?v=)([\w-]{11})\b/);
  if (!id) throw new Error(`${where}: unrecognised YouTube link ${link}`);
  songs.push({ year: Number(year), language: LANGUAGES[language], song, artist, nationality: NATIONALITIES[nationality],
    mixed: plus === "+", ...parseWriters(writers), video: id[1] });
}

const flags = { ...FLAGS };
for (const [flag, name] of [...Object.entries(LANGUAGES), ...Object.entries(NATIONALITIES)]) if (flag) flags[name] = flag;

const json = JSON.stringify({ songs, flags });
await writeFile(new URL("../src/christmas/data.json", import.meta.url), json);
console.log(`${songs.length} songs (${rows.filter((r) => r[2]?.trim()).length - songs.length} without a link left out)`);
