import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { parseWords } from "../src/patterns/wordlist.js";
import { attributionParts, downloadText, plainAttribution, readList, removeList, sortLists, stripList, wordCount, appendList } from "../src/wordlists/lists.js";

const HEADER = "# name: Animals\n# description: Some animals.\n# tag: science & academia\n\n";

test("stripList drops comments, blank lines and surrounding spaces", () => {
  assert.equal(stripList("# name: x\r\n\r\ncat\r\n# comment\r\n  big dog \r\n\r\n"), "cat\nbig dog\n");
  assert.equal(stripList("# only comments\n\n"), "");
});

test("appendList adds the new words after the old ones", () => {
  assert.equal(appendList("b\na\n", "c\na\nd\nc\n"), "b\na\nc\nd\n");
  assert.equal(appendList("", "a\nb\n"), "a\nb\n");
  assert.equal(appendList("a\n", "a\n"), "a\n");
  assert.equal(appendList("caf\u00e9\n", "cafe\u0301\nx\n"), "caf\u00e9\nx\n");
});

test("removeList keeps the words the remaining lists share", () => {
  const text = appendList(appendList("a\nb\n", "b\nc\n"), "c\nd\n");
  assert.equal(text, "a\nb\nc\nd\n");
  assert.equal(removeList(text, "b\nc\n", ["a\nb\n", "c\nd\n"]), text);
  assert.equal(removeList(text, "c\nd\n", ["a\nb\n", "b\nc\n"]), "a\nb\nc\n");
  assert.equal(removeList(text, "a\nb\n", ["b\nc\n", "c\nd\n"]), "b\nc\nd\n");
  assert.equal(removeList("a\n", "a\n", []), "");
});

test("wordCount counts words the way the other pages do", () => {
  for (const text of ["cat\ndog\ncat\n", "café\ncafé\n", "", "a\n"]) {
    assert.equal(wordCount(text), parseWords(text).length, JSON.stringify(text));
  }
});

test("readList reads the header and counts the words", () => {
  assert.deepEqual(readList(HEADER + "# section\ncat\ndog\n\ncat\n"), { name: "Animals", description: "Some animals.", tag: "science & academia", size: 2 });
  assert.deepEqual(readList(HEADER.replaceAll("\n", "\r\n") + "cat\r\n"), { name: "Animals", description: "Some animals.", tag: "science & academia", size: 1 });
});

test("readList reads an optional attribution", () => {
  const text = "# name: Animals\n# description: Some animals.\n# tag: science & academia\n# attribution: From a zoo.\n\ncat\n";
  assert.deepEqual(readList(text), { name: "Animals", description: "Some animals.", attribution: "From a zoo.", tag: "science & academia", size: 1 });
});

test("readList reads the optional tag: general or a topic", () => {
  assert.equal(readList("# name: Words\n# description: All words.\n# tag: general\n\ncat\n").tag, "general");
  assert.equal(readList("# name: Words\n# description: All words.\n# tag: geography\n\ncat\n").tag, "geography");
  assert.throws(() => readList("# name: Words\n# description: All words.\n# tag: topic\n\ncat\n"), { message: /unknown tag "topic" \(expected general, culture, geography, language, politics & religion, science & academia\)/ });
  assert.equal(readList("# name: Words\n# description: All words.\n\ncat\n").tag, undefined);
});

test("sortLists puts general lists first, then sorts by name", () => {
  const lists = [
    { name: "countries", tag: "science & academia" },
    { name: "English", tag: "general" },
    { name: "Chemical symbols", tag: "science & academia" },
    { name: "Chemical elements", tag: "science & academia" },
    { name: "Bridge terms" },
    { name: "Dutch", tag: "general" },
  ];
  assert.deepEqual(sortLists(lists).map((list) => list.name), ["Dutch", "English", "Bridge terms", "Chemical elements", "Chemical symbols", "countries"]);
});

test("attribution links are [text](url)", () => {
  const text = "From [a zoo](https://zoo.example/) under [CC BY-SA](https://cc.example/by-sa/), (really).";
  assert.deepEqual(attributionParts(text), [
    { text: "From " },
    { text: "a zoo", href: "https://zoo.example/" },
    { text: " under " },
    { text: "CC BY-SA", href: "https://cc.example/by-sa/" },
    { text: ", (really)." },
  ]);
  assert.equal(plainAttribution(text), "From a zoo (https://zoo.example/) under CC BY-SA (https://cc.example/by-sa/), (really).");
  assert.deepEqual(attributionParts("No links [here] (or here)."), [{ text: "No links [here] (or here)." }]);
  assert.equal(downloadText("cat\n", "From [a zoo](https://zoo.example/)."), "# From a zoo (https://zoo.example/).\n\ncat\n");
});

test("downloadText keeps the attribution in a comment the other pages skip", () => {
  assert.equal(downloadText("cat\ndog\n", "From a zoo."), "# From a zoo.\n\ncat\ndog\n");
  assert.equal(downloadText("cat\ndog\n", undefined), "cat\ndog\n");
  assert.deepEqual(parseWords(downloadText("cat\ndog\n", "From a zoo.")), ["cat", "dog"]);
});

test("readList rejects bad headers and stray spaces", () => {
  const rejects = (text, message) => assert.throws(() => readList(text), { message: new RegExp(message) }, JSON.stringify(text));
  rejects("cat\n", 'expected "# key: value"');
  rejects("# name: Animals\n\ncat\n", 'missing header key "description"');
  rejects("# name: Animals\n# description: x\n# colour: red\n\ncat\n", 'unknown header key "colour" \\(expected name, description, tag, attribution\\)');
  rejects("# name: Animals\n# name: Pets\n# description: x\n\ncat\n", 'repeated header key "name"');
  rejects("# name: Animals\n# description: x\n# ====\n\ncat\n", 'line 3: expected "# key: value"');
  rejects("# name: \n# description: x\n\ncat\n", "line 1:");
  rejects(HEADER + "cat \n", "line 5: leading or trailing space");
  rejects(HEADER + "cat\n dog\n", "line 6: leading or trailing space");
});

test("every list in wordlists/ is well formed", async () => {
  const dir = new URL("../wordlists/", import.meta.url);
  const files = (await readdir(dir)).filter((file) => file.endsWith(".txt"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(new URL(file, dir), "utf8");
    let list;
    assert.doesNotThrow(() => (list = readList(text)), file);
    // a downloaded copy loads into the other pages with the words the page says it has
    assert.equal(parseWords(downloadText(stripList(text), list.attribution)).length, list.size, file);
  }
});
