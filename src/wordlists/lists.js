// Word list files, as kept in wordlists/: shared by the build, which reads their metadata,
// and the Wordlists page, which strips them for loading and downloading.
//
// A list file has one word or phrase per line. Lines starting with # are comments, and they
// and blank lines are dropped. The file starts with a header of "# key: value" comments,
// ended by a blank line, giving the list's name and description. Optionally, it gives the
// list's kind, "general" (such as a whole language) or "topic" (the default), and an
// attribution, which is shown on the page and kept at the top of downloaded copies:
//
//   # name: Countries
//   # description: Sovereign states and dependent territories.
//
//   Afghanistan
//   ...

const REQUIRED = ["name", "description"];
const KEYS = [...REQUIRED, "kind", "attribution"];
const KINDS = ["general", "topic"];

// the list's words, one per line, without comments, blank lines or surrounding spaces
export function stripList(text) {
  const words = text.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"));
  return words.length === 0 ? "" : words.join("\n") + "\n";
}

// A list as downloaded: its words, after a comment with its attribution if it has one. The
// other pages skip # lines at the top of a file, so this loads with the same words.
export function downloadText(stripped, attribution) {
  return attribution ? `# ${attribution}\n\n${stripped}` : stripped;
}

// the number of distinct words in a stripped list, counted the way the other pages count them
export function wordCount(stripped) {
  return new Set(stripped.split("\n").filter((line) => line !== "").map((line) => line.normalize("NFC"))).size;
}

// A list file's metadata and size, or an error naming the first problem: a missing or
// malformed header, or a line with leading or trailing spaces (which would otherwise be
// silently trimmed, or become part of a word when the file is uploaded as it is).
export function readList(text) {
  const lines = text.split("\n").map((line) => line.replace(/\r$/, ""));
  const meta = {};
  let i = 0;
  for (; i < lines.length && lines[i] !== ""; i++) {
    const match = /^# (\w+): (.*\S)$/.exec(lines[i]);
    if (!match) throw new Error(`line ${i + 1}: expected "# key: value" in the header, or a blank line to end it`);
    const [, key, value] = match;
    if (!KEYS.includes(key)) throw new Error(`line ${i + 1}: unknown header key "${key}" (expected ${KEYS.join(", ")})`);
    if (key in meta) throw new Error(`line ${i + 1}: repeated header key "${key}"`);
    meta[key] = value;
  }
  for (const key of REQUIRED) {
    if (!(key in meta)) throw new Error(`missing header key "${key}"`);
  }
  meta.kind ??= "topic";
  if (!KINDS.includes(meta.kind)) throw new Error(`unknown kind "${meta.kind}" (expected ${KINDS.join(" or ")})`);
  for (let j = i; j < lines.length; j++) {
    if (/^\s|\s$/.test(lines[j])) throw new Error(`line ${j + 1}: leading or trailing space in ${JSON.stringify(lines[j])}`);
  }
  return { ...meta, size: wordCount(stripList(text)) };
}

// lists in the order the page shows them: general lists first, then topics, each by name
export function sortLists(lists) {
  return [...lists].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name, "en"));
}
