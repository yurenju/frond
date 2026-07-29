import { sha1, SHA1_LENGTH } from "../sha1.ts";
import { zip, type ZipEntry } from "./zip.ts";

/**
 * Assembles EPUB bytes from a declarative specification.
 *
 * This layer only knows how to assemble a conforming book; it knows nothing about
 * ailments — ailments are expressed in `ailments.ts` as single-point differences against
 * one shared healthy skeleton. This cut is how the requirement "one fixture carries one
 * ailment" is implemented: were ailments scattered through the assembly logic, sooner or
 * later two of them would share an `if`, and the fixtures would start contaminating each
 * other.
 *
 * ## EPUB versions
 *
 * This layer recognises two **versions** (`EpubVersion`): EPUB 3 and EPUB 2. At the
 * packaging layer they are two different shapes, not one skeleton plus an NCX — the latter
 * is the shape inferred from the spec, a model book rather than the shape books actually
 * have (ADR-0010). Every difference is contained in this file, and `ailments.ts` only
 * names which one it wants.
 *
 * **It is not called a "vehicle"**: CONTEXT.md reserves that word for the **navigation
 * document** (`nav.xhtml` and `toc.ncx`), and the version and the navigation vehicle are
 * two different things — ADR-0010's rule 3 is precisely about the "declares 3.x but has
 * only an NCX" case, which cannot be stated at all if the two words are conflated. Issue
 * #22 says vehicle, and that was written before CONTEXT.md narrowed the term.
 *
 * A version governs only the **packaging layer**: the package document, the navigation
 * document, and how the cover is declared. Content documents (XHTML) share one template
 * across both versions. That boundary is deliberate — content documents are what
 * `Renderer` sees, and letting them fork by version would double every content-layer
 * ailment.
 */

/** The container media type OCF mandates. */
const MIMETYPE = "application/epub+zip";

/** The directory the book's content lives in. OCF mandates no name; EPUB 3's convention is `EPUB/`. */
const CONTENT_DIRECTORY = "EPUB";

const PACKAGE_DOCUMENT_PATH = "package.opf";
const STYLESHEET_PATH = "style.css";

/** Where OCF declares obfuscation and encryption. */
const ENCRYPTION_PATH = "META-INF/encryption.xml";

/** The font obfuscation algorithm the EPUB spec defines itself. Adobe's is a different URI, and is not produced here. */
const IDPF_ALGORITHM = "http://www.idpf.org/2008/embedding";

/** IDPF masks only this many bytes at the head of the file. */
const IDPF_OBFUSCATED_LENGTH = 1040;

/**
 * A fixed last-modified time. EPUB 3 requires `dcterms:modified`, and taking "now" would
 * make the same input produce different bytes every time — the second leak in determinism
 * after ZIP mtimes.
 *
 * EPUB 2 has no such field, so that route never writes it — and therefore never has this
 * leak.
 */
const FIXED_MODIFIED = "2020-01-01T00:00:00Z";

/**
 * The packaging version. For the supported range see ADR-0010; `epub3` means EPUB 3.x and
 * `epub2` means EPUB 2.0.1.
 */
export type EpubVersion = "epub3" | "epub2";

/**
 * The version used when `EpubSpec.epubVersion` is omitted. This default has exactly one
 * definition — `ailments.ts`'s `epubVersionOf` reads it too, and writing `?? "epub3"` on
 * each side would create a second source of truth.
 */
export const DEFAULT_EPUB_VERSION: EpubVersion = "epub3";

/**
 * Each version's navigation document: manifest id, default path, media type.
 *
 * The id changes with the version too, because that is what `<spine toc="ncx">` points at
 * — an EPUB 2 NCX carrying `id="nav"` reads like an EPUB 3 navigation document with a
 * changed extension, and that is exactly the confusion this axis is trying to avoid.
 */
const NAVIGATION: Record<
  EpubVersion,
  { readonly id: string; readonly path: string; readonly mediaType: string }
> = {
  epub3: { id: "nav", path: "nav.xhtml", mediaType: "application/xhtml+xml" },
  epub2: { id: "ncx", path: "toc.ncx", mediaType: "application/x-dtbncx+xml" },
};

/**
 * How a cover is declared. **Both routes have to work, and it is not dispatched on
 * version** — one EPUB 3 book in the sample declares its cover only in the old notation
 * (ADR-0010). So this is an independent axis, not inferred from the version.
 */
