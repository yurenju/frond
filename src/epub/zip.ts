import { crc32 } from "../crc32.ts";
import { EpubOpenError } from "./errors.ts";

/**
 * A ZIP reader, just enough to read an OCF (EPUB) container.
 *
 * ## Why not a library
 *
 * frond ships with **zero runtime dependencies**. This module replaces
 * `fflate.unzipSync`, and the reason it is only two hundred lines is that
 * **decompression itself is not hand-written**:
 * `DecompressionStream('deflate-raw')` is built into the platform, present in Node
 * and all three browsers (`tests/browser/smoke/decompression-stream.spec.ts` is the
 * tripwire on that assumption). What is left for this file is parsing the container
 * format, and that is a set of fixed-length fields.
 *
 * Replacing it fixed something along the way: `unzipSync` is synchronous, and opening
 * a 34 MB book locks the main thread for nearly a hundred milliseconds. Here
 * decompression happens off the JS thread and overlaps in batches, which measures
 * faster than the synchronous version.
 *
 * ## Read from the central directory, do not scan local headers
 *
 * Both routes reach the entries. The difference is that a local header's length
 * fields **are allowed to lie** — a writer compressing as it writes (streaming) does
 * not yet know the compressed length when it writes the local header, so it puts 0 in
 * three fields and the real values follow the data in a data descriptor (bit 3 of the
 * general purpose flag). The central directory has no such problem: it is written
 * last, and every field there is final. **Reading the central directory makes the
 * data descriptor automatically not a case to handle**, rather than a branch to
 * remember to write.
 *
 * ## Whatever is explicitly unsupported throws rather than guesses
 *
 * ZIP64, encryption, compression methods other than deflate, multi-volume archives.
 * In the sample (34 books, 3309 entries) **not one** of these four appears — ZIP64
 * only comes into play past 4 GB or 65535 entries. What they have in common is that
 * the cost of guessing wrong is **inflating a pile of garbage that looks like data**,
 * which flows all the way to the screen as mojibake or broken images, with nobody
 * able to trace the root cause back here. Better to not open at all.
 *
 * One more thing is deliberately not done: **entry names are not path-sanitised**. A
 * name starting with `../` is accepted here, because frond never uses it to write a
 * file — it is only a key in a table, and the lookup side (`resource-path.ts`'s
 * `resolveHref`) already rejects hrefs that escape the package root. Blocking it a
 * second time here would turn that book from "one resource points outside the
 * package" into "the whole book will not open", and those are two different things.
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;

/** The fixed size of the three record kinds, none of them counting the filename, extra field and comment that follow. */
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_RECORD_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;

const STORED = 0;
const DEFLATED = 8;

/** Bit 0 of the general purpose flag: this entry is encrypted. */
const ENCRYPTED_FLAG = 0x0001;

/**
 * ZIP64's sentinel values. A saturated field means "the real value is in the ZIP64
 * extra field", not "this entry happens to be 4 GB" — reading it literally gives an
 * absurd length, and then inflates garbage.
 */
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

/** The maximum length of the archive comment (the field is 16 bits), which is also how far back the search for the EOCD reaches. */
const MAX_ARCHIVE_COMMENT_SIZE = 0xffff;

/**
 * How many entries are inflated at once.
 *
 * Concurrency is where the speed comes from (measured over 255 entries: 345 ms one at
 * a time, 54 ms concurrently), but leaving it unbounded lets a book decide how many
 * streams are open at once, and the entry count is written by the book. 32 is already
 * enough for the inflations to overlap — the bottleneck is inflation itself, not how
 * many more streams could be opened.
 */
const DECOMPRESSION_BATCH_SIZE = 32;

/**
 * Reads the whole archive into "path → bytes".
 *
 * Inflating everything into memory at once is the same decision as `openContainer`'s
 * interface: every layer above sees nothing but that table, so switching later to lazy
 * inflation or range requests still only changes this file.
 */
