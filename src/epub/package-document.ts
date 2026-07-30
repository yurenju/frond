import { EpubOpenError } from "./errors.ts";
import { parseXml, type XmlElement } from "./xml.ts";

/**
 * The package document (OPF) — a book's declaration about itself: what version it
 * is, what it is called, which files it is made of, and in what order they are read.
 *
 * This layer **only reads; it neither resolves paths nor looks anything up**: an
 * `href` is copied verbatim, and mapping it onto an archive entry is
 * `epub-book.ts`'s job (that requires knowing where the package document itself is).
 * This cut keeps "how the book declares things" and "where the files are" separately
 * readable and testable.
 */

/** The supported packaging versions. For the range and its boundary see ADR-0010. */
export type EpubVersion = "epub2" | "epub3";

export interface ManifestItem {
  readonly id: string;
  /** The href relative to the package document, copied verbatim — including `../` and percent-encoding. */
  readonly href: string;
  readonly mediaType: string;
  /** `properties` is a whitespace-separated list, not a single value. */
  readonly properties: readonly string[];
}

export interface ReadingOrderItem {
  readonly idref: string;
  /** Items with `linear="no"` are outside the linear reading progression (cover pages, copyright pages). */
  readonly linear: boolean;
}

/**
 * The page progression direction — which way turning a page advances
 * (`<spine page-progression-direction>`).
 *
 * **A different thing from the writing mode** (CONTEXT.md): vertical/horizontal is
 * written in the stylesheet and reported by `Renderer`. What is reported here is the
 * page turn direction the book declares in its package document.
 */
export type PageProgressionDirection = "ltr" | "rtl";

/**
 * A book's declaration about itself.
 *
 * Every field may be `undefined` — **if the book did not say, report that it did not
 * say**, without filling in defaults (ADR-0002: frond supplies facts, the consumer
 * supplies policy). Whether a bookshelf shows "Unknown author" or leaves it blank is
 * policy, and once `EpubBook` turns "did not say" into an empty string or `"ltr"`,
 * the consumer can never tell the difference again.
 */
export interface BookMetadata {
  /** `dc:title`. */
  readonly title: string | undefined;
  /** `dc:creator`, in document order. An empty list when none is declared. */
  readonly authors: readonly string[];
  /** `dc:language`, a BCP 47 language tag, copied verbatim. */
  readonly language: string | undefined;
  /**
   * The `dc:identifier` that `<package unique-identifier>` points at, copied
   * verbatim.
   *
   * A bookshelf relies on it to recognise "these two files are the same book", so it
   * is reported alongside the metadata.
   */
  readonly identifier: string | undefined;
  /** The version the package document declares. */
  readonly epubVersion: EpubVersion;
  /**
   * The page progression direction. **`undefined` when the book did not say, not
   * `"ltr"`** (ADR-0010) — EPUB 2 always lands in this case, because that version has
   * no such attribute at all.
   *
   * What is reported here is **not the writing mode**: vertical/horizontal is
   * written in the stylesheet and reported by `Renderer`.
   */
  readonly pageProgressionDirection: PageProgressionDirection | undefined;
}

export interface PackageDocument {
  readonly metadata: BookMetadata;
  /**
   * The manifest **id** (not href) that `<meta name="cover" content="…">` points at.
   *
   * This is the only way EPUB 2 declares a cover, and EPUB 3 books commonly write it
   * too (30 books in the sample write both, and one more EPUB 3 book writes only
   * this one), so it does not disappear with the version.
   */
  readonly coverMetaId: string | undefined;
  readonly manifest: readonly ManifestItem[];
  readonly readingOrder: readonly ReadingOrderItem[];
  /**
   * The manifest **id** that `<spine toc="…">` points at — EPUB 2 uses it to say
   * where the NCX is.
   *
   * This is the only way a package document points at a navigation document (EPUB 3
   * switched to the manifest's `properties="nav"`), so it is read out along with the
   * package document, and `toc.ts` decides what to do with it.
   */
  readonly readingOrderTocId: string | undefined;
}

