import { unzipSync } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";

/**
 * 從產出的位元組把一本 EPUB 讀回來，供 fixture 產生器的測試斷言結構。
 *
 * 這裡刻意全部走**外部**的實作：解壓用 fflate、XML 用 fast-xml-parser、相對
 * href 的解析用 WHATWG `URL`。用產生器自己的反向操作來讀自己的產出，任何對
 * 格式的誤解都會在兩邊同時成立，測試照樣全綠——那種測試只證明程式碼跟自己
 * 一致。
 *
 * 這一層不是 `EpubBook` 的雛形，也不該長成那樣（#8）。它只需要夠用來問「這份
 * 產出物是不是一本合規的書」。
 */

/** 封裝文件的根元素名稱。 */
const PACKAGE_ELEMENT = "package";

/**
 * readingOrder 在 EPUB 封裝格式裡的元素名稱。CONTEXT.md 把 `spine` 列為
 * _Avoid_——這個常數是規格的線上格式用詞，不是識別字，所以它出現在這裡一次，
 * 其餘地方一律叫 readingOrder。
 */
const READING_ORDER_ELEMENT = "spine";

/** 解析相對 href 用的假 origin。只用來借 WHATWG URL 的解析規則。 */
const RESOLUTION_ORIGIN = "https://frond.invalid/";

export interface ManifestItem {
  readonly id: string;
  /** 相對於封裝文件的 href，原樣照抄。 */
  readonly href: string;
  readonly mediaType: string;
  readonly properties: string | undefined;
  /** href 解析之後在壓縮檔內的路徑。 */
  readonly archivePath: string;
}

export interface TocEntry {
  readonly label: string;
  /** 相對於導覽文件的 href，原樣照抄——病症就寫在這裡。 */
  readonly href: string;
  /** href 解析之後在壓縮檔內的路徑（含 percent-encoding 的還原）。 */
  readonly archivePath: string;
}

/**
 * TOC 的一個節點，**保留層次**。
 *
 * 與攤平的 `toc` 是兩個不同的問題，所以兩個都在：href 的病症（`%2c`、`../`）
 * 問的是每一項寫成什麼樣，攤平比較好問；巢狀問的是樹長什麼形狀，而那在攤平
 * 之後就消失了——只有攤平版本的話，一份把子項目放成兄弟的導覽文件會全綠。
 */
export interface TocNode extends TocEntry {
  readonly children: readonly TocNode[];
}

/** 承載 TOC 的那份檔案是哪一種。EPUB 3 是 `nav.xhtml`，EPUB 2 是 `toc.ncx`。 */
export type NavigationVehicle = "nav" | "ncx";

export interface CoverDeclaration {
  readonly item: ManifestItem;
  /**
   * 是哪一種寫法**找到**它的，依 ADR-0010 的順序：先 properties，再 meta。
   *
   * 刻意不叫 `declaredBy`——產生器那一側的 `CoverSpec.declaredBy` 是一份清單
   * （這本書用了哪幾種寫法宣告封面），這裡是單一值（依優先順序先命中的那一
   * 種）。同名會讓兩個不同的問題看起來只是基數不同。
   */
  readonly foundBy: "cover-image-property" | "meta-name";
}

export interface EpubArchive {
  readonly entryPaths: readonly string[];
  readonly packageDocumentPath: string;
  /** `<package version>` 原樣照抄。EPUB 版本的判準，`"3.0"` 或 `"2.0"`。 */
  readonly packageVersion: string;
  readonly manifest: readonly ManifestItem[];
  /** readingOrder——封裝文件的 `<spine>` 解析成 manifest item。 */
  readonly readingOrder: readonly ManifestItem[];
  /** `<spine toc>` 指向的 manifest id。EPUB 3 沒有這個屬性時是 undefined。 */
  readonly readingOrderTocId: string | undefined;
  /** 沒宣告時是 undefined，與宣告成 `"ltr"` 有別。 */
  readonly pageProgressionDirection: string | undefined;
  readonly navigationPath: string;
  /** TOC 是從哪一種載體讀出來的。ADR-0010 要 frond 回報這件事。 */
  readonly navigationVehicle: NavigationVehicle;
  /** TOC 攤平成文件順序的一串。巢狀的層次見 `tocTree`。 */
  readonly toc: readonly TocEntry[];
  /** TOC 保留層次的樣子。頂層項目在這裡，子項目在各自的 `children` 底下。 */
  readonly tocTree: readonly TocNode[];
  /** 兩種寫法都找不到就是這本書沒有封面——那不是錯誤（ADR-0010）。 */
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
        `壓縮檔內沒有 ${archivePath}。有的是：${Object.keys(entries).join(", ")}`,
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
      throw new Error(`readingOrder 指向 manifest 沒有的 id：${idref}`);
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
  // 兩種載體的 TOC 各自從自己的根元素往下讀，而不是在整份文件上遞迴找標籤。
  // 遞迴找的話，`<nav>` 之外的 `<a>`（例如 landmarks 那份 nav）也會被收進來，
  // 而那不是 TOC。
  const tocTree = resolveTocTree(
    navigation.vehicle === "ncx"
      ? collectNcxTree(pickPath(navigationDocument, "ncx", "navMap"))
      : collectNavTree(pickPath(navigationDocument, "html", "body", "nav")),
    navigation.item.archivePath,
  );

