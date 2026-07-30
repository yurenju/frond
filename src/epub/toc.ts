import type { EpubContainer } from "./container.ts";
import type { PackageDocument } from "./package-document.ts";
import { resolveHref, type ResolvedHref } from "./resource-path.ts";
import { parseXml, type XmlElement } from "./xml.ts";
import type { Resource } from "./resources.ts";

/**
 * The TOC — a book's table of contents: a hierarchy of titles paired with locations
 * (CONTEXT.md).
 *
 * **The TOC is the concept; the navigation document is the file carrying it**, and
 * frond supports two vehicles: EPUB 3's `nav.xhtml` and EPUB 2's `toc.ncx`. This
 * module reads both into the same tree, so a consumer's table-of-contents code does
 * not need two versions (user story 14).
 *
 * The two vehicles express the same tree in different shapes, and go wrong in
 * different ways:
 *
 * | | `nav.xhtml` | `toc.ncx` |
 * | --- | --- | --- |
 * | Label and location | one `<a>` carries both | `<navLabel><text>` and `<content src>` are two child elements |
 * | Hierarchy | the `<ol>` opens **inside** the `<li>` | a navPoint nests directly in a navPoint |
 *
 * So the two collect functions below stand alone — merging them into one generic
 * "recursively find labels" implementation would lose two things at once: `<a>`
 * elements outside the `<nav>` (landmarks) would be gathered into the TOC, and a
 * navigation document that puts its sub-list in the wrong place (as a sibling of the
 * `<li>` rather than inside it) would silently flatten.
 *
 * ## hrefs go through the same normalization as the manifest
 *
 * Every item's href is handed to `resolveHref()`, with the **navigation document
 * itself** as the base position in the archive — not the package document's position;
 * the two are not necessarily in the same directory (`toc-href-parent-prefix`). The
 * `%2c` and `../` ailments are therefore handled by one shared implementation, and
 * there is no string manipulation here at all.
 */

/** Which kind of file carries the TOC. */
export type NavigationVehicle = "nav" | "ncx";

/**
 * Which navigation document the TOC was read from (user story 15).
 *
 * Having both is the norm (all 31 EPUB 3 books in the sample do), and ADR-0010
 * mandates no merging and no cross-validation — so "which one was used" is the only
 * clue a consumer has for investigating an inconsistency. frond supplies the fact;
 * whether to warn the reader is the consumer's policy (ADR-0002).
 */
export interface NavigationDocument {
  readonly vehicle: NavigationVehicle;
  /** The path inside the archive. */
  readonly path: string;
}

/** One TOC entry. Sub-entries live under `children`, to unlimited depth. */
export interface TocItem {
  /** The title shown in the table of contents. */
  readonly label: string;
  /** The href copied verbatim from the navigation document, for diagnostics — the ailment is written right here. */
  readonly href: string;
  /**
   * Where the href points once resolved. When it lands inside the package it carries
   * `path` and `fragment`, which are the two values a consumer needs to jump.
   *
   * The type reuses the resolver's product directly rather than flattening it into
   * `path?` and `fragment?`: a TOC pointing at something remote (the book contains an
   * external link) or outside the package (the book is written wrong) should not keep
   * a book from opening, and collapsing both into `undefined` would leave the consumer
   * unable to tell "this is an external link" from "this book's TOC is written wrong".
   */
  readonly target: ResolvedHref;
  readonly children: readonly TocItem[];
}

export interface Toc {
  readonly items: readonly TocItem[];
  /** `undefined` when no navigation document is found at all, in which case `items` is empty. */
  readonly readFrom: NavigationDocument | undefined;
}

const NCX_MEDIA_TYPE = "application/x-dtbncx+xml";

/** An empty TOC. A book with no table of contents still reads through to the end (ADR-0010). */
const NO_TOC: Toc = { items: [], readFrom: undefined };

