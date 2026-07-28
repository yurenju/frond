/**
 * Maps an `href` in a book to an entry name inside the archive.
 *
 * **This is the one and only route in the project.** The manifest (`resources.ts`),
 * the container's `full-path` (`container.ts`) and the TOC (`toc.ts`) all call this
 * function, each swapping in a different base: resolution is relative to the document
 * that cites the href. Spine's original sin was exactly this — the same
 * normalization implemented twice, each unaware of the other, so fixing one left the
 * other broken (#1). One more call site is not duplication; one more
 * `decodeURIComponent` is.
 *
 * **This is not string concatenation.** An `href` is a URL, not a filesystem path,
 * and has to be resolved by URL rules relative to the document citing it. Evidence
 * (from the comments on #8): a Kobo-channel EPUB 3 whose OPF sits at
 * `OEBPS/content.opf` has this in its manifest
 *
 * ```xml
 * <item id="js-kobo.js" href="../js/kobo.js" media-type="application/javascript"/>
 * ```
 *
 * and `js/kobo.js` really does exist at the package root. Joining `OEBPS/` to
 * `../js/kobo.js` gives the literal `OEBPS/../js/kobo.js`, which is not the name of
 * any ZIP entry, so a concatenating implementation judges this **conforming book** to
 * have an OPF pointing at a missing file.
 *
 * Borrowing WHATWG `URL`'s resolution rules (zero DOM dependency; Node and browsers
 * both have it) handles `../` and percent-encoding at once — the latter being a
 * separate ailment (`toc-href-percent-comma`).
 *
 * ## Why a sentinel directory
 *
 * `URL` swallows surplus `..` at the root: `../../x` relative to `/OEBPS/a.opf`
 * resolves to `/x` rather than failing. That is precisely what would make "escapes
 * the package root" — non-conforming, and also the shape of a path traversal —
 * invisible. So the base is padded with one sentinel directory: whatever still sits
 * under the sentinel after resolution is inside the package, and whatever had that
 * level swallowed has escaped.
 */

const ORIGIN = "https://frond.invalid";

/** The layer padded on above the package root. Its name never appears in any return value. */
const SENTINEL = "/__container__/";

/**
 * The package root, for use as a `fromArchivePath`.
 *
 * The few files under `META-INF/` (`container.xml`'s `full-path`,
 * `encryption.xml`'s `CipherReference URI`) name paths relative to the package root
 * rather than to their own directory. Writing an empty string at each site would
 * work too, but that empty string reads like a forgotten field rather than a
 * decision.
 */
export const CONTAINER_ROOT = "";

export type ResolvedHref =
  /** Resolved inside the package; `path` is the entry name within the archive. */
  | {
      readonly kind: "in-container";
      readonly path: string;
      /**
       * The part of the href after `#`, already decoded. `undefined` when there is
       * no fragment.
       *
       * Manifest hrefs never carry one (there it names a whole file); **TOC hrefs
       * often do**: the measured number is that across those 33 books' navigation
       * documents, 914 of 1568 TOC hrefs carry a fragment, spread over 22 books. An
       * implementation that discards it behaves perfectly on top-level entries, and
       * only silently stops at the start of the Section when jumping into the middle
       * of a chapter.
       *
       * Decoding is necessary: an id may be non-ASCII, and inside a URL it is
       * percent-encoded.
       */
      readonly fragment: string | undefined;
    }
  /** An absolute URL — not in this archive. EPUB 3 allows remote resources; frond does not download them. */
  | { readonly kind: "remote"; readonly url: string }
  /** Resolves outside the package root. Non-conforming. */
  | { readonly kind: "outside-container" };

/**
 * @param href the href, copied verbatim
 * @param fromArchivePath the archive path of the document citing it
 */
export function resolveHref(href: string, fromArchivePath: string): ResolvedHref {
  const base = new URL(`${SENTINEL}${fromArchivePath}`, ORIGIN);

  let resolved: URL;
  try {
    resolved = new URL(href, base);
  } catch {
    // `URL` only throws when it cannot resolve at all — for instance when the href
    // is an invalid absolute URL other than the empty string (`http://[`). In such a
    // book this item points at nothing.
    return { kind: "outside-container" };
  }

  if (resolved.origin !== base.origin) {
    return { kind: "remote", url: resolved.href };
  }
  if (!resolved.pathname.startsWith(SENTINEL)) {
    return { kind: "outside-container" };
  }

  return {
    kind: "in-container",
    path: decodePath(resolved.pathname.slice(SENTINEL.length)),
    // `hash` carries the `#`, and an empty fragment (`a.xhtml#`) is the same thing
    // as no fragment — both point at the start of that document.
    fragment:
      resolved.hash.length > 1 ? decodePath(resolved.hash.slice(1)) : undefined,
  };
}

/**
 * ZIP entry names are raw bytes, not percent-encoded URLs, so resolution has to be
 * undone afterwards.
 *
 * Whatever will not decode (broken encodings like `%zz`) is left verbatim — that
 * book's href was written wrong to begin with, and "this entry is not found" is
 * easier to understand than "a `URIError` while opening the book".
 */
function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