export type CoverNotation = "cover-image-property" | "meta-name";

const COVER_ID = "cover-image";

/**
 * The TOC's second level — a sub-entry hanging under some Section.
 *
 * The position is a fragment rather than another file's path: in the sample's nested
 * EPUB 2 (Sigil → calibre), the second level points at an id within the same Section, and
 * **the same NCX mixes entries with and without fragments** — omitting `fragment` is the
 * latter kind.
 */
export interface TocSubitemSpec {
  readonly title: string;
  /**
   * Which id within the Section this sub-entry points at. Omitted, it points at the start
   * of the Section, which is the same href as the level above — a shape that really does
   * occur in real books, not a defect.
   *
   * When a value is given, the Section's `body` has to actually contain that id, or this
   * fixture carries a second ailment: "the TOC points at a non-existent anchor".
   */
  readonly fragment?: string;
}

export interface SectionSpec {
  /** The path relative to the content directory, e.g. `section-1.xhtml`. */
  readonly path: string;
  readonly title: string;
  /** The XHTML `<body>` content, already valid XML. */
  readonly body: string;
  /**
   * The href the TOC uses to point at this Section, relative to the navigation document.
   * Omitted, it is derived from the path. Ailment fixtures use it to express "the TOC's
   * href is written differently from the Section's actual position".
   *
   * Both versions share this field: EPUB 3 writes it into `nav.xhtml`'s `<a href>`, and
   * EPUB 2 into the NCX's `<content src>`. The broken TOCs actually measured are precisely
   * on NCXs (ADR-0010, #23).
   */
  readonly navHref?: string;
  /**
   * This Section's sub-entries in the TOC. Omitted or empty, the TOC is flat at this entry.
   *
   * Nesting is a level of the TOC, not of the readingOrder — the readingOrder is always one
   * flat run. The two vehicles express the same tree in different shapes (`<ol>` nested in
   * `<ol>` versus navPoint nested in navPoint), so each has its own way of being parsed
   * wrongly (#23).
   */
  readonly subitems?: readonly TocSubitemSpec[];
}

export interface ResourceSpec {
  /**
   * The href written into the manifest, which also determines where this resource sits in
   * the archive. Relative to the package document — and the package document is inside the
   * content directory, so `images/plate.png` works as before.
   *
   * `../` up to the package root is allowed: an href of `../js/reader.js` lands on
   * `js/reader.js` in the archive, and that is the shape of a real retail book (Kobo),
   * conforming and resolvable (the comment on #8, #23). A path that escapes the package
   * root is rejected — that one really is non-conforming.
   */
  readonly path: string;
  readonly mediaType: string;
  readonly contents: Uint8Array;
  /**
   * Whether this item should be obfuscated before being written into the archive. Giving a
   * value also writes out a `META-INF/encryption.xml` declaring it.
   *
   * There is only `"idpf"`: Adobe's uses a different key derivation and length, and frond's
   * handling of it is an explicit error (`src/epub/font-obfuscation.ts`). Making a fixture
   * for that route would first require the generator to grow the ability to produce Adobe
   * obfuscation, which is another issue's business.
   */
  readonly obfuscation?: "idpf";
}

export interface CoverSpec extends ResourceSpec {
  /**
   * Which notation declares it; both may be given — real books commonly write both (30 in
   * the sample). An empty array would mean "there is an image but nothing declares it",
   * which is a meaningless shape and is rejected.
   */
  readonly declaredBy: readonly CoverNotation[];
}

export interface EpubSpec {
  /**
   * The packaging version. Omitted, it is `"epub3"` — every existing fixture lands there,
   * and the default keeps their bytes from drifting merely because this axis appeared.
   */
  readonly epubVersion?: EpubVersion;
  readonly title: string;
  /** A BCP 47 language tag. It drives regional face selection; see docs/test-environment.md. */
  readonly language: string;
  /** A fixed unique identifier. It must not be random — that would be a leak in determinism. */
  readonly identifier: string;
  readonly stylesheet: string;
  /** The readingOrder. In the EPUB packaging format it is called `<spine>`, which is the spec's term for the serialised format. */
  readonly readingOrder: readonly SectionSpec[];
  /**
   * Omitted, the attribute is not written out, which is equivalent to the spec's default of
   * `ltr`. "Not declared" and "declared as ltr" are deliberately distinguished —
   * `ppd-rtl-vertical`'s ailment is on exactly this attribute.
   *
   * EPUB 2 has no such attribute, and giving both is rejected.
   */
  readonly pageProgressionDirection?: "ltr" | "rtl";
  /** The navigation document's path, relative to the content directory. The default differs by version; see `NAVIGATION`. */
  readonly navigationPath?: string;
  /**
   * Omitted, `<nav>` sits directly under `<body>`. Set, it is wrapped in a `<section>`,
   * which is what `nav-inside-section` needs and what EPUB 3 permits — the spec
   * constrains the `toc` nav's own content model, not where in the document it hangs.
   *
   * EPUB 2 has no navigation document to wrap, and giving both is rejected.
   */
  readonly navInsideSection?: boolean;
  /** Omitted, this book has no cover. That is not a defect, it is a shape that has to be tested (ADR-0010). */
  readonly cover?: CoverSpec;
  readonly resources?: readonly ResourceSpec[];
}