export function readToc(
  packageDocument: PackageDocument,
  resources: ReadonlyMap<string, Resource>,
  container: EpubContainer,
): Toc {
  const navigation = pickNavigationDocument(packageDocument, resources);
  if (navigation === undefined) return NO_TOC;

  const document = parseXml(container.text(navigation.path), {
    reason: "malformed-navigation-document",
    label: navigation.path,
  });

  const items =
    navigation.vehicle === "ncx"
      ? collectNcx(document.child("ncx")?.child("navMap"))
      : collectNav(pickTocNav(document));

  return { items: resolveTargets(items, navigation.path), readFrom: navigation };
}

/**
 * Which file carries this book's TOC. The order follows ADR-0010's "priority of
 * navigation documents":
 *
 * 1. When 3.x is declared, `properties="nav"` wins and the NCX is ignored entirely
 * 2. When 2.x is declared, the NCX is the only route
 * 3. When 3.x is declared but no nav is found, **fall back to the NCX** rather than
 *    throwing
 *
 * "Found" includes **that item actually being in the archive**: a navigation document
 * that is declared but whose file is missing lands in the same case as one that was
 * never declared (what is missing is the table of contents, not content), so this
 * keeps looking rather than throwing.
 *
 * ## The two ways to point at an NCX
 *
 * `<spine toc>` is the package document's formal way of pointing at an NCX, but
 * **books do not always write it**: all 33 books declare an NCX in their manifest,
 * and only 27 point at it with `<spine toc>` — the other 6 can only be found by media
 * type. All 6 have a nav, so rule 3 is never actually reached for them, but without
 * the media type fallback a book that "declares 3.x, has no nav, and never points at
 * its NCX" would have no table of contents, and every component of that is normal in
 * the wild.
 *
 * The media type is not inventing a fourth rule: ADR-0010 says which vehicle wins, and
 * says nothing about how to recognise it in the manifest, and
 * `application/x-dtbncx+xml` is the NCX's registered media type — no book will have a
 * second candidate. (`tests/node/support/epub-archive.ts` deliberately does **not**
 * implement this fallback, for the opposite reason: that layer reads fixtures we
 * generate ourselves, and being lenient would mean nothing turns red when the
 * generator forgets to write `<spine toc>`.)
 */
function pickNavigationDocument(
  packageDocument: PackageDocument,
  resources: ReadonlyMap<string, Resource>,
): NavigationDocument | undefined {
  const pathOf = (resource: Resource | undefined): string | undefined =>
    resource?.location.kind === "in-container" ? resource.location.path : undefined;

  if (packageDocument.metadata.epubVersion === "epub3") {
    const nav = [...resources.values()].find((resource) =>
      resource.properties.includes("nav"),
    );
    const path = pathOf(nav);
    if (path !== undefined) return { vehicle: "nav", path };
  }

  const declared =
    packageDocument.readingOrderTocId === undefined
      ? undefined
      : resources.get(packageDocument.readingOrderTocId);
  const ncx =
    declared ??
    [...resources.values()].find((resource) => resource.mediaType === NCX_MEDIA_TYPE);

  const path = pathOf(ncx);
  return path === undefined ? undefined : { vehicle: "ncx", path };
}

/**
 * Which `<nav>` inside `nav.xhtml` is the TOC.
 *
 * It is recognised by `epub:type="toc"` (the namespace prefix is stripped by
 * `xml.ts`, so the attribute name is `type`). Measured: of the 31 books that have a
 * nav, **27 have more than one `<nav>` in their navigation document** (usually also
 * landmarks and a page-list), and all 31 declare `epub:type` on the TOC one. An
 * implementation taking the first `<nav>` as the TOC stands a chance of picking up a
 * different list in those 27.
 *
 * ## The declared one is looked for at any depth; the fallback is not
 *
 * The two steps ask different questions on purpose.
 *
 * The declared `<nav>` is searched for **anywhere below `<body>`**, because the spec
 * puts no constraint there: "there are no restrictions on the structure or content of
 * the EPUB navigation document outside of the specialized navigation elements", and the
 * requirement is that the document *include* exactly one `toc` nav — the restrictions
 * that follow govern that element's own content model and its descendants, never its
 * ancestors. This was originally written as "a direct child of `<body>`" on a measured
 * 31/31, and it took **one book outside that sample** to break: the EPUB 3 sample
 * publication `草枕` wraps its perfectly conforming `<nav epub:type="toc">` in a
 * `<section epub:type="frontmatter">`, and frond read that book's table of contents as
 * empty (ADR-0007's second layer, #35). The measurement was not wrong; it was a
 * measurement of 31 books, and the shape it did not contain is legal.
 *
 * The fallback — the book declared no `epub:type` anywhere — stays a **direct child of
 * `<body>`**, and that asymmetry is the point. Without a declaration there is nothing
 * to distinguish the table of contents from any other list, and a navigation document
 * may be part of the linear reading order, so recursing at this step would let a `<nav>`
 * belonging to the prose become the TOC. Not one book in the sample reaches this branch;
 * it is kept for books not yet measured, and it should stay the conservative one.
 */
