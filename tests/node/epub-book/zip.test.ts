import { unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { EpubOpenError } from "../../../packages/frond/src/epub/errors.ts";
import { readZip } from "../../../packages/frond/src/epub/zip.ts";
import { buildFixture, syntheticFixtures } from "../../../packages/frond/src/test-fixtures/index.ts";

/**
 * The hand-written ZIP reader, compared byte for byte against `fflate`.
 *
 * `fflate` is a **reference implementation** (CONTEXT.md): it appears only in tests, and
 * frond ships with zero runtime dependencies. It is the source of answers rather than
 * hand-written expected values because hand-written expectations only verify "the ZIP
 * format as I understand it" — and an implementation that reads the format wrongly
 * writes its tests with the same misunderstanding, both sides wrong together and the
 * tests still green.
 *
 * The synthetic fixtures are all stored (ADR-0007's determinism), so **they alone never
 * exercise deflate**, while 3308 of the sample's 3309 entries are deflated. So a batch
 * is compressed here with `fflate` on the spot: the compressing side is a reference
 * implementation too, and frond only reads.
 */

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** The DOS timestamp epoch. Pinned so the archive's bytes do not change on every run. */
const DOS_EPOCH = Date.UTC(1980, 0, 1);

/** Compresses one with fflate. */
function archiveOf(
  contents: Record<string, Uint8Array>,
  level: 0 | 1 | 6 | 9 = 6,
): Uint8Array {
  return zipSync(contents, { level, mtime: DOS_EPOCH });
}

async function entriesOf(archive: Uint8Array): Promise<Record<string, Uint8Array>> {
  const read = await readZip(archive);
  return Object.fromEntries(read);
}

async function reasonOf(archive: Uint8Array): Promise<string | undefined> {
  try {
    await readZip(archive);
    return undefined;
  } catch (error) {
    return error instanceof EpubOpenError ? error.reason : `not an EpubOpenError: ${error}`;
  }
}

describe("compared byte for byte against fflate", () => {
  const CONTENTS: Record<string, Uint8Array> = {
    // An empty file: a zero-length deflate block is the easiest slot to get wrong.
    "empty.txt": bytes(""),
    "mimetype": bytes("application/epub+zip"),
    "META-INF/container.xml": bytes(`<?xml version="1.0"?><container/>`),
    // Highly compressible: deflate is bound to use back-references.
    "OEBPS/repeated.xhtml": bytes("<p>同一段話</p>".repeat(500)),
    // Barely compressible: deflate falls back to a stored block, which is a different
    // decoding path.
    "OEBPS/random.bin": Uint8Array.from({ length: 4096 }, (_, index) => (index * 2654435761) % 256),
    // Crosses the 32 KB sliding window, so back-references point into earlier blocks.
    "OEBPS/long.xhtml": bytes("章節內容。".repeat(20_000)),
    "OEBPS/深層/路徑/名稱.xhtml": bytes("<p>路徑有非 ASCII 字元</p>"),
  };

  // level 0 is stored, and the rest are deflate's three compression strengths — the same
  // input is a different bitstream at each strength, and the decoder has to take all
  // three.
  for (const level of [0, 1, 6, 9] as const) {
    test(`every entry at compression level ${level} decodes back to its original bytes`, async () => {
      const archive = archiveOf(CONTENTS, level);
      const read = await entriesOf(archive);

      expect(Object.keys(read).sort()).toEqual(Object.keys(CONTENTS).sort());
      for (const [path, expected] of Object.entries(CONTENTS)) {
        expect(read[path], path).toEqual(expected);
      }
    });
  }

  test("matches what fflate itself reads out", async () => {
    const archive = archiveOf(CONTENTS);
    const oracle = unzipSync(archive);
    const read = await entriesOf(archive);

    expect(Object.keys(read).sort()).toEqual(Object.keys(oracle).sort());
    for (const path of Object.keys(oracle)) {
      expect(read[path], path).toEqual(oracle[path]);
    }
  });

  test.each(syntheticFixtures.map((fixture) => fixture.name))(
    "synthetic fixture %s matches what fflate reads out",
    async (name) => {
      const archive = buildFixture(name);
      const oracle = unzipSync(archive);
      const read = await entriesOf(archive);

      expect(Object.keys(read).sort()).toEqual(Object.keys(oracle).sort());
      for (const path of Object.keys(oracle)) {
        expect(read[path], path).toEqual(oracle[path]);
      }
    },
  );
});

describe("a broken archive has to make noise", () => {
  test("empty bytes are not a ZIP", async () => {
    expect(await reasonOf(new Uint8Array(0))).toBe("not-a-zip");
  });

  test("some other file is not a ZIP", async () => {
    expect(await reasonOf(bytes("This is plain text, not an archive"))).toBe("not-a-zip");
  });

  test("a truncated archive is not a ZIP", async () => {
    const archive = archiveOf({ "a.txt": bytes("內容".repeat(100)) });
    expect(await reasonOf(archive.slice(0, archive.length - 10))).toBe("not-a-zip");
  });

  test("the CRC catches corrupted content", async () => {
    const archive = archiveOf({ "a.txt": bytes("內容".repeat(1000)) });
    const damaged = archive.slice();
    // Flip one byte in the middle of the compressed data. The position is computed rather
    // than guessed — the first local file header is a fixed 30 bytes, followed by the
    // filename and the extra field. Flipping elsewhere (in the central directory, say)
    // would measure a different kind of breakage.
    const view = new DataView(damaged.buffer);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    const middle = start + Math.floor((archive.length - start) / 4);
    damaged[middle] = damaged[middle]! ^ 0xff;

    // An implementation that does not check the CRC silently hands back corrupted bytes —
    // a half-downloaded book turns into "this chapter is garbled", and at that point
    // nobody traces the root cause back to decompression.
    expect(await reasonOf(damaged)).toBe("not-a-zip");
  });

  test("the real EOCD is still found when its signature appears inside content", async () => {
    // `PK\x05\x06` appears in the middle of one entry's data. An implementation that
    // matches the signature without checking the lengths stops here, and then treats the
    // real directory further on as absent.
    const decoy = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(40).fill(0)]);
    const archive = archiveOf({ "decoy.bin": decoy, "a.txt": bytes("內容") }, 0);
    const read = await entriesOf(archive);
    expect(read["a.txt"]).toEqual(bytes("內容"));
    expect(read["decoy.bin"]).toEqual(decoy);
  });
});