export function buildEpub(spec: EpubSpec): Uint8Array {
  const epubVersion = spec.epubVersion ?? DEFAULT_EPUB_VERSION;
  assertCoherent(spec, epubVersion);

  const navigationPath = spec.navigationPath ?? NAVIGATION[epubVersion].path;
  // The cover's bytes go through the same route as every other resource; only the manifest
  // side differs (see packageDocument). The cover comes first, keeping the archive's entry
  // order stable.
  const resources = [
    ...(spec.cover === undefined ? [] : [spec.cover]),
    ...(spec.resources ?? []),
  ];

  const obfuscated = resources.filter((resource) => resource.obfuscation !== undefined);

  const entries: ZipEntry[] = [
    // mimetype has to be the first entry and uncompressed (zip.ts is always stored, so the
    // second half holds automatically). Readers sniff whether this is an EPUB at a fixed
    // offset.
    { path: "mimetype", contents: encode(MIMETYPE) },
    { path: "META-INF/container.xml", contents: encode(containerXml()) },
    // With no obfuscated items this file is not written — writing an empty encryption.xml
    // anyway would make the probe "does this book have obfuscation" true for every fixture.
    ...(obfuscated.length === 0
      ? []
      : [
          {
            path: ENCRYPTION_PATH,
            contents: encode(
              encryptionXml(obfuscated.map((resource) => contentPath(resource.path))),
            ),
          },
        ]),
    {
      path: contentPath(PACKAGE_DOCUMENT_PATH),
      contents: encode(packageDocument(spec, epubVersion, navigationPath)),
    },
    {
      path: contentPath(navigationPath),
      contents: encode(
        epubVersion === "epub2"
          ? navigationControlFile(spec, navigationPath)
          : navigationDocument(spec, navigationPath),
      ),
    },
    { path: contentPath(STYLESHEET_PATH), contents: encode(spec.stylesheet) },
    ...spec.readingOrder.map((section) => ({
      path: contentPath(section.path),
      contents: encode(sectionDocument(spec, section)),
    })),
    ...resources.map((resource) => ({
      path: contentPath(resource.path),
      contents:
        resource.obfuscation === undefined
          ? resource.contents
          : obfuscate(resource.contents, spec.identifier),
    })),
  ];

  return zip(entries);
}

/**
 * Whether the version and the other fields make sense together (EPUB version × cover
 * notation).
 *
 * This throws rather than silently correcting: a book produced from an incoherent
 * combination **looks fine** (one extra attribute, one extra field), no downstream test
 * goes red, and it would then be taken as "the shape books actually have" and used to test
 * parsing.
 */
function assertCoherent(spec: EpubSpec, epubVersion: EpubVersion): void {
  if (epubVersion === "epub2" && spec.pageProgressionDirection !== undefined) {
    throw new Error(
      "EPUB 2 has no page-progression-direction (ADR-0010: EPUB 2 always lands in the \"the book did not say\" case)",
    );
  }

  if (epubVersion === "epub2" && spec.navInsideSection === true) {
    throw new Error(
      "EPUB 2's navigation document is the NCX, which has no <section> to wrap a <nav> in",
    );
  }

  if (spec.cover === undefined) return;

  if (spec.cover.declaredBy.length === 0) {
    throw new Error("a cover needs at least one notation declaring it, or nothing points at it");
  }
  if (epubVersion === "epub2" && spec.cover.declaredBy.includes("cover-image-property")) {
    throw new Error(
      'an EPUB 2 manifest has no properties attribute; a cover can only go through <meta name="cover">',
    );
  }
}

