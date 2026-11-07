import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { parseWords } from "../src/patterns/wordlist.js";
import { readList, stripList, wordCount } from "../src/wordlists/lists.js";

const HEADER = "# name: Animals\n# description: Some animals.\n\n";

test("stripList drops comments, blank lines and surrounding spaces", () => {
  assert.equal(stripList("# name: x\r\n\r\ncat\r\n# comment\r\n  big dog \r\n\r\n"), "cat\nbig dog\n");
  assert.equal(stripList("# only comments\n\n"), "");
});

test("wordCount counts words the way the other pages do", () => {
  for (const text of ["cat\ndog\ncat\n", "café\ncafé\n", "", "a\n"]) {
    assert.equal(wordCount(text), parseWords(text).length, JSON.stringify(text));
  }
});

test("readList reads the header and counts the words", () => {
  assert.deepEqual(readList(HEADER + "# section\ncat\ndog\n\ncat\n"), { name: "Animals", description: "Some animals.", size: 2 });
  assert.deepEqual(readList(HEADER.replaceAll("\n", "\r\n") + "cat\r\n"), { name: "Animals", description: "Some animals.", size: 1 });
});

test("readList rejects bad headers and stray spaces", () => {
  const rejects = (text, message) => assert.throws(() => readList(text), { message: new RegExp(message) }, JSON.stringify(text));
  rejects("cat\n", 'expected "# key: value"');
  rejects("# name: Animals\n\ncat\n", 'missing header key "description"');
  rejects("# name: Animals\n# description: x\n# colour: red\n\ncat\n", 'unknown header key "colour"');
  rejects("# name: Animals\n# name: Pets\n# description: x\n\ncat\n", 'repeated header key "name"');
  rejects("# name: Animals\n# description: x\n# ====\n\ncat\n", 'line 3: expected "# key: value"');
  rejects("# name: \n# description: x\n\ncat\n", "line 1:");
  rejects(HEADER + "cat \n", "line 4: leading or trailing space");
  rejects(HEADER + "cat\n dog\n", "line 5: leading or trailing space");
});

test("every list in wordlists/ is well formed", async () => {
  const dir = new URL("../wordlists/", import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".txt"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(new URL(file, dir), "utf8");
    assert.doesNotThrow(() => readList(text), file);
  }
});
