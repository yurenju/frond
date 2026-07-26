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

export interface EpubArchive {
  readonly entryPaths: readonly string[];
  readonly packageDocumentPath: string;
  readonly manifest: readonly ManifestItem[];
  /** readingOrder——封裝文件的 `<spine>` 解析成 manifest item。 */
  readonly readingOrder: readonly ManifestItem[];
  /** 沒宣告時是 undefined，與宣告成 `"ltr"` 有別。 */
  readonly pageProgressionDirection: string | undefined;
  readonly navigationPath: string;
  readonly toc: readonly TocEntry[];
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

  const navigationItem = manifest.find((item) =>
    (item.properties ?? "").split(/\s+/).includes("nav"),
  );
  if (navigationItem === undefined) {
    throw new Error("manifest 內沒有標記 properties=\"nav\" 的導覽文件");
  }

  const navigationDocument = parseXml(
    text(navigationItem.archivePath),
    navigationItem.archivePath,
  );
  const toc = collectTocEntries(navigationDocument).map((entry) => ({
    ...entry,
    archivePath: resolve(entry.href, navigationItem.archivePath),
  }));

  const stylesheetItem = manifest.find((item) => item.mediaType === "text/css");
  if (stylesheetItem === undefined) {
    throw new Error("manifest 內沒有樣式表");
  }

  return {
    entryPaths: Object.keys(entries),
    packageDocumentPath,
    manifest,
    readingOrder,
    pageProgressionDirection:
      readingOrderElement["@_page-progression-direction"] === undefined
        ? undefined
        : String(readingOrderElement["@_page-progression-direction"]),
    navigationPath: navigationItem.archivePath,
    toc,
    stylesheet: text(stylesheetItem.archivePath),
    language: pickText(metadata, "dc:language"),
    text,
    bytes,
    has: (archivePath: string) => entries[archivePath] !== undefined,
  };
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
    isArray: (name) => ["item", "itemref", "li", "rootfile"].includes(name),
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

function collectTocEntries(node: unknown): { label: string; href: string }[] {
  if (node === null || typeof node !== "object") return [];
  const found: { label: string; href: string }[] = [];
  for (const [key, value] of Object.entries(node as XmlNode)) {
    if (key === "a") {
      for (const anchor of asArray(value)) {
        found.push({
          label: String(anchor["#text"] ?? ""),
          href: String(anchor["@_href"]),
        });
      }
      continue;
    }
    for (const child of asArray(value)) {
      found.push(...collectTocEntries(child));
    }
  }
  return found;
}
