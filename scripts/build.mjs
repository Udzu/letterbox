// Build a self-contained HTML page from a template.
//
// Usage: node scripts/build.mjs <template.html> <output.html>
//
// Each <!-- @inline path/to/entry.js --> marker in the template (path relative to the
// template) is replaced by a <script> containing that module bundled with its imports,
// so the output works offline and when saved as a single file.

import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [template, output] = process.argv.slice(2);
if (!template || !output) {
  console.error("Usage: node scripts/build.mjs <template.html> <output.html>");
  process.exit(1);
}

const MARKER = /<!-- @inline (\S+) -->/g;
const html = await readFile(template, "utf8");

const bundles = new Map();
for (const [, entry] of html.matchAll(MARKER)) {
  const result = await build({
    entryPoints: [path.join(path.dirname(template), entry)],
    bundle: true,
    format: "iife",
    target: "es2022",
    write: false,
    legalComments: "inline",
    logLevel: "warning",
  });
  // a literal </script inside the code would end the inline script early
  bundles.set(entry, result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"));
}

const header = `<!-- Generated from ${path.relative(process.cwd(), template)} by scripts/build.mjs: do not edit -->\n`;
const out = html.replace(MARKER, (_, entry) => `<script>\n${bundles.get(entry)}</script>`);
await writeFile(output, out.replace(/^(<!doctype html>\n)?/i, (doctype) => doctype + header));
console.log(`Wrote ${output} (${Math.round(out.length / 1024)} KB)`);
