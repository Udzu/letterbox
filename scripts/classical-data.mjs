// Build the data for the Classical page: a playlist of pop songs based on classical pieces, each followed
// by the piece it's based on.
//
// Usage: node scripts/classical-data.mjs
//
// The playlist is kept in this repo, as src/classical/classical.csv, to edit directly. Its rows come in
// pairs, in playlist order: a pop song, then the classical piece it's based on. Each row has the section
// ("Adaptation" or "Sample", the same for both rows of a pair), song, artist, album, ISRC, Apple Music ID
// and YouTube link, and the piece's row has its composer (or composers, separated by semicolons).
// Writes src/classical/data.json: pairs (sorted by pop song), each with its section, composers, and the
// pop song and piece (song, artist, album and YouTube video ID, or null without a link). The build fails
// on an odd number of rows, a pair whose rows have different sections, a piece without a composer, or a
// link it can't read.

import { readFile, writeFile } from "node:fs/promises";
import { parseCsv } from "./csv.mjs";

const SECTIONS = ["Adaptation", "Sample"];
const src = (file) => new URL(`../src/classical/${file}`, import.meta.url);

const [header, ...rows] = parseCsv(await readFile(src("classical.csv"), "utf8")).filter((r) => r.some((s) => s.trim()));
const col = (r, name) => (r[header.indexOf(name)] ?? "").trim();
if (rows.length % 2) throw new Error(`classical.csv: ${rows.length} rows, but they should come in pairs`);

function track(r) {
  const [song, artist, album, link] = ["Song", "Artist", "Album", "YouTube link"].map((c) => col(r, c));
  const id = link.match(/youtu(?:\.be\/|be\.com\/watch\?v=)([\w-]{11})\b/);
  if (link && !id) throw new Error(`classical.csv: ${song}: unrecognised YouTube link ${link}`);
  return { song, artist, album, video: id ? id[1] : null };
}

const pairs = [];
for (let i = 0; i < rows.length; i += 2) {
  const [pop, piece] = [rows[i], rows[i + 1]];
  const section = col(pop, "Section");
  if (!SECTIONS.includes(section) || col(piece, "Section") !== section) throw new Error(`classical.csv: ${col(pop, "Song")}: bad section`);
  const composers = col(piece, "Composer").split(";").map((s) => s.trim()).filter(Boolean);
  if (!composers.length) throw new Error(`classical.csv: ${col(piece, "Song")}: no composer`);
  pairs.push({ section: section.toLowerCase(), composers, pop: track(pop), piece: track(piece) });
}

// sorted by pop song, ignoring a leading "The", "A" or "An", case and accents (as the playlist sorts
// each section)
const sortKey = (song) => song.replace(/^(the|an?) /i, "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
pairs.sort((a, b) => sortKey(a.pop.song).localeCompare(sortKey(b.pop.song)));

const unlinked = pairs.flatMap((p) => [p.pop, p.piece]).filter((t) => !t.video).length;
const json = JSON.stringify({ pairs });
await writeFile(src("data.json"), json);
console.log(`Wrote src/classical/data.json: ${pairs.length} pairs (${unlinked} tracks without a link), ${Math.round(json.length / 1024)} KB`);
