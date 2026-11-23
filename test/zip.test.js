import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { crc32, zipFiles } from "../src/wordlists/zip.js";

// the files in a ZIP, read from its central directory
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const [crc, size, length] = [16, 20, 24].map((o) => view.getUint32(at + o, true));
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = inflateRawSync(bytes.subarray(start, start + size));
    assert.equal(data.length, length);
    assert.equal(crc32(data), crc);
    files.push({ name, text: new TextDecoder().decode(data) });
    at += 46 + nameLength;
  }
  return files;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("zipFiles writes files that unzip to the same names and texts", async () => {
  const files = [{ name: "colours.txt", text: "red\ngreen\n" }, { name: "café.txt", text: "Ω\n".repeat(1000) }, { name: "empty.txt", text: "" }];
  const zip = new Uint8Array(await (await zipFiles(files)).arrayBuffer());
  assert.deepEqual(unzip(zip), files);
});
