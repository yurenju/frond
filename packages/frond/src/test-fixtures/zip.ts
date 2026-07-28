/**
 * A deterministic ZIP writer, just enough to write an OCF (EPUB) container.
 *
 * Determinism is a hard requirement for this set of fixtures (ADR-0007's first layer —
 * regenerate the fixtures and every geometric number drifts, for reasons that have
 * nothing to do with frond's code). The ZIP format has three sources of
 * non-determinism, and all of them have to be suppressed explicitly:
 *
 * 1. **mtime**. Every ZIP entry records an MS-DOS timestamp. Taking "now" is the most
 *    common leak — every run of the generator produces a different set of bytes. This
 *    fixes it at the DOS time origin, 1980-01-01T00:00:00.
 * 2. **Entry order**. The order the caller gives is written out verbatim, without sorting
 *    or parallelism.
 * 3. **Compressed output**. deflate's output is a function of the implementation rather
 *    than of the format — the same input can give different (but all valid) bytes under
 *    different implementations and different compression parameters. **So everything is
 *    stored (method 0), with no compression at all.** Synthetic fixtures are small (180 KB
 *    all told), the space saved is not worth trading determinism for, and being
 *    uncompressed means a fixture can be inspected by eye.
 *
 * Why hand-written rather than using `fflate`: **not** to escape drift in compressed
 * output. `fflate` is pure JS, its output is a function of the fflate version rather than
 * the Node version, and it supports specifying mtimes and permissions — with the version
 * pinned, writing with it would achieve determinism just as well. What writing it by hand
 * really buys is: the write side depends on no library's byte-level behaviour, and OCF's
 * hard requirements (`mimetype` must be the first entry, stored, with no extra field) are
 * a visible line of code here rather than a side effect of some library option.
 *
 * This module now guards one more thing: `fflate` is already the **reference
 * implementation** (CONTEXT.md) and appears only in tests. Were the generator to use it,
 * both writing and read-back verification would lean on the same third-party
 * implementation, and `tests/node/test-fixtures/epub-container.test.ts`'s "read our own
 * output back with an external implementation" would lose its independence.
 *
 * CRC32 is shared with the read side (`src/epub/zip.ts`) via `src/crc32.ts` — the reason
 * for that is written in that file.
 *
 * Deliberately unsupported: ZIP64, encryption, data descriptors, multi-volume archives,
 * directory entries. Synthetic fixtures do not need them, and one fewer branch is one
 * fewer leak in determinism.
 */

import { crc32 } from "../crc32.ts";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** The fixed size of the three record kinds, none of them counting the filename and extra field that follow. */
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_RECORD_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

const STORED = 0;
const VERSION_NEEDED_TO_EXTRACT = 10; // 1.0 — stored, no ZIP64
const VERSION_MADE_BY = 20;

/** The MS-DOS timestamp origin. DOS time cannot express anything earlier. */
const DOS_DATE_1980_01_01 = 0x0021;
const DOS_TIME_MIDNIGHT = 0x0000;

export interface ZipEntry {
  /** The path inside the archive, always `/`-separated and never starting with `/`. */
  readonly path: string;
  readonly contents: Uint8Array;
}

/**
 * Packs the entries in the order given. The first entry is written at the very start of
 * the file — OCF relies on this to require `mimetype` to come first; see `epub.ts`.
 */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const path = encoder.encode(entry.path);
    const crc = crc32(entry.contents);

    const header = new Uint8Array(LOCAL_FILE_HEADER_SIZE + path.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    headerView.setUint16(4, VERSION_NEEDED_TO_EXTRACT, true);
    headerView.setUint16(6, 0, true); // general purpose flags
    headerView.setUint16(8, STORED, true);
    headerView.setUint16(10, DOS_TIME_MIDNIGHT, true);
    headerView.setUint16(12, DOS_DATE_1980_01_01, true);
    headerView.setUint32(14, crc, true);
    headerView.setUint32(18, entry.contents.length, true);
    headerView.setUint32(22, entry.contents.length, true);
    headerView.setUint16(26, path.length, true);
    headerView.setUint16(28, 0, true); // extra field length
    header.set(path, LOCAL_FILE_HEADER_SIZE);

    const record = new Uint8Array(CENTRAL_DIRECTORY_RECORD_SIZE + path.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    recordView.setUint16(4, VERSION_MADE_BY, true);
    recordView.setUint16(6, VERSION_NEEDED_TO_EXTRACT, true);
    recordView.setUint16(8, 0, true);
    recordView.setUint16(10, STORED, true);
    recordView.setUint16(12, DOS_TIME_MIDNIGHT, true);
    recordView.setUint16(14, DOS_DATE_1980_01_01, true);
    recordView.setUint32(16, crc, true);
    recordView.setUint32(20, entry.contents.length, true);
    recordView.setUint32(24, entry.contents.length, true);
    recordView.setUint16(28, path.length, true);
    recordView.setUint16(30, 0, true); // extra field length
    recordView.setUint16(32, 0, true); // comment length
    recordView.setUint16(34, 0, true); // disk number start
    recordView.setUint16(36, 0, true); // internal attributes
    // External attributes are always 0. A real zip(1) writes unix permission bits, and
    // those follow the umask of whoever generated the file — another leak in determinism.
    recordView.setUint32(38, 0, true);
    recordView.setUint32(42, offset, true);
    record.set(path, CENTRAL_DIRECTORY_RECORD_SIZE);

    local.push(header, entry.contents);
    central.push(record);
    offset += header.length + entry.contents.length;
  }

  const centralSize = central.reduce((total, record) => total + record.length, 0);
  const end = new Uint8Array(END_OF_CENTRAL_DIRECTORY_SIZE);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(4, 0, true); // this disk
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true); // comment length

  return concat([...local, ...central, end]);
}

export function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