function pickTocNav(document: XmlElement): XmlElement | undefined {
  const body = document.child("html")?.child("body");
  if (body === undefined) return undefined;

  const declared = body
    .descendants("nav")
    .find((nav) => (nav.attribute("type") ?? "").split(/\s+/).includes("toc"));

  return declared ?? body.children("nav")[0];
}

/** One node whose href has not been resolved yet. */
interface RawTocItem {
  readonly label: string;
  readonly href: string;
  readonly children: readonly RawTocItem[];
}

/**
 * The `nav.xhtml` TOC: every `<li>` in an `<ol>` is one entry, the label and the
 * location both live on the `<a>`, and a sub-list is another `<ol>` opened **inside
 * the `<li>`**.
 *
 * "Inside" is the point: placed as a sibling of the `<li>` the XHTML is equally
 * well-formed and the browser draws it just the same, but that tree is flat.
 * Gathering children by the `<li>`'s boundary makes a book that puts them in the
 * wrong place visible in the depth.
 *
 * An `<li>` with no `<a>` (EPUB 3 permits a `<span>` for a non-navigable heading) is
 * skipped: not one appears in the sample, and taking it would mean inventing a
 * representation for "a TOC entry with no location".
 */
function collectNav(nav: XmlElement | undefined): readonly RawTocItem[] {
  const items = (list: XmlElement | undefined): readonly RawTocItem[] =>
    (list?.children("li") ?? []).flatMap((li) => {
      const anchor = li.child("a");
      if (anchor === undefined) return [];
      return [
        {
          label: anchor.text().trim(),
          href: anchor.attribute("href") ?? "",
          children: items(li.child("ol")),
        },
      ];
    });

  return items(nav?.child("ol"));
}

/**
 * The NCX TOC: the label is in `<navLabel><text>`, the location in `<content src>`,
 * and they are two **different** children of the navPoint — pairing them wrongly (for
 * instance taking the navPoint's id as the label) is invisible in a flat TOC. The
 * hierarchy is a navPoint nested directly in a navPoint, with no container element in
 * between.
 *
 * `playOrder` is not read: frond goes by document order, and ADR-0010 rules NCX's
 * `pageList` and `navList` out of v1 for the same reason `playOrder` is left out — it
 * is an ordering the NCX declares for itself, which agrees with document order in a
 * conforming book, and when it disagrees there is no reason to believe it.
 */
function collectNcx(navMap: XmlElement | undefined): readonly RawTocItem[] {
  return (navMap?.children("navPoint") ?? []).map((navPoint) => ({
    label: navPoint.child("navLabel")?.child("text")?.text().trim() ?? "",
    href: navPoint.child("content")?.attribute("src") ?? "",
    children: collectNcx(navPoint),
  }));
}

/** Resolves every item's href into a position inside the archive, leaving the hierarchy untouched. */
function resolveTargets(
  items: readonly RawTocItem[],
  navigationPath: string,
): readonly TocItem[] {
  return items.map((item) => ({
    label: item.label,
    href: item.href,
    target: resolveHref(item.href, navigationPath),
    children: resolveTargets(item.children, navigationPath),
  }));
}
