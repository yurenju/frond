import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * Reads an EPUB back from the bytes it was built into, so the fixture generator's
 * tests can assert on its structure.
 *
 * Everything here deliberately goes through **external** implementations: fflate for
 * decompression, fast-xml-parser for XML, WHATWG `URL` for resolving relative hrefs.
 * Reading the generator's output with the generator's own inverse operations would
 * make any misunderstanding of the format hold on both sides at once, and the tests
 * would stay green — that kind of test only proves the code agrees with itself.
 *
 * This layer is not a prototype of `EpubBook`, and should not grow into one (#8). It
 * only needs to be enough to ask "is this output a conforming book".
 */

/** The root element name of the package document. */
const PACKAGE_ELEMENT = "package";

/**
 * What readingOrder is called in the EPUB packaging format. CONTEXT.md lists `spine`
 * under _Avoid_ — this constant is the spec's on-the-wire term, not an identifier, so
 * it appears here once and everywhere else it is readingOrder.
 */
const READING_ORDER_ELEMENT = "spine";

/** A fake origin for resolving relative hrefs. Only used to borrow WHATWG URL's rules. */
const RESOLUTION_ORIGIN = "https://frond.invalid/";

export interface ManifestItem {
  readonly id: string;
  /** The href relative to the package document, copied verbatim. */
  readonly href: string;
  readonly mediaType: string;
  readonly properties: string | undefined;
  /** The path inside the archive the href resolves to. */
  readonly archivePath: string;
}

export interface TocEntry {
  readonly label: string;
  /** The href relative to the navigation document, copied verbatim — the ailment is written right here. */
  readonly href: string;
  /** The path inside the archive the href resolves to (percent-encoding undone). */
  readonly archivePath: string;
}

/**
 * One TOC node, **with its hierarchy kept**.
 *
 * This is a different question from the flattened `toc`, which is why both exist: the
 * href ailments (`%2c`, `../`) ask what each entry is written as, and flattened is
 * easier to ask that of; nesting asks what shape the tree has, and that disappears
 * once flattened — with only the flattened version, a navigation document that puts
 * sub-entries in as siblings would come out green.
 */
export interface TocNode extends TocEntry {
  readonly children: readonly TocNode[];
}

/** Which kind of file carries the TOC. EPUB 3 is `nav.xhtml`, EPUB 2 is `toc.ncx`. */
export type NavigationVehicle = "nav" | "ncx";

export interface CoverDeclaration {
  readonly item: ManifestItem;
  /**
   * Which form of declaration **found** it, in ADR-0010's order: properties first,
   * then meta.
   *
   * Deliberately not named `declaredBy` — the generator side's `CoverSpec.declaredBy`
   * is a list (which forms this book declares its cover with), and this is a single
   * value (the first one to hit, in priority order). Sharing a name would make two
   * different questions look like they only differ in cardinality.
   */
  readonly foundBy: "cover-image-property" | "meta-name";
}

export interface EpubArchive {
  readonly entryPaths: readonly string[];
  readonly packageDocumentPath: string;
  /** `<package version>` copied verbatim. The criterion for the EPUB version, `"3.0"` or `"2.0"`. */
  readonly packageVersion: string;
  readonly manifest: readonly ManifestItem[];
  /** readingOrder — the package document's `<spine>` resolved into manifest items. */
  readonly readingOrder: readonly ManifestItem[];
  /** The manifest id `<spine toc>` points at. undefined when an EPUB 3 has no such attribute. */
  readonly readingOrderTocId: string | undefined;
  /** undefined when undeclared, which differs from being declared `"ltr"`. */
  readonly pageProgressionDirection: string | undefined;
  readonly navigationPath: string;
  /** Which vehicle the TOC was read from. ADR-0010 requires frond to report this. */
  readonly navigationVehicle: NavigationVehicle;
  /** The TOC flattened into document order. For the hierarchy, see `tocTree`. */
  readonly toc: readonly TocEntry[];
  /** The TOC with its hierarchy kept. Top-level entries are here, sub-entries under their own `children`. */
  readonly tocTree: readonly TocNode[];
  /** Neither form found means this book has no cover — which is not an error (ADR-0010). */
  readonly cover: CoverDeclaration | undefined;
  readonly stylesheet: string;
  readonly language: string;
  text(archivePath: string): string;
  bytes(archivePath: string): Uint8Array;
  has(archivePath: string): boolean;
}

export function openEpub(archive: Uint8Array): EpubArchive {
  const entries = unzipSync(archive);
  const decoder = new TextDecoder();

  const bytes = (archivePath: string): Uint8Array => {
    const found = entries[archivePath];
    if (found === undefined) {
      throw new Error(
        `The archive has no ${archivePath}. It has: ${Object.keys(entries).join(", ")}`,
      );
    }
    return found;
  };
  const text = (archivePath: string): string => decoder.decode(bytes(archivePath));

  const container = parseXml(text("META-INF/container.xml"), "META-INF/container.xml");
  const packageDocumentPath = String(
    pickPath(container, "container", "rootfiles", "rootfile")["@_full-path"],
  );

  const packageDocument = parseXml(text(packageDocumentPath), packageDocumentPath);
  const packageElement = pick(packageDocument, PACKAGE_ELEMENT);
  const metadata = pick(packageElement, "metadata");

  const manifest: ManifestItem[] = asArray(
    pick(packageElement, "manifest")["item"],
  ).map((item) => {
    const href = String(item["@_href"]);
    return {
      id: String(item["@_id"]),
      href,
      mediaType: String(item["@_media-type"]),
      properties:
        item["@_properties"] === undefined
          ? undefined
          : String(item["@_properties"]),
      archivePath: resolve(href, packageDocumentPath),
    };
  });

  const readingOrderElement = pick(packageElement, READING_ORDER_ELEMENT);
  const readingOrder = asArray(readingOrderElement["itemref"]).map((itemref) => {
    const idref = String(itemref["@_idref"]);
    const item = manifest.find((candidate) => candidate.id === idref);
    if (item === undefined) {
      throw new Error(`readingOrder points at an id the manifest does not have: ${idref}`);
    }
    return item;
  });

  const packageVersion = String(packageElement["@_version"]);
  const readingOrderTocId =
    readingOrderElement["@_toc"] === undefined
      ? undefined
      : String(readingOrderElement["@_toc"]);

  const navigation = findNavigation(
    manifest,
    packageVersion,
    readingOrderTocId,
  );
  const navigationDocument = parseXml(
    text(navigation.item.archivePath),
    navigation.item.archivePath,
  );
  // Each vehicle's TOC is read down from its own root element, rather than by
  // recursively hunting for tags across the whole document. Hunting would gather
  // `<a>` elements outside the `<nav>` too (the landmarks nav, for instance), and
  // those are not the TOC.
  const tocTree = resolveTocTree(
    navigation.vehicle === "ncx"
      ? collectNcxTree(pickPath(navigationDocument, "ncx", "navMap"))
      : collectNavTree(pickNav(navigationDocument)),
    navigation.item.archivePath,
  );

  const stylesheetItem = manifest.find((item) => item.mediaType === "text/css");
  if (stylesheetItem === undefined) {
    throw new Error("The manifest has no stylesheet");
  }

  return {
    entryPaths: Object.keys(entries),
    packageDocumentPath,
    packageVersion,
    manifest,
    readingOrder,
    readingOrderTocId,
    pageProgressionDirection:
      readingOrderElement["@_page-progression-direction"] === undefined
        ? undefined
        : String(readingOrderElement["@_page-progression-direction"]),
    navigationPath: navigation.item.archivePath,
    navigationVehicle: navigation.vehicle,
    toc: flattenToc(tocTree),
    tocTree,
    cover: findCover(manifest, metadata),
    stylesheet: text(stylesheetItem.archivePath),
    language: pickText(metadata, "dc:language"),
    text,
    bytes,
    has: (archivePath: string) => entries[archivePath] !== undefined,
  };
}

/**
 * Which file carries the TOC. The order follows ADR-0010:
 *
 * 1. When 3.x is declared, `properties="nav"` wins and the NCX is ignored entirely
 * 2. When 2.x is declared, the NCX is the only route
 * 3. When 3.x is declared but no nav is found, **fall back to the NCX** rather than
 *    throwing — a book whose packaging declaration and contents disagree is the norm,
 *    and what the reader wants is for the book to open
 */
function findNavigation(
  manifest: readonly ManifestItem[],
  packageVersion: string,
  readingOrderTocId: string | undefined,
): { readonly item: ManifestItem; readonly vehicle: NavigationVehicle } {
  const nav = manifest.find((item) => hasProperty(item, "nav"));
  if (nav !== undefined && packageVersion.startsWith("3")) {
    return { item: nav, vehicle: "nav" };
  }

  // The NCX is pointed at by `<spine toc>`. There is deliberately **no** "scan media
  // types when that is missing" fallback here: ADR-0010's four rules do not include
  // one, and inventing an extra rule at this layer would make the support layer more
  // forgiving of a badly packaged book than EpubBook is — so nothing would go red when
  // the generator forgets to write `<spine toc>`.
  const ncx = manifest.find((item) => item.id === readingOrderTocId);
  if (ncx !== undefined) {
    return { item: ncx, vehicle: "ncx" };
  }

  throw new Error(
    `No navigation document: version="${packageVersion}" has neither an item with properties="nav" nor a <spine toc> pointing at an NCX`,
  );
}

/**
 * The cover. **properties first, then `<meta name="cover">`, and neither means no
 * cover** — no dispatch on version (ADR-0010: one EPUB 3 in the sample uses only the
 * old form).
 */
function findCover(
  manifest: readonly ManifestItem[],
  metadata: XmlNode,
): CoverDeclaration | undefined {
  const byProperty = manifest.find((item) => hasProperty(item, "cover-image"));
  if (byProperty !== undefined) {
    return { item: byProperty, foundBy: "cover-image-property" };
  }

  const meta = asArray(metadata["meta"]).find(
    (candidate) => candidate["@_name"] === "cover",
  );
  if (meta === undefined) return undefined;

  const id = String(meta["@_content"]);
  const item = manifest.find((candidate) => candidate.id === id);
  if (item === undefined) {
    // This layer reads the fixtures **we generated ourselves**, so an id that points
    // nowhere can only be a generator bug, and making noise is right. `EpubBook`'s
    // (#8) obligation is the opposite: ADR-0010 says a book whose packaging
    // declaration and contents disagree is the norm, so there it must report "this
    // book has no cover" rather than throw.
    throw new Error(
      `<meta name="cover" content="${id}"> points at an id the manifest does not have (content takes an id, not an href)`,
    );
  }
  return { item, foundBy: "meta-name" };
}

/** A manifest item's `properties` is a whitespace-separated list, not a single value. */
function hasProperty(item: ManifestItem, property: string): boolean {
  return (item.properties ?? "").split(/\s+/).includes(property);
}

/**
 * Resolves a relative href inside the archive. Borrows WHATWG URL's rules — it handles
 * both `../` and percent-encoding, and each of those is an ailment in its own right.
 */
export function resolve(href: string, fromArchivePath: string): string {
  const base = new URL(fromArchivePath, RESOLUTION_ORIGIN);
  const resolved = new URL(href, base);
  return decodeURIComponent(resolved.pathname).slice(1);
}

/** XML well-formedness. XHTML is not HTML — one missing end tag and all three browsers reject the whole document. */
export function assertWellFormedXml(source: string, label: string): void {
  const result = XMLValidator.validate(source, { allowBooleanAttributes: false });
  if (result !== true) {
    throw new Error(`${label} is not well-formed XML: ${result.err.msg} (line ${result.err.line})`);
  }
}

type XmlNode = Record<string, unknown>;

function parseXml(source: string, label: string): XmlNode {
  assertWellFormedXml(source, label);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Element names keep their prefixes (dc:language, epub:type), because the fixture
    // assertions need to see them — a wrong namespace is EPUB's most common silent
    // failure.
    removeNSPrefix: false,
    isArray: (name) =>
      ["item", "itemref", "li", "rootfile", "navPoint"].includes(name),
  });
  return parser.parse(source) as XmlNode;
}

