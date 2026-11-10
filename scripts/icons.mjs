// Render the app icons in icons/ from their SVG sources with headless Chrome.
//
// Usage: node scripts/icons.mjs
//
// The PNGs are committed, so this only needs running when an icon's SVG changes.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ICONS = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "icons");
const OUTPUTS = [
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  ["maskable.svg", "maskable-512.png", 512],
  ["apple-touch-icon.svg", "apple-touch-icon.png", 1024],
];

const profile = mkdtempSync(path.join(tmpdir(), "icons-"));
try {
  for (const [source, output, size] of OUTPUTS) {
    execFileSync("google-chrome", [
      "--headless=new", `--user-data-dir=${profile}`, "--hide-scrollbars", "--default-background-color=00000000",
      `--window-size=${size},${size}`, `--screenshot=${path.join(ICONS, output)}`, `file://${path.join(ICONS, source)}`,
    ], { stdio: "ignore" });
    console.log(`Wrote icons/${output}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
