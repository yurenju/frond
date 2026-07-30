import { describe, expect, test } from "vitest";
import { unzipSync } from "fflate";
import {
  buildFixture,
  syntheticFixtures,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

/**
 * The generator's acceptance criterion: the output has to be a real EPUB, not "the
 * script threw no exception".
 *
 * Decompression always goes through fflate rather than the inverse of our own writer —
 * reading our own writer with our own reader would make any misunderstanding of the ZIP
 * format hold on both sides at once, and the tests would stay green.
 */

const ZIP_LOCAL_HEADER_SIZE = 30;
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_STORED = 0;

describe("the EPUB packaging format", () => {
  test.for(syntheticFixtures.map((fixture) => fixture.name))(
    "%s decompresses, and is a conforming OCF container",
    (name: AilmentName) => {
      const archive = buildFixture(name);
      const entries = unzipSync(archive);

      expect(Object.keys(entries)).toContain("META-INF/container.xml");
    },
  );

  test.for(syntheticFixtures.map((fixture) => fixture.name))(
    "%s's first entry is an uncompressed mimetype",
    (name: AilmentName) => {
      // OCF requires mimetype to be the archive's first entry, stored, with no extra
      // field. This is not formalism: readers (and `file(1)`) sniff whether something is an
      // EPUB from the fixed position at byte 30, and once the entry is compressed or moved
      // the sniff fails.
      const archive = buildFixture(name);
      const view = new DataView(
        archive.buffer,
        archive.byteOffset,
        archive.byteLength,
      );

      expect(view.getUint32(0, true)).toBe(ZIP_LOCAL_HEADER_SIGNATURE);
      expect(view.getUint16(8, true)).toBe(ZIP_STORED);
      expect(view.getUint16(28, true)).toBe(0); // extra field length

      const nameLength = view.getUint16(26, true);
      const decoder = new TextDecoder();
      expect(
        decoder.decode(
          archive.subarray(
            ZIP_LOCAL_HEADER_SIZE,
            ZIP_LOCAL_HEADER_SIZE + nameLength,
          ),
        ),
      ).toBe("mimetype");
      expect(
        decoder.decode(
          archive.subarray(
            ZIP_LOCAL_HEADER_SIZE + nameLength,
            ZIP_LOCAL_HEADER_SIZE + nameLength + "application/epub+zip".length,
          ),
        ),
      ).toBe("application/epub+zip");
    },
  );
});
