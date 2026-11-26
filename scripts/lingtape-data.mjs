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
// - countries: every country on the map (Antarctica left out), each with its outline as an SVG path in
//   the Natural Earth projection, 1000 units wide, and the centre of its largest part. Countries are named
//   as in the sheet where it has songs from them (see ALIASES), and otherwise as in Natural Earth.
// The build fails if a song's country isn't on the map.

import { readFile, writeFile } from "node:fs/promises";
import { parseCsv } from "./csv.mjs";

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

// --- the map ---

const topo = JSON.parse(await readFile(topoPath, "utf8"));
const { scale: [kx, ky], translate: [tx, ty] } = topo.transform;

// the Natural Earth projection (as d3-geo's geoNaturalEarth1), scaled to 1000 units wide, cropped
// to latitudes 84°N to 58°S
const RAD = Math.PI / 180;
function naturalEarth(lon, lat) {
  const l = lon * RAD, p = lat * RAD, p2 = p * p, p4 = p2 * p2;
  return [
    l * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4))),
    p * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4))),
  ];
}
const WIDTH = 1000;
const S = WIDTH / (2 * naturalEarth(180, 0)[0]);
const TOP = naturalEarth(0, 84)[1] * S, BOTTOM = naturalEarth(0, -58)[1] * S;
const HEIGHT = Math.round(TOP - BOTTOM);
const project = ([lon, lat]) => {
  const [x, y] = naturalEarth(lon, lat);
  return [x * S + WIDTH / 2, TOP - y * S];
};

// Decode the delta-encoded, quantized arcs into [longitude, latitude] points, project them, and
// simplify them to within TOLERANCE units (arcs are shared between neighbours, so borders still match).
const TOLERANCE = 0.25;
// Longitudes are unwrapped along each arc, so one that crosses the antimeridian (Russia's, Fiji's) goes
// on past ±180° (off the edge of the map) instead of jumping across the map.
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0, shift = 0, previous = null;
  return simplify(arc.map(([dx, dy]) => {
    x += dx; y += dy;
    let lon = x * kx + tx + shift;
    if (previous !== null && Math.abs(lon - previous) > 180) {
      const wrap = lon < previous ? 360 : -360;
      shift += wrap; lon += wrap;
    }
    previous = lon;
    return project([lon, y * ky + ty]);
  }), TOLERANCE);
});

// Douglas–Peucker simplification, keeping the end points: drops points less than tolerance units
// from the line that would replace them.
function simplify(points, tolerance) {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let worst = -1, max = tolerance;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = len ? Math.abs(dy * (px - ax) - dx * (py - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > max) { max = d; worst = i; }
    }
    if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

// Points are rounded to 1/Q units (half a pixel at full width), as relative moves, and points that
// round to the same place are dropped; rings smaller than ~1 square unit are dropped unless they're
// the country's largest.
const Q = 2;
const area = (pts) => Math.abs(pts.reduce((a, [x, y], i) => {
  const [x2, y2] = pts[(i + 1) % pts.length];
  return a + x * y2 - x2 * y;
}, 0)) / 2;
const fmt = (n) => String(n / Q);
function pathOf(rings) {
  let out = "";
  for (const pts of rings) {
    let px = 0, py = 0, d = "";
    let first = true;
    for (const [x, y] of pts) {
      const qx = Math.round(x * Q), qy = Math.round(y * Q);
      if (first) { d += `M${fmt(qx)} ${fmt(qy)}`; first = false; }
      else if (qx !== px || qy !== py) {
        const dx = qx - px, dy = qy - py;
        d += `${dx === 0 ? "v" + fmt(dy) : dy === 0 ? "h" + fmt(dx) : "l" + fmt(dx) + " " + fmt(dy)}`;
      } else continue;
      px = qx; py = qy;
    }
    out += d + "z";
  }
  return out.replace(/ -/g, "-").replace(/([a-z])0\./g, "$1.").replace(/-0\./g, "-.").replace(/ 0\./g, " .");
}

const ring = (indices) => indices.flatMap((i, n) => {
  const points = i < 0 ? [...arcs[~i]].reverse() : arcs[i];
  return n ? points.slice(1) : points; // consecutive arcs share an end point
});

const byName = new Map();
for (const geometry of topo.objects.countries.geometries) {
  const neName = geometry.properties.name;
  if (neName === "Antarctica" || !geometry.arcs) continue;
  const polygons = geometry.type === "Polygon" ? [geometry.arcs] : geometry.arcs;
  const name = ALIASES[neName] ?? neName;
  if (!byName.has(name)) byName.set(name, []);
  for (const polygon of polygons) byName.get(name).push(...polygon.map(ring));
}
const countries = [...byName].map(([name, rings]) => {
  const areas = rings.map(area);
  const largest = rings[areas.indexOf(Math.max(...areas))];
  const xs = largest.map((p) => p[0]), ys = largest.map((p) => p[1]);
  const kept = rings.filter((r, i) => r === largest || areas[i] >= 1);
  const round = (n) => Math.round(n * 10) / 10;
  return {
    name,
    path: pathOf(kept),
    // the centre of the bounding box of the largest part, and its size, for small countries' markers
    cx: round((Math.min(...xs) + Math.max(...xs)) / 2),
    cy: round((Math.min(...ys) + Math.max(...ys)) / 2),
    size: round(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))),
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const names = new Set(countries.map((c) => c.name));
const missing = [...new Set(songs.map((s) => s.country).filter((c) => c && !names.has(c)))];
if (missing.length) {
  console.error(`Countries not on the map: ${missing.join(", ")} (add them to ALIASES)`);
  process.exit(1);
}

const json = JSON.stringify({ width: WIDTH, height: HEIGHT, songs, countries });
await writeFile(new URL("../src/lingtape/data.json", import.meta.url), json);
console.log(`Wrote src/lingtape/data.json: ${songs.length} songs, ${countries.length} countries, ${Math.round(json.length / 1024)} KB`);