function pick(node: XmlNode, key: string): XmlNode {
  const value = node[key];
  if (value === undefined) {
    throw new Error(`No ${key} in the XML`);
  }
  return (Array.isArray(value) ? value[0] : value) as XmlNode;
}

/** Descends a path. Stacked picks read backwards. */
function pickPath(node: XmlNode, ...keys: readonly string[]): XmlNode {
  return keys.reduce((current, key) => pick(current, key), node);
}

/**
 * The `<nav>` in a navigation document: directly under `<body>`, or one `<section>` down.
 *
 * **Exactly those two shapes, not a search.** This reader exists to read the generator's
 * output literally (see the file header on why it deliberately implements less than
 * `src/epub/` does), and those two are the only shapes `EpubSpec.navInsideSection` can
 * produce. A recursive hunt would also quietly succeed on a navigation document that put
 * its `<nav>` somewhere nobody meant it to be, and then nothing here would go red.
 *
 * frond itself is deliberately more permissive — EPUB 3 puts no limit on the depth, which
 * is what `nav-inside-section` came from. That difference is the point of having two
 * implementations.
 */
function pickNav(navigationDocument: XmlNode): XmlNode {
  const body = pickPath(navigationDocument, "html", "body");
  return body["nav"] === undefined ? pickPath(body, "section", "nav") : pick(body, "nav");
}