/**
 * Which archive entry an href relative to the package document lands on.
 *
 * `..` **really has to be absorbed** here rather than just concatenated: the literal entry
 * name `EPUB/../js/reader.js` exists in no archive, and a book written that way is a good
 * book (the comment on #8). This is precisely the step where "concatenate the href onto the
 * content directory" reports a false positive on a good book.
 */
function contentPath(path: string): string {
  const segments: string[] = [CONTENT_DIRECTORY];
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    if (segments.length === 0) {
      throw new Error(`href escapes the package root, which is non-conforming: ${path}`);
    }
    segments.pop();
  }
  return segments.join("/");
}

/**
 * Obfuscates a resource with the IDPF algorithm.
 *
 * **This is the inverse of `src/epub/font-obfuscation.ts`, and is deliberately written out
 * a second time.** Were both sides to share one implementation, any misunderstanding of the
 * algorithm would hold on the obfuscating and the restoring side alike, "what comes out
 * equals the original" would still be green, and real books in a reader's hands would be a
 * page full of tofu — `epub-archive.ts` reading our own output with an external library is
 * the same discipline.
 *
 * The only thing shared is `sha1()`: it is a primitive rather than part of this algorithm,
 * and it is itself checked entry by entry against `node:crypto`
 * (`tests/node/sha1.test.ts`), so sharing it hides no errors.
 */
function obfuscate(contents: Uint8Array, identifier: string): Uint8Array {
  const key = sha1(encode(stripWhitespace(identifier)));
  const obfuscated = Uint8Array.from(contents);
  const end = Math.min(obfuscated.length, IDPF_OBFUSCATED_LENGTH);
  for (let index = 0; index < end; index += 1) {
    obfuscated[index] = obfuscated[index]! ^ key[index % SHA1_LENGTH]!;
  }
  return obfuscated;
}

/** The four whitespace code points the spec names for removal: space, tab, CR, LF. */
const IDPF_KEY_WHITESPACE = [0x20, 0x09, 0x0d, 0x0a];

function stripWhitespace(identifier: string): string {
  return [...identifier]
    .filter((character) => !IDPF_KEY_WHITESPACE.includes(character.codePointAt(0)!))
    .join("");
}

