import type { EpubContainer } from "./container.ts";
import { EpubOpenError } from "./errors.ts";
import type { ManifestItem } from "./package-document.ts";
import { resolveHref } from "./resource-path.ts";

/**
 * The resources the manifest declares — **where they are declared to be**, and
 * whether **anything is actually there**.
 *
 * This layer is the cut between "how the book declares things" and "where the files
 * are": the `EpubBook` above it only asks "where is the resource with this id", and
 * never has to touch hrefs, relative resolution or the archive again.
 *
 * ## Declared but not in the archive does not mean the book will not open
 *
 * This layer **does not reject a whole book over a missing file**. A missing file is
 * only fatal when that item is on the readingOrder — at that point the reader really
 * is missing a stretch of content, and `epub-book.ts` throws `missing-resource`.
 *
 * The basis is a measurement, not an inference. Two passes over the sample of 33
 * commercial Traditional/Simplified Chinese books:
 *
 * - Under the original "refuse to open if any manifest item is missing" rule,
 *   **33/33 open** — not one book in this set was caught by that rule, so its return
 *   was zero
 * - Removing any resource **not on the readingOrder** from the archive (an
 *   illustration, a stylesheet, an NCX) makes **33/33 fail to open entirely**. And
 *   these books' manifests hold 3045 items in total, of which **1467** are off the
 *   readingOrder — each one a single point that can keep the whole book from opening
 *
 * A book missing a decorative illustration still reads through to the end, and "this
 * book will not open" is the failure mode a reader can least accept. The direction of
 * the trade-off is set by ADR-0010: what the reader wants is for the book to open.
 *
 * Escaping the package root (`resource-outside-container`) **still rejects the book
 * on the spot**. It differs from a missing file: it is non-conforming, and also the
 * shape of a path traversal, and not one book in the sample does it — relaxing it
 * buys nothing measurable.
 */
export interface Resource {
  readonly id: string;
  readonly location: ResourceLocation;
  readonly mediaType: string;
  readonly properties: readonly string[];
}

/**
 * Where a resource actually lands.
 *
 * "The declared location" and "whether anything is there" are expressed separately,
 * because they are handled differently: whether a missing file is fatal depends on
 * who is using it, and a remote resource in the manifest is conforming to begin
 * with. Collapsing both into `path: undefined` would leave the layer above unable to
 * tell "the book wrote it wrong" from "this item was never in the package".
 */
export type ResourceLocation =
  /** Inside the archive, and that entry really exists. */
  | { readonly kind: "in-container"; readonly path: string }
  /** Resolves to a location inside the archive, but that entry does not exist. `path` is where the book declared it, for diagnostics. */
  | { readonly kind: "missing"; readonly path: string }
  /** An absolute URL. EPUB 3 allows remote resources (`properties="remote-resources"`); frond does not download them. */
  | { readonly kind: "remote" };

export function resolveResources(
  manifest: readonly ManifestItem[],
  container: EpubContainer,
): ReadonlyMap<string, Resource> {
  const resources = new Map<string, Resource>();

  for (const item of manifest) {
    const resolved = resolveHref(item.href, container.packageDocumentPath);

    if (resolved.kind === "outside-container") {
      throw new EpubOpenError(
        "resource-outside-container",
        `manifest item ${item.id} points outside the package: href="${item.href}"`,
      );
    }

    resources.set(item.id, {
      id: item.id,
      location:
        resolved.kind === "remote"
          ? { kind: "remote" }
          : container.has(resolved.path)
            ? { kind: "in-container", path: resolved.path }
            : { kind: "missing", path: resolved.path },
      mediaType: item.mediaType,
      properties: item.properties,
    });
  }

  return resources;
}