function pickText(node: XmlNode, key: string): string {
  const value = node[key];
  if (value === undefined) {
    throw new Error(`No ${key} in the XML`);
  }
  return String(
    typeof value === "object" && value !== null && "#text" in value
      ? (value as XmlNode)["#text"]
      : value,
  );
}

function asArray(value: unknown): XmlNode[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]) as XmlNode[];
}

interface RawTocNode {
  readonly label: string;
  readonly href: string;
  readonly children: readonly RawTocNode[];
}

/**
 * `nav.xhtml`'s TOC — label and location both live on the `<a>`, and nesting is
 * another `<ol>` opened **inside** the `<li>`.
 *
 * "Inside" is the point: a sub-list placed as a sibling of the `<li>` is equally
 * well-formed XHTML and browsers draw it just the same, but that tree is flat. This
 * collects sub-entries along the `<li>` boundary, so a navigation document that puts
 * them in the wrong place shows up as a difference in depth rather than silently
 * flattening into a single run.
 */
function collectNavTree(node: XmlNode): RawTocNode[] {
  const list = node["ol"];
  if (list === undefined) return [];

  return asArray(list).flatMap((ol) =>
    asArray(ol["li"]).map((li) => {
      const anchor = pick(li, "a");
      return {
        label: String(anchor["#text"] ?? ""),
        href: String(anchor["@_href"]),
        children: collectNavTree(li),
      };
    }),
  );
}