export async function readZip(
  archive: Uint8Array,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const directory = readCentralDirectory(archive, view);

  const entries = new Map<string, Uint8Array>();
  for (let at = 0; at < directory.length; at += DECOMPRESSION_BATCH_SIZE) {
    const batch = directory.slice(at, at + DECOMPRESSION_BATCH_SIZE);
    const contents = await Promise.all(batch.map((entry) => contentsOf(archive, view, entry)));
    batch.forEach((entry, index) => entries.set(entry.path, contents[index]!));
  }
  return entries;
}

interface DirectoryEntry {
  readonly path: string;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function readCentralDirectory(
  archive: Uint8Array,
  view: DataView,
): readonly DirectoryEntry[] {
  const end = findEndOfCentralDirectory(archive, view);

  // A multi-volume archive: this file is only one piece, and the remaining bytes are
  // simply not in hand.
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    throw unsupported("this archive is split across several disks (multi-disk); frond only reads a single file");
  }

  const count = view.getUint16(end + 10, true);
  const offset = view.getUint32(end + 16, true);
  const size = view.getUint32(end + 12, true);
  if (
    count === ZIP64_SENTINEL_16 ||
    offset === ZIP64_SENTINEL_32 ||
    size === ZIP64_SENTINEL_32 ||
    hasZip64Locator(view, end)
  ) {
    throw unsupported("this archive is ZIP64, which frond does not support");
  }

