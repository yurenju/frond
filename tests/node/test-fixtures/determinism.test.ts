import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { sha256 } from "../support/hash.ts";
import {
  buildFixture,
  syntheticFixtures,
  writeFixtures,
} from "../../../src/test-fixtures/index.ts";

/**
 * Determinism is a hard requirement, not reproducibility hygiene.
 *
 * The moment a fixture is regenerated, every geometric number drifts with it — and the
 * cause of that drift has nothing to do with frond's code: the cross-browser diffs and
 * the invariants change colour at once, the cause cannot be traced, and then nobody
 * trusts this test suite again. So this **builds twice and compares hashes** rather than
 * asserting determinism.
 *
 * A ZIP mtime is the most common leak, but not the only one: `dcterms:modified`, a
 * UUID-shaped identifier, and deflate's output differing across zlib versions all make
 * the bytes drift. These assertions cover the first three; the fourth is removed at the
 * root by `zip.ts` always storing.
 */

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "frond-fixtures-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("determinism", () => {
  test.for(syntheticFixtures.map((fixture) => fixture.name))(
    "building %s twice gives byte-identical output",
    (name) => {
      expect(sha256(buildFixture(name))).toBe(sha256(buildFixture(name)));
    },
  );

  test("written into two different directories, the contents are still byte-identical", async () => {
    // A millisecond tick separates the two. This catches millisecond-resolution leaks —
    // typically someone changing `dcterms:modified` to `new Date().toISOString()`. A ZIP
    // timestamp has two-second resolution and cannot be waited out, so the next case pins
    // those bytes directly.
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();

    const writtenFirst = await writeFixtures(first);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const writtenSecond = await writeFixtures(second);

    expect(writtenFirst.length).toBe(syntheticFixtures.length);
    expect(writtenSecond.length).toBe(syntheticFixtures.length);

    for (const fixture of syntheticFixtures) {
      const before = await readFile(join(first, fixture.fileName));
      const after = await readFile(join(second, fixture.fileName));
      expect(sha256(after), fixture.fileName).toBe(sha256(before));
    }
  });

  test("no timestamp in the output points at now", async () => {
    // Every ZIP entry carries an MS-DOS timestamp. Taking "now" is the most common leak,
    // and it only becomes visible once a second boundary is crossed — the case above
    // catches it by waiting, and this one pins the timestamp at the DOS epoch so the leak
    // is visible within a single run.
    const archive = buildFixture(syntheticFixtures[0]!.name);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

    expect(view.getUint16(10, true)).toBe(0x0000); // 00:00:00
    expect(view.getUint16(12, true)).toBe(0x0021); // 1980-01-01
  });
});