export function parsePackageDocument(
  source: string,
  label: string,
): PackageDocument {
  const document = parseXml(source, {
    reason: "malformed-package-document",
    label,
  });
  const packageElement = document.child("package");
  if (packageElement === undefined) {
    throw new EpubOpenError(
      "malformed-package-document",
      `${label} has no <package> root element`,
    );
  }

  const metadata = packageElement.child("metadata");
  const readingOrderElement = pickReadingOrder(packageElement, label);

  return {
    metadata: {
      title: firstText(metadata?.children("title") ?? []),
      // Every author is taken in document order, without filtering on `opf:role`:
      // `role` is optional, not one book in the sample needs it to tell its authors
      // apart, and filtering on it would leave books that omit role with no authors.
      authors: (metadata?.children("creator") ?? [])
        .map((creator) => creator.text())
        .filter((name) => name !== ""),
      language: firstText(metadata?.children("language") ?? []),
      identifier: readIdentifier(packageElement, metadata),
      epubVersion: readVersion(packageElement, label),
      pageProgressionDirection: readPageProgressionDirection(readingOrderElement),
    },
    coverMetaId: (metadata?.children("meta") ?? [])
      .find((meta) => meta.attribute("name") === "cover")
      ?.attribute("content"),
    manifest: readManifest(packageElement, label),
    readingOrder: readReadingOrder(readingOrderElement),
    readingOrderTocId: readingOrderElement.attribute("toc"),
  };
}

/**
 * The book's identifier.
 *
 * The `<dc:identifier>` that `<package unique-identifier>` points at is this book's
 * identifier — a book may carry several identifiers (ISBN, UUID, a retailer's own
 * number), and picking the wrong one makes one book appear twice on a shelf. When
 * nothing is pointed at, this falls back to the first, because what the reader wants
 * is for the book to open.
 *
 * The value is taken verbatim, without interpreting which kind of identifier
 * `opf:scheme` claims it is (ADR-0010).
 */
function readIdentifier(
  packageElement: XmlElement,
  metadata: XmlElement | undefined,
): string | undefined {
  const identifiers = metadata?.children("identifier") ?? [];
  const uniqueId = packageElement.attribute("unique-identifier");
  const declared = identifiers.find(
    (identifier) => identifier.attribute("id") === uniqueId,
  );
  return firstText(declared === undefined ? identifiers : [declared]);
}

/**
 * Only `ltr` and `rtl` are recognised. The semantics of EPUB 3's third permitted
 * value, `default`, are exactly "do not specify a direction" — the same case as the
 * attribute being absent, so that too reports "the book did not say" rather than
 * picking a direction.
 */
function readPageProgressionDirection(
  readingOrderElement: XmlElement,
): PageProgressionDirection | undefined {
  const declared = readingOrderElement.attribute("page-progression-direction");
  return declared === "ltr" || declared === "rtl" ? declared : undefined;
}

/**
 * `<package version>`.
 *
 * The boundary ADR-0010 draws is enforced here: 2.x and 3.x are supported, and
 * **everything else is explicitly rejected**. OEBPS 1.2 and OEB 1.0 package
 * documents are structurally a different format, and forcing a read of them only
 * fails deeper down in a harder-to-understand way.
 */
function readVersion(packageElement: XmlElement, label: string): EpubVersion {
  const version = packageElement.attribute("version")?.trim();
  // Compare the major version rather than a prefix: `version="3"` without the
  // decimal point is still EPUB 3, and comparing against `"3."` would wrongly reject
  // it.
  const major = version?.split(".")[0];
  if (major === "3") return "epub3";
  if (major === "2") return "epub2";

  throw new EpubOpenError(
    "unsupported-package-version",
    version === undefined
      ? `${label}'s <package> declares no version`
      : `unsupported packaging version ${version} (frond supports EPUB 2.x and 3.x; see ADR-0010)`,
  );
}

function readManifest(
  packageElement: XmlElement,
  label: string,
): readonly ManifestItem[] {
  const manifest = packageElement.child("manifest");
  if (manifest === undefined) {
    throw new EpubOpenError(
      "malformed-package-document",
      `${label} has no <manifest>`,
    );
  }

  return manifest.children("item").map((item) => ({
    id: item.attribute("id") ?? "",
    href: item.attribute("href") ?? "",
    mediaType: item.attribute("media-type") ?? "",
    properties: (item.attribute("properties") ?? "")
      .split(/\s+/)
      .filter((property) => property !== ""),
  }));
}

/**
 * The element name for the readingOrder in the packaging format is `spine`.
 * CONTEXT.md lists spine as _Avoid_, so that word appears only in this one function
 * that reads it; everywhere else it is called readingOrder.
 */
function pickReadingOrder(
  packageElement: XmlElement,
  label: string,
): XmlElement {
  const element = packageElement.child("spine");
  if (element === undefined) {
    throw new EpubOpenError(
      "malformed-package-document",
      `${label} has no <spine>, so this book declares no readingOrder`,
    );
  }
  return element;
}

function readReadingOrder(
  readingOrderElement: XmlElement,
): readonly ReadingOrderItem[] {
  return readingOrderElement.children("itemref").map((itemref) => ({
    idref: itemref.attribute("idref") ?? "",
    linear: itemref.attribute("linear") !== "no",
  }));
}

function firstText(elements: readonly XmlElement[]): string | undefined {
  const text = elements[0]?.text();
  return text === undefined || text === "" ? undefined : text;
}