/**
 * The NCX's TOC — the label is in `<navLabel><text>` and the location in
 * `<content src>`, two **different** children of the navPoint. That is the biggest
 * shape difference from `nav.xhtml`: there a single `<a>` carries both, here they have
 * to be put together, and putting them together wrongly (taking the navPoint's id as
 * the label, say) is invisible in a flat TOC.
 *
 * Nesting is a navPoint directly inside a navPoint, with no `<ol>`-style container
 * element in between.
 */
function collectNcxTree(node: XmlNode): RawTocNode[] {
  return asArray(node["navPoint"]).map((navPoint) => ({
    label: String(pick(navPoint, "navLabel")["text"] ?? ""),
    href: String(pick(navPoint, "content")["@_src"]),
    children: collectNcxTree(navPoint),
  }));
}

/** Resolves each entry's href into a path inside the archive, hierarchy untouched. */
function resolveTocTree(
  nodes: readonly RawTocNode[],
  fromArchivePath: string,
): TocNode[] {
  return nodes.map((node) => ({
    label: node.label,
    href: node.href,
    archivePath: resolve(node.href, fromArchivePath),
    children: resolveTocTree(node.children, fromArchivePath),
  }));
}

/** Flattens the tree into document order: self first, then children. */
function flattenToc(nodes: readonly TocNode[]): TocEntry[] {
  return nodes.flatMap((node) => [node, ...flattenToc(node.children)]);
}