describe("ZIP features frond does not read", () => {
  /** Patches one 16-bit field on every central directory entry. */
  function patchCentralDirectory(archive: Uint8Array, offset: number, value: number): Uint8Array {
    const patched = archive.slice();
    const view = new DataView(patched.buffer);
    for (let at = 0; at < patched.length - 4; at += 1) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint16(at + offset, value, true);
    }
    return patched;
  }

  const ARCHIVE = archiveOf({ "a.txt": bytes("內容") });

  test("an encrypted entry does not open, and says why", async () => {
    // The general purpose flag is at byte 8 of the central directory record.
    expect(await reasonOf(patchCentralDirectory(ARCHIVE, 8, 0x0001))).toBe(
      "unsupported-zip-feature",
    );
  });

  test("an unrecognized compression method does not open, and says why", async () => {
    // The compression method is at byte 10. 14 is LZMA — a legal ZIP that frond does not
    // read.
    expect(await reasonOf(patchCentralDirectory(ARCHIVE, 10, 14))).toBe(
      "unsupported-zip-feature",
    );
  });

  test("ZIP64 does not open, and says why", async () => {
    // A saturated length field means the real value lives in a ZIP64 extra field. Read
    // literally it comes out as 4 GB.
    const patched = ARCHIVE.slice();
    const view = new DataView(patched.buffer);
    for (let at = 0; at < patched.length - 4; at += 1) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 0xffffffff, true);
    }
    expect(await reasonOf(patched)).toBe("unsupported-zip-feature");
  });
});

describe("directory entries", () => {
  test("do not appear in the table", async () => {
    // Tools like `zip(1)` write an empty entry for each directory level. Taking them into
    // the table would make `has("OEBPS/")` answer "yes" for a path that yields no bytes at
    // all.
    const archive = archiveOf({ "OEBPS/": new Uint8Array(0), "OEBPS/a.txt": bytes("內容") });
    const read = await entriesOf(archive);
    expect(Object.keys(read)).toEqual(["OEBPS/a.txt"]);
  });
});
