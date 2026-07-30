import type { Resource } from "./resources.ts";

/**
 * The cover image — where a bookshelf's thumbnail comes from.
 *
 * **`properties="cover-image"` first, then `<meta name="cover">`, and if neither is
 * there the book has no cover** (ADR-0010). That is the order, but it is **not
 * dispatched on version**: one EPUB 3 book in the sample declares its cover only in
 * the old notation, and a version-dispatching implementation would leave that book
 * without one.
 *
 * "No cover" is not an error. A missing target id, or a resource whose bytes cannot
 * be taken, is likewise reported as no cover — a book whose packaging declarations
 * disagree with its contents is the norm, and a book with a broken cover reference
 * still reads through to the end.
 */
export interface CoverImage {
  /** The path inside the archive, for diagnostics. */
  readonly path: string;
  readonly mediaType: string;
  /** A bookshelf wants the image itself, not a path — all it holds is this book's bytes. */
  readonly bytes: Uint8Array;
  /** Which notation found it. Both routes work, and reporting which one was taken makes that observable. */
  readonly foundBy: CoverNotation;
}

export type CoverNotation = "cover-image-property" | "meta-name";

/**
 * @param readBytes Takes the bytes of a resource, along the same route as
 * `EpubBook.bytes()` — **not by reading the archive directly**. The difference is
 * obfuscation: reading directly would hand a bookshelf an undecodable image for a
 * book that also lists its cover in `encryption.xml`, while `book.bytes(cover.path)`
 * would return different bytes. The same path in the same book can only have one
 * answer.
 */
export function readCover(
  resources: ReadonlyMap<string, Resource>,
  coverMetaId: string | undefined,
  readBytes: (path: string) => Uint8Array,
): CoverImage | undefined {
  const byProperty = [...resources.values()].find((resource) =>
    resource.properties.includes("cover-image"),
  );
  const byMeta = coverMetaId === undefined ? undefined : resources.get(coverMetaId);

  // Try them in order, and **move on to the next when one cannot be taken** —
  // "found a declaration" and "can get that image" are two different things, and
  // treating the former as the latter would leave a book without a cover when it
  // writes both notations and the new one points at a remote image (or at an image
  // not in the package).
  for (const [resource, foundBy] of [
    [byProperty, "cover-image-property"],
    [byMeta, "meta-name"],
  ] as const) {
    if (resource?.location.kind !== "in-container") continue;

    const bytes = tryRead(readBytes, resource.location.path);
    // A cover that will not decode lands in the same bucket as one pointing at an
    // image that is not in the package: **this book has no cover**, not this book
    // will not open. A book whose cover is DRM-encrypted still reads through to the
    // end, and all a bookshelf wants is whether there is a thumbnail.
    if (bytes === undefined) continue;

    return {
      path: resource.location.path,
      mediaType: resource.mediaType,
      bytes,
      foundBy,
    };
  }

  return undefined;
}

/** Unavailable is unavailable. This does not distinguish why — the difference makes no odds to "is there a cover". */
function tryRead(
  readBytes: (path: string) => Uint8Array,
  path: string,
): Uint8Array | undefined {
  try {
    return readBytes(path);
  } catch {
    return undefined;
  }
}
