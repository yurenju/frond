/**
 * CRC32 (the IEEE 802.3 variant), the integrity check on every ZIP entry.
 *
 * The reader and the writer share this one implementation: `src/test-fixtures/zip.ts`
 * computes it on write, `src/epub/zip.ts` verifies it on read. **Sharing is
 * deliberate** — two implementations can be wrong in the same way, so the fixtures
 * the generator writes read back fine through our own reader, the tests all go
 * green, and no external tool can open them. With a single implementation, a bug
 * turns the reference implementations (`node:zlib`, `fflate`) red immediately.
 *
 * The reason it is hand-written is the same as for `src/sha1.ts`: the platform does
 * not provide this function, and `EpubBook` has to run on both sides (ADR-0005).
 * It is not a cryptographic hash and serves no security requirement — CRC32 detects
 * accidental corruption in transit and storage; it does not stop deliberate
 * tampering, and must not be relied on to.
 */

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  // Index rather than `for…of`: the read side computes this over every byte of the
  // book each time one is opened, and the iterator's share of this loop is
  // measurable (on a 34 MB book, replacing it took this function from ~150 ms down
  // to ~40 ms).
  for (let at = 0; at < bytes.length; at += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[at]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