  const entries: DirectoryEntry[] = [];
  let at = offset;
  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_DIRECTORY_RECORD_SIZE > archive.length) {
      throw notAZip(`central directory entry ${index + 1} runs past the end of the file`);
    }
    if (view.getUint32(at, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw notAZip(`central directory entry ${index + 1} does not have the right signature`);
    }

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const pathLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localHeaderOffset = view.getUint32(at + 42, true);
    const path = decodePath(archive, at + CENTRAL_DIRECTORY_RECORD_SIZE, pathLength);

    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw unsupported(`${path} is encrypted, and frond does not decrypt`);
    }
    if (method !== STORED && method !== DEFLATED) {
      throw unsupported(`${path} uses compression method ${method}; frond only reads stored and deflate`);
    }
    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw unsupported(`${path}'s length or position needs ZIP64 to express, which frond does not support`);
    }

    // Directory entries have no contents; they are structure for a file browser to
    // show. Taken into the table, `has("OEBPS/")` would answer yes for a path from
    // which no bytes can be taken.
    if (!path.endsWith("/")) {
      entries.push({
        path,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }
    at += CENTRAL_DIRECTORY_RECORD_SIZE + pathLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Searches backwards from the end of the file for the EOCD.
 *
 * **Matching the signature alone is not enough**: those four bytes may legitimately
 * occur inside compressed data, or inside the archive's own comment. So every
 * candidate position has to be asked once more: "does the comment length it declares
 * exactly equal the bytes remaining after it?" — the real EOCD always adds up, and a
 * false signature almost never does.
 */
function findEndOfCentralDirectory(archive: Uint8Array, view: DataView): number {
  const earliest = Math.max(
    0,
    archive.length - END_OF_CENTRAL_DIRECTORY_SIZE - MAX_ARCHIVE_COMMENT_SIZE,
  );
  for (let at = archive.length - END_OF_CENTRAL_DIRECTORY_SIZE; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(at + 20, true);
    if (at + END_OF_CENTRAL_DIRECTORY_SIZE + commentLength === archive.length) return at;
  }
  throw notAZip("no ZIP end of central directory record found");
}

/** The ZIP64 locator sits immediately before the EOCD. Its presence means the real directory information is in the ZIP64 form. */
function hasZip64Locator(view: DataView, end: number): boolean {
  const at = end - ZIP64_LOCATOR_SIZE;
  if (at < 0) return false;
  return view.getUint32(at, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE;
}

/**
 * Entry names are always decoded as UTF-8.
 *
 * ZIP's original character set is CP437, and UTF-8 has to be declared by bit 11 of the
 * general purpose flag. There are no two routes here, because EPUB specifies that
 * paths inside the container are UTF-8, and **not one** of the sample's 3309 entries
 * has a name containing non-ASCII bytes — both readings give identical results on that
 * set of books. Writing out a CP437 table buys no known book.
 */
function decodePath(archive: Uint8Array, at: number, length: number): string {
  return new TextDecoder().decode(archive.subarray(at, at + length));
}

async function contentsOf(
  archive: Uint8Array,
  view: DataView,
  entry: DirectoryEntry,
): Promise<Uint8Array> {
  const header = entry.localHeaderOffset;
  if (
    header + LOCAL_FILE_HEADER_SIZE > archive.length ||
    view.getUint32(header, true) !== LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw notAZip(`${entry.path}'s local file header is not where the central directory said it would be`);
  }

  // The extra field length has to be read from the local header's own slot — the same
  // entry is allowed to have extra fields of different lengths in the two places
  // (writers often add alignment padding on the local side), and computing the data
  // start from the central directory's length would be off.
  const pathLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  const start = header + LOCAL_FILE_HEADER_SIZE + pathLength + extraLength;
  if (start + entry.compressedSize > archive.length) {
    throw notAZip(`${entry.path}'s data runs past the end of the file; this archive is incomplete`);
  }

  const raw = archive.subarray(start, start + entry.compressedSize);
  const contents =
    entry.method === STORED ? raw.slice() : await inflateRaw(raw, entry.path);

  if (contents.length !== entry.uncompressedSize) {
    throw notAZip(
      `${entry.path} inflated to ${contents.length} bytes, but the directory says ${entry.uncompressedSize}`,
    );
  }
  // A CRC mismatch means the bytes are corrupt. Without this check, broken content
  // flows all the way to the screen — a half-downloaded book becomes "this chapter is
  // mojibake", and by then nobody can trace the root cause back to inflation.
  if (crc32(contents) !== entry.crc) {
    throw notAZip(`${entry.path}'s CRC does not match; this entry's bytes are corrupt`);
  }
  return contents;
}

async function inflateRaw(raw: Uint8Array, path: string): Promise<Uint8Array> {
  // `deflate-raw` is not `deflate`: the latter carries a zlib header, and ZIP entries
  // do not have those two bytes. Feeding the wrong one makes every entry fail to
  // inflate.
  const stream = new DecompressionStream("deflate-raw");

  // The write must not be awaited first: `write()` only resolves once the read side
  // has taken the data (backpressure), so awaiting it here is a deadlock. But it
  // cannot be left unhandled either — when the data is corrupt **both** the writable
  // and the readable reject, and whichever side nobody catches becomes an unhandled
  // rejection: the tests still go green and the process blows up somewhere else. So it
  // runs concurrently here with its error swallowed, and the real error is reported by
  // the read side.
  const written = (async () => {
    const writer = stream.writable.getWriter();
    // Type-wise a `Uint8Array` may be backed by a `SharedArrayBuffer`, and `write()`'s
    // signature does not accept that. In practice this is always a slice of the
    // archive `readZip` was handed, not shared memory — what is asserted here is that
    // fact, not a way around the check.
    await writer.write(raw as Uint8Array<ArrayBuffer>);
    await writer.close();
  })().catch(() => undefined);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch (cause) {
    await written;
    throw notAZip(`${path}'s deflate data will not inflate`, { cause });
  }
  await written;

  const contents = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    contents.set(chunk, at);
    at += chunk.length;
  }
  return contents;
}

function notAZip(detail: string, options?: ErrorOptions): EpubOpenError {
  return new EpubOpenError("not-a-zip", `these bytes are not a readable ZIP: ${detail}`, options);
}

function unsupported(detail: string): EpubOpenError {
  return new EpubOpenError("unsupported-zip-feature", detail);
}
