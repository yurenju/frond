import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** The directory the committed fixtures live in. `tests/fixtures/` is the single source. */
export const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

/**
 * Reads a committed fixture's bytes.
 *
 * Returns `Uint8Array<ArrayBuffer>` rather than `Buffer`: a `Buffer`'s backing store is
 * typed as `ArrayBufferLike` (possibly a `SharedArrayBuffer`), while both the `Blob` and the
 * `ArrayBuffer` input routes require an `ArrayBuffer`.
 */
export async function readFixture(
  fileName: string,
): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(await readFile(join(FIXTURE_DIRECTORY, fileName)));
}
