import { EpubOpenError } from "./errors.ts";
import { parseXml, type XmlElement } from "./xml.ts";

/**
 * 封裝文件（OPF）——一本書對自己的宣告：它是什麼版本、叫什麼名字、由哪些檔案
 * 組成、要照什麼順序讀。
 *
 * 這一層**只讀，不解析路徑也不查表**：`href` 原樣照抄，要怎麼對應到壓縮檔內的
 * 項目是 `epub-book.ts` 的事（那需要知道封裝文件自己在哪裡）。這一刀讓「書怎麼
 * 宣告」與「檔案在哪裡」各自可讀可測。
 */

/** 支援的封裝版本。範圍與界線見 ADR-0010。 */
export type EpubVersion = "epub2" | "epub3";

export interface ManifestItem {
  readonly id: string;
  /** 相對於封裝文件的 href，原樣照抄——含 `../` 與 percent-encoding。 */
  readonly href: string;
  readonly mediaType: string;
  /** `properties` 是空白分隔的清單，不是單一值。 */
  readonly properties: readonly string[];
}

export interface ReadingOrderItem {
  readonly idref: string;
  /** `linear="no"` 的項目不在線性的閱讀進程裡（封面頁、版權頁）。 */
  readonly linear: boolean;
}

/**
 * 頁面推進方向——翻頁往哪個方向前進（`<spine page-progression-direction>`）。
 *
 * **與書寫方向是兩件事**（CONTEXT.md）：直排／橫排寫在樣式表裡，由 `Renderer`
 * 回報。這裡回報的是書在封裝文件裡宣告的翻頁方向。
 */
export type PageProgressionDirection = "ltr" | "rtl";

/**
 * 一本書對自己的宣告。
 *
 * 每一個欄位都可能是 `undefined`——**書沒說就回報沒說**，不補預設值（ADR-0002：
 * frond 給事實，消費端給政策）。書櫃要顯示「未知作者」還是留白是政策，而
 * `EpubBook` 一旦把「沒說」填成空字串或 `"ltr"`，消費端就再也分不出來了。
 */
export interface BookMetadata {
  /** `dc:title`。 */
  readonly title: string | undefined;
  /** `dc:creator`，依文件順序。沒宣告時是空清單。 */
  readonly authors: readonly string[];
  /** `dc:language`，BCP 47 語言標籤，原樣照抄。 */
  readonly language: string | undefined;
  /**
   * `<package unique-identifier>` 指到的那個 `dc:identifier`，原樣照抄。
   *
   * 書櫃要靠它認出「這兩個檔案是同一本書」，所以它跟著 metadata 一起回報。
   */
  readonly identifier: string | undefined;
  /** 封裝文件宣告的版本。 */
  readonly epubVersion: EpubVersion;
  /**
   * 頁面推進方向。**書沒說時是 `undefined`，不是 `"ltr"`**（ADR-0010）——EPUB 2
   * 一律落在這一格，因為那個版本根本沒有這個屬性。
   *
   * 這裡回報的**不是書寫方向**：直排／橫排寫在樣式表裡，由 `Renderer` 回報。
   */
  readonly pageProgressionDirection: PageProgressionDirection | undefined;
}

export interface PackageDocument {
  readonly metadata: BookMetadata;
  /**
   * `<meta name="cover" content="…">` 指向的 manifest **id**（不是 href）。
   *
   * 這是 EPUB 2 宣告封面的唯一寫法，而 EPUB 3 的書也常寫（樣本裡 30 本兩種都
   * 寫，另有一本 EPUB 3 只寫這一種），所以它不隨版本消失。
   */
  readonly coverMetaId: string | undefined;
  readonly manifest: readonly ManifestItem[];
  readonly readingOrder: readonly ReadingOrderItem[];
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
      `${label} 沒有 <package> 根元素`,
    );
  }

  const metadata = packageElement.child("metadata");
  const readingOrderElement = pickReadingOrder(packageElement, label);

  return {
    metadata: {
      title: firstText(metadata?.children("title") ?? []),
      // 作者依文件順序全部取出，不按 `opf:role` 篩選：`role` 是選擇性的，樣本裡
      // 沒有一本靠它才分得出作者，而按它篩會讓沒寫 role 的書變成沒有作者。
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
  };
}

/**
 * 書的識別碼。
 *
 * `<package unique-identifier>` 指向的那個 `<dc:identifier>` 才是這本書的識別碼
 * ——一本書可以有多個 identifier（ISBN、UUID、通路自己的編號），挑錯一個會讓
 * 同一本書在書櫃裡被當成兩本。指不到時退回第一個，因為讀者要的是書打得開。
 *
 * 值原樣取出，不解讀 `opf:scheme` 宣稱的是哪一種識別碼（ADR-0010）。
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
 * 只認 `ltr` 與 `rtl`。EPUB 3 允許的第三個值 `default` 的語意就是「不指定方向」
 * ——與屬性缺席同一格，所以照樣回報「書沒說」而不是自己挑一個方向。
 */
function readPageProgressionDirection(
  readingOrderElement: XmlElement,
): PageProgressionDirection | undefined {
  const declared = readingOrderElement.attribute("page-progression-direction");
  return declared === "ltr" || declared === "rtl" ? declared : undefined;
}

/**
 * `<package version>`。
 *
 * ADR-0010 劃的界線在這裡執行：2.x 與 3.x 支援，**其餘明確拒絕**。OEBPS 1.2 與
 * OEB 1.0 的封裝文件在結構上就是另一種格式，勉強讀下去只會在更深的地方以更難
 * 懂的方式失敗。
 */
function readVersion(packageElement: XmlElement, label: string): EpubVersion {
  const version = packageElement.attribute("version")?.trim();
  // 比主版本而不是比前綴：`version="3"` 少了小數點仍是 EPUB 3，而比 `"3."`
  // 會把它誤拒。
  const major = version?.split(".")[0];
  if (major === "3") return "epub3";
  if (major === "2") return "epub2";

  throw new EpubOpenError(
    "unsupported-package-version",
    version === undefined
      ? `${label} 的 <package> 沒有宣告 version`
      : `不支援的封裝版本 ${version}（frond 支援 EPUB 2.x 與 3.x，見 ADR-0010）`,
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
      `${label} 沒有 <manifest>`,
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
 * readingOrder 在封裝格式裡的元素名稱是 `spine`。CONTEXT.md 把 spine 列為
 * _Avoid_，所以那個字只出現在讀取它的這一個函式裡，其餘一律叫 readingOrder。
 */
function pickReadingOrder(
  packageElement: XmlElement,
  label: string,
): XmlElement {
  const element = packageElement.child("spine");
  if (element === undefined) {
    throw new EpubOpenError(
      "malformed-package-document",
      `${label} 沒有 <spine>，這本書沒有宣告 readingOrder`,
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