function encryptionXml(paths: readonly string[]): string {
  // The `enc:` prefix is how real books write it (the xmlenc namespace). The prefix is
  // stripped by the read side, so writing it here also exercises the "do not match prefixes
  // literally" route.
  const declarations = paths
    .map(
      (path) => `  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="${IDPF_ALGORITHM}"/>
    <enc:CipherData>
      <enc:CipherReference URI="${path}"/>
    </enc:CipherData>
  </enc:EncryptedData>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
${declarations}
</encryption>
`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${contentPath(PACKAGE_DOCUMENT_PATH)}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function manifestItem(
  id: string,
  resource: ResourceSpec,
  properties: string,
): string {
  return `    <item id="${id}" href="${resource.path}" media-type="${resource.mediaType}"${properties}/>`;
}

function coverProperties(cover: CoverSpec): string {
  return cover.declaredBy.includes("cover-image-property")
    ? ' properties="cover-image"'
    : "";
}

function packageDocument(
  spec: EpubSpec,
  epubVersion: EpubVersion,
  navigationPath: string,
): string {
  const epub2 = epubVersion === "epub2";

  const manifest = [
    // EPUB 3 marks the navigation document with properties="nav"; EPUB 2 has no such
    // attribute and points at the NCX's id through the spine's toc attribute.
    `    <item id="${NAVIGATION[epubVersion].id}" href="${navigationPath}" media-type="${NAVIGATION[epubVersion].mediaType}"${epub2 ? "" : ' properties="nav"'}/>`,
    `    <item id="stylesheet" href="${STYLESHEET_PATH}" media-type="text/css"/>`,
    ...spec.readingOrder.map(
      (section, index) =>
        `    <item id="${sectionId(index)}" href="${section.path}" media-type="application/xhtml+xml"/>`,
    ),
    // The cover is its own item and takes no part in the resource-N numbering. Numbered
    // together, adding a cover to a book would shift every other resource's id, and the id
    // is what <meta name="cover"> points at — after the shift the cover points at a
    // different resource, and nothing would report an error.
    ...(spec.cover === undefined ? [] : [manifestItem(COVER_ID, spec.cover, coverProperties(spec.cover))]),
    ...(spec.resources ?? []).map((resource, index) =>
      manifestItem(`resource-${index + 1}`, resource, ""),
    ),
  ].join("\n");

  const readingOrder = spec.readingOrder
    .map((_, index) => `    <itemref idref="${sectionId(index)}"/>`)
    .join("\n");

  const direction =
    spec.pageProgressionDirection === undefined
      ? ""
      : ` page-progression-direction="${spec.pageProgressionDirection}"`;

  const metadata = [
    // An EPUB 2 dc:identifier carries opf:scheme declaring which kind of identifier it
    // claims to be. frond does not interpret it (ADR-0010), but real books write it, and
    // books produced by calibre have exactly this shape.
    `    <dc:identifier id="pub-id"${epub2 ? ' opf:scheme="uuid"' : ""}>${escapeXml(spec.identifier)}</dc:identifier>`,
    `    <dc:title>${escapeXml(spec.title)}</dc:title>`,
    `    <dc:language>${spec.language}</dc:language>`,
    // dcterms:modified only exists in EPUB 3. It has no place on the EPUB 2 route, so that
    // fixed timestamp does not appear there either.
    ...(epub2 ? [] : [`    <meta property="dcterms:modified">${FIXED_MODIFIED}</meta>`]),
    // <meta name="cover"> points at a manifest item's **id**, not its href.
    ...(spec.cover !== undefined && spec.cover.declaredBy.includes("meta-name")
      ? [`    <meta name="cover" content="${COVER_ID}"/>`]
      : []),
  ].join("\n");

  // EPUB 2's metadata has to declare the opf prefix to use opf:scheme; EPUB 3 does not.
  const metadataNamespaces = epub2
    ? ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"'
    : ' xmlns:dc="http://purl.org/dc/elements/1.1/"';

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${epub2 ? "2.0" : "3.0"}" unique-identifier="pub-id"${epub2 ? "" : ` xml:lang="${spec.language}"`}>
  <metadata${metadataNamespaces}>
${metadata}
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine${epub2 ? ` toc="${NAVIGATION[epubVersion].id}"` : ""}${direction}>
${readingOrder}
  </spine>
</package>
`;
}

/**
 * One node of the TOC to be written out. **Both vehicles share this tree** — every
 * difference in shape is in the rendering step, not in the tree. Building two trees would
 * make "the same TOC grows into two shapes on nav and on NCX" a mere coincidence, and the
 * two nested fixtures are precisely a pair meant to be compared (#23).
 *
 * The name carries `Spec` to keep it apart from the tree **read back**:
 * `tests/node/support/epub-archive.ts` exports a `TocNode`, which is a node obtained by
 * parsing the output and carries an extra `archivePath`. The two are the two ends of one
 * concept, but their shapes differ, and sharing a name would only suggest they are
 * interchangeable.
 */
interface TocSpecNode {
  readonly title: string;
  /** The href relative to the navigation document. */
  readonly href: string;
  readonly children: readonly TocSpecNode[];
}

function tocTree(spec: EpubSpec, navigationPath: string): readonly TocSpecNode[] {
  return spec.readingOrder.map((section) => {
    const href = section.navHref ?? relativeHref(section.path, navigationPath);
    return {
      title: section.title,
      href,
      children: (section.subitems ?? []).map((subitem) => ({
        title: subitem.title,
        href: subitem.fragment === undefined ? href : `${href}#${subitem.fragment}`,
        children: [],
      })),
    };
  });
}

/** How many levels this tree has. A wholly flat TOC is 1, and that is the number the NCX's `dtb:depth` has to carry. */
function tocDepth(nodes: readonly TocSpecNode[]): number {
  return nodes.reduce(
    (deepest, node) => Math.max(deepest, 1 + tocDepth(node.children)),
    0,
  );
}

/**
 * `nav.xhtml`'s nesting notation: a sub-list is another `<ol>` **hung inside the `<li>`**,
 * not a sibling of the `<li>`. Placed as a sibling the XHTML is still well-formed and the
 * browser still draws it, but that tree is flat — this is the most typical way of getting
 * this vehicle wrong, and it is invisible in a single-level TOC.
 */
