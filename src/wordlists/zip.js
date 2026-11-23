// A minimal ZIP writer for the Wordlists page's Download all button: text files, compressed with
// the browser's own deflate (CompressionStream), with UTF-8 names.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// a date as MS-DOS time and date fields (local time, two-second resolution)
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// a little-endian record of 2- and 4-byte fields, given as [size, value] pairs
function record(fields) {
  const view = new DataView(new ArrayBuffer(fields.reduce((n, [size]) => n + size, 0)));
  let at = 0;
  for (const [size, value] of fields) {
    if (size === 2) view.setUint16(at, value, true);
    else view.setUint32(at, value, true);
    at += size;
  }
  return new Uint8Array(view.buffer);
}

// A ZIP file, as a Blob, of the given [{ name, text }] files.
export async function zipFiles(files, date = new Date()) {
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, text } of files) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(text);
    const compressed = await deflate(data);
    // version 2.0, UTF-8 names (flag bit 11), deflate (method 8)
    const common = [[2, 20], [2, 0x0800], [2, 8], [2, time], [2, day], [4, crc32(data)], [4, compressed.length], [4, data.length], [2, nameBytes.length], [2, 0]];
    const local = record([[4, 0x04034b50], ...common]);
    parts.push(local, nameBytes, compressed);
    central.push(record([[4, 0x02014b50], [2, 20], ...common, [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]]), nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = record([[4, 0x06054b50], [2, 0], [2, 0], [2, files.length], [2, files.length], [4, size], [4, offset], [2, 0]]);
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
