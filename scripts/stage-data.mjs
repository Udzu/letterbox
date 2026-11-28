// Build the data for the Stage page: three playlists that between them have a song from a musical or
// opera for every year from 1637 to 2024 (except 1646): Musicals Timeline, Opera Timeline and Baroque
// Opera Timeline.
//
// Usage: node scripts/stage-data.mjs
//
// The playlists are kept in this repo, as src/stage/stage.csv, to edit directly: a row per song, newest
// first, with its year, era (the playlist it's from: "Musicals", "Operas" or "Baroque operas"), work
// (the musical or opera it's from), song (cleaned up), composers (separated by semicolons), and the
// track as it is on Apple Music (title, artist, album, ISRC and ID), and its YouTube link.
// Writes src/stage/data.json: songs (newest first), each with its year, era (see ERAS in
// src/stage/filter.js), work, song, composers, artist, album and YouTube video ID (or null without a
// link), and gaps: the years without a song (1646), each with its era and a note. The build fails on
// an unknown era, a missing work, song or composer, a year out of order or repeated, a year missing
// (that isn't a gap), or a link it can't read.

import { readFile, writeFile } from "node:fs/promises";
import { parseCsv } from "./csv.mjs";
import { ERAS } from "../src/stage/filter.js";

const src = (file) => new URL(`../src/stage/${file}`, import.meta.url);
const eraIds = Object.fromEntries(Object.entries(ERAS).map(([id, label]) => [label, id]));

const [header, ...rows] = parseCsv(await readFile(src("stage.csv"), "utf8")).filter((r) => r.some((s) => s.trim()));
const col = (r, name) => (r[header.indexOf(name)] ?? "").trim();

const songs = rows.map((r) => {
  const [year, era, work, song, composer, artist, album, link] = ["Year", "Era", "Work", "Song", "Composer", "Artist", "Album", "YouTube link"].map((c) => col(r, c));
  const where = `stage.csv: ${year} ${col(r, "Track")}`;
  if (!/^\d{4}$/.test(year)) throw new Error(`${where}: bad year`);
  if (!(era in eraIds)) throw new Error(`${where}: unknown era ${era}`);
  if (!work || !song) throw new Error(`${where}: no work or song`);
  const composers = composer.split(";").map((s) => s.trim()).filter(Boolean);
  if (!composers.length) throw new Error(`${where}: no composer`);
  const id = link.match(/youtu(?:\.be\/|be\.com\/watch\?v=)([\w-]{11})\b/);
  if (link && !id) throw new Error(`${where}: unrecognised YouTube link ${link}`);
  return { year: Number(year), era: eraIds[era], work, song, composers, artist, album, video: id ? id[1] : null };
});

// the years without a song, with why (shown as a card in their place)
const gaps = [
  { year: 1646, era: "baroque", note: "No opera this year: the Venetian opera houses were shut due to the Cretan War." },
];

// newest first, a year each, with the eras in order, and every year between the first and last either
// with a song or a gap
const order = Object.keys(ERAS);
songs.forEach((s, i) => {
  const prev = songs[i - 1];
  if (prev && (s.year >= prev.year || order.indexOf(s.era) < order.indexOf(prev.era))) throw new Error(`stage.csv: ${s.year} ${s.song}: out of order`);
});

const years = new Set([...songs, ...gaps].map((s) => s.year));
for (let y = songs.at(-1).year; y <= songs[0].year; y++) if (!years.has(y)) throw new Error(`stage.csv: no song for ${y}`);

const unlinked = songs.filter((s) => !s.video).length;
const json = JSON.stringify({ songs, gaps });
await writeFile(src("data.json"), json);
console.log(`Wrote src/stage/data.json: ${songs.length} songs (${unlinked} without a link), ${Math.round(json.length / 1024)} KB`);