function navigationItems(nodes: readonly TocSpecNode[], indent: number): string {
  const pad = " ".repeat(indent);
  return nodes
    .map((node) => {
      const anchor = `<a href="${node.href}">${escapeXml(node.title)}</a>`;
      if (node.children.length === 0) return `${pad}<li>${anchor}</li>`;
      return [
        `${pad}<li>${anchor}`,
        `${pad}  <ol>`,
        navigationItems(node.children, indent + 4),
        `${pad}  </ol>`,
        `${pad}</li>`,
      ].join("\n");
    })
    .join("\n");
}

function navigationDocument(spec: EpubSpec, navigationPath: string): string {
  const wrapped = spec.navInsideSection === true;
  const indent = wrapped ? "      " : "    ";
  const items = navigationItems(tocTree(spec, navigationPath), wrapped ? 12 : 8);

  const nav = `${indent}<nav epub:type="toc">
${indent}  <h1>${escapeXml(spec.title)}</h1>
${indent}  <ol>
${items}
${indent}  </ol>
${indent}</nav>`;

  const body = wrapped
    ? `    <section epub:type="frontmatter">
${nav}
    </section>`
    : nav;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${spec.language}" lang="${spec.language}">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(spec.title)}</title>
  </head>
  <body>
${body}
  </body>
</html>
`;
}

/**
 * EPUB 2's navigation document — the NCX (Navigation Control file for XML, from DAISY).
 *
 * It is not XHTML: navPoint nesting is the TOC's nesting, the label is in
 * `<navLabel><text>` and the position in `<content src>`. `nav.xhtml` nests `<ol>` in
 * `<ol>`; this nests navPoint in navPoint — different shapes, so each has its own way of
 * being parsed wrongly (#23).
 */
function navigationControlFile(spec: EpubSpec, navigationPath: string): string {
  const tree = tocTree(spec, navigationPath);

  // playOrder is the reading order the NCX declares for itself, and it agrees with the
  // navPoints' document order in a conforming book — **including the nested parts**: it is
  // the ordinal over the whole tree flattened, not restarting from 1 at each level. frond
  // does not rely on it for ordering, but real books all write it (the one in the sample
  // runs 1..48 consecutively), and without it this would differ from real books.
  let playOrder = 0;
  const renderNavPoints = (nodes: readonly TocSpecNode[], indent: number): string => {
    const pad = " ".repeat(indent);
    return nodes
      .map((node) => {
        playOrder += 1;
        // Record our own ordinal before descending: the children push the counter up, and
        // the template string only takes its value after the children have been computed.
        // Without this line the parent would get the last ordinal the subtree used.
        const order = playOrder;
        // Sub-entries are written **inside** the navPoint rather than as its siblings —
        // that is the NCX's only way of expressing levels, and also the most typical way of
        // getting this vehicle wrong.
        const children =
          node.children.length === 0
            ? ""
            : `\n${renderNavPoints(node.children, indent + 2)}`;
        return `${pad}<navPoint id="navpoint-${order}" playOrder="${order}">
${pad}  <navLabel><text>${escapeXml(node.title)}</text></navLabel>
${pad}  <content src="${node.href}"/>${children}
${pad}</navPoint>`;
      })
      .join("\n");
  };

  const navPoints = renderNavPoints(tree, 4);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${spec.language}">
  <head>
    <meta name="dtb:uid" content="${escapeXml(spec.identifier)}"/>
    <meta name="dtb:depth" content="${tocDepth(tree)}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(spec.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}

function sectionDocument(spec: EpubSpec, section: SectionSpec): string {
  const stylesheet = relativeHref(STYLESHEET_PATH, section.path);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${spec.language}" lang="${spec.language}">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(section.title)}</title>
    <link rel="stylesheet" type="text/css" href="${stylesheet}"/>
  </head>
  <body>
${section.body}
  </body>
</html>
`;
}

function sectionId(index: number): string {
  return `section-${index + 1}`;
}

/**
 * The relative href from the document `from` to `target`. Both are paths relative to the
 * content directory.
 *
 * `node:path` is not used here: an EPUB href is a URL rather than a filesystem path, and on
 * Windows `path.relative` would give a `\`-separated result.
 */
function relativeHref(target: string, from: string): string {
  const fromSegments = from.split("/").slice(0, -1);
  const targetSegments = target.split("/");

  let shared = 0;
  while (
    shared < fromSegments.length &&
    shared < targetSegments.length - 1 &&
    fromSegments[shared] === targetSegments[shared]
  ) {
    shared += 1;
  }

  return [
    ...Array<string>(fromSegments.length - shared).fill(".."),
    ...targetSegments.slice(shared),
  ].join("/");
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
