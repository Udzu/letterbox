// Build a self-contained HTML page from a template.
//
// Usage: node scripts/build.mjs <template.html> <output.html>
//
// Each <!-- @inline path/to/entry.js --> marker in the template (path relative to the
// template) is replaced by a <script> containing that module bundled with its imports,
// so the output works offline and when saved as a single file. Imported .txt files are bundled as strings.
//
// A <!-- @wordlists path/to/dir --> marker is replaced by a JSON <script id="lists-data">
// holding the metadata and size of each .txt list in that directory, general lists first
// and then by name. The build fails if any list's header is missing or malformed (see src/wordlists/lists.js).

import { build } from "esbuild";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readList, sortLists } from "../src/wordlists/lists.js";

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
    loader: { ".txt": "text" }, // data files imported as strings
    logLevel: "warning",
  });
  // a literal </script inside the code would end the inline script early
  bundles.set(entry, result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"));
}

const LISTS_MARKER = /<!-- @wordlists (\S+) -->/g;
const lists = new Map();
for (const [, dir] of html.matchAll(LISTS_MARKER)) {
  const full = path.join(path.dirname(template), dir);
  const files = (await readdir(full)).filter((file) => file.endsWith(".txt"));
  let entries = [];
  for (const file of files) {
    try {
      entries.push({ file, ...readList(await readFile(path.join(full, file), "utf8")) });
    } catch (e) {
      console.error(`${path.join(full, file)}: ${e.message}`);
      process.exit(1);
    }
  }
  entries = sortLists(entries);
  const fileOf = new Map();
  for (const entry of entries) {
    if (fileOf.has(entry.name)) {
      console.error(`${fileOf.get(entry.name)} and ${entry.file} have the same name, ${entry.name}`);
      process.exit(1);
    }
    fileOf.set(entry.name, entry.file);
  }
  // escaping < keeps a </script inside a name or description from ending the script early
  const json = JSON.stringify(entries, null, 2).replace(/</g, "\\u003c");
  lists.set(dir, `<script type="application/json" id="lists-data">\n${json}\n</script>`);
}

const header = `<!-- Generated from ${path.relative(process.cwd(), template)} by scripts/build.mjs: do not edit -->\n`;
const out = html
  .replace(MARKER, (_, entry) => `<script>\n${bundles.get(entry)}</script>`)
  .replace(LISTS_MARKER, (_, dir) => lists.get(dir));
await writeFile(output, out.replace(/^(<!doctype html>\n)?/i, (doctype) => doctype + header));
console.log(`Wrote ${output} (${Math.round(out.length / 1024)} KB)`);