  const stylesheetItem = manifest.find((item) => item.mediaType === "text/css");
  if (stylesheetItem === undefined) {
    throw new Error("manifest 內沒有樣式表");
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
 * 承載 TOC 的是哪一份檔案。順序照 ADR-0010：
 *
 * 1. 宣告 3.x 時 `properties="nav"` 贏，NCX 完全忽略
 * 2. 宣告 2.x 時只有 NCX 這條路
 * 3. 宣告 3.x 卻找不到 nav 時**退回 NCX**，不丟錯——書的封裝宣告與內容不一致
 *    是常態，而讀者要的是書打得開
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

  // NCX 的指法是 `<spine toc>`。這裡刻意**不**加「找不到就掃 media type」的
  // 後援：ADR-0010 的四條規則裡沒有那一條，而在這一層多發明一條規則，等於讓
  // 支援層對一本封裝宣告有問題的書比 EpubBook 還寬容——於是產生器漏寫
  // `<spine toc>` 時沒有任何東西會紅。
  const ncx = manifest.find((item) => item.id === readingOrderTocId);
  if (ncx !== undefined) {
    return { item: ncx, vehicle: "ncx" };
  }

  throw new Error(
    `找不到導覽文件：version="${packageVersion}" 既沒有 properties="nav" 的項目，<spine toc> 也沒有指到 NCX`,
  );
}

/**
 * 封面。**先 properties，再 `<meta name="cover">`，兩者都沒有就是沒有封面**
 * ——不按版本分派（ADR-0010：樣本裡有一本 EPUB 3 只用舊寫法）。
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
    // 這一層讀的是**我們自己產生的** fixture，所以指不到的 id 只可能是產生器的
    // bug，吵出來是對的。`EpubBook`（#8）的義務相反：ADR-0010 說書的封裝宣告
    // 與內容不一致是常態，那邊要回報「這本書沒有封面」而不是丟錯。
    throw new Error(
      `<meta name="cover" content="${id}"> 指向 manifest 沒有的 id（content 要放 id，不是 href）`,
    );
  }
  return { item, foundBy: "meta-name" };
}

/** manifest item 的 `properties` 是空白分隔的清單，不是單一值。 */
function hasProperty(item: ManifestItem, property: string): boolean {
  return (item.properties ?? "").split(/\s+/).includes(property);
}

/**
 * 解析壓縮檔內的相對 href。借 WHATWG URL 的規則——它同時處理 `../` 與
 * percent-encoding，而那兩者各自是一個病症。
 */
export function resolve(href: string, fromArchivePath: string): string {
  const base = new URL(fromArchivePath, RESOLUTION_ORIGIN);
  const resolved = new URL(href, base);
  return decodeURIComponent(resolved.pathname).slice(1);
}

/** XML 的良構性。XHTML 不是 HTML——少一個結束標籤，三家瀏覽器都會拒絕整份文件。 */
export function assertWellFormedXml(source: string, label: string): void {
  const result = XMLValidator.validate(source, { allowBooleanAttributes: false });
  if (result !== true) {
    throw new Error(`${label} 不是良構的 XML：${result.err.msg}（第 ${result.err.line} 行）`);
  }
}

type XmlNode = Record<string, unknown>;

function parseXml(source: string, label: string): XmlNode {
  assertWellFormedXml(source, label);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // 元素名稱保留前綴（dc:language、epub:type），因為 fixture 的斷言要看得到
    // 它們——命名空間寫錯是 EPUB 最常見的靜默失敗。
    removeNSPrefix: false,
    isArray: (name) =>
      ["item", "itemref", "li", "rootfile", "navPoint"].includes(name),
  });
  return parser.parse(source) as XmlNode;
}

function pick(node: XmlNode, key: string): XmlNode {
  const value = node[key];
  if (value === undefined) {
    throw new Error(`XML 內找不到 ${key}`);
  }
  return (Array.isArray(value) ? value[0] : value) as XmlNode;
}

/** 一路往下取。多層的 pick 疊在一起讀起來是反的。 */
function pickPath(node: XmlNode, ...keys: readonly string[]): XmlNode {
  return keys.reduce((current, key) => pick(current, key), node);
}

function pickText(node: XmlNode, key: string): string {
  const value = node[key];
  if (value === undefined) {
    throw new Error(`XML 內找不到 ${key}`);
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
 * `nav.xhtml` 的 TOC——標籤與位置都在 `<a>` 上，巢狀是 `<li>` **裡面**再開一個
 * `<ol>`。
 *
 * 「裡面」是重點：子清單放成 `<li>` 的兄弟時 XHTML 一樣良構、瀏覽器一樣畫得
 * 出來，但那棵樹是平的。這裡照 `<li>` 的邊界收子項目，所以放錯位置的導覽文件
 * 會在深度上看得出來，而不是靜默地變成一串。
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
 * NCX 的 TOC——標籤在 `<navLabel><text>`，位置在 `<content src>`，兩者是
 * navPoint 的兩個**不同**子元素。這是與 `nav.xhtml` 最大的形狀差異：那邊一個
 * `<a>` 同時帶著兩者，這邊要把它們湊起來，而湊錯（例如拿 navPoint 的 id 當
 * 標籤）在平的 TOC 上看不出來。
 *
 * 巢狀則是 navPoint 直接套 navPoint，中間沒有 `<ol>` 那種容器元素。
 */
function collectNcxTree(node: XmlNode): RawTocNode[] {
  return asArray(node["navPoint"]).map((navPoint) => ({
    label: String(pick(navPoint, "navLabel")["text"] ?? ""),
    href: String(pick(navPoint, "content")["@_src"]),
    children: collectNcxTree(navPoint),
  }));
}

/** 把每一項的 href 解析成壓縮檔內的路徑，層次原樣保留。 */
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

/** 把樹攤平成文件順序：先自己，再子項目。 */
function flattenToc(nodes: readonly TocNode[]): TocEntry[] {
  return nodes.flatMap((node) => [node, ...flattenToc(node.children)]);
}
