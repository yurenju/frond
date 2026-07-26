import { openContainer, type EpubContainer } from "./container.ts";
import { EpubOpenError } from "./errors.ts";
import {
  parsePackageDocument,
  type EpubVersion,
  type PackageDocument,
  type PageProgressionDirection,
  type ReadingOrderItem,
} from "./package-document.ts";
import { resolveResources, type Resource } from "./resources.ts";

/**
 * 一本開好的 EPUB。
 *
 * 消費端給位元組，拿到書名、語言、readingOrder 與封面——解壓、容器格式、封裝
 * 文件的位置與 href 的解析都在這裡面，書櫃不必知道 EPUB 長什麼樣（#8）。
 *
 * **零 DOM 依賴**（ADR-0005）：這個 class 與它底下的每一個模組都不碰
 * `document`、`DOMParser` 或任何瀏覽器物件，所以它在 Node 裡跑得起來，測試也就
 * 落在測試金字塔底層（ADR-0009，Vitest）。
 *
 * ## 為什麼是 `open()` 而不是 `new EpubBook(bytes)`
 *
 * `File` 與 `Blob` 要非同步才拿得到位元組，而建構子不能是非同步的。工廠方法讓
 * 「拿到實例」與「這本書開得起來」是同一件事——不存在一個半開的 `EpubBook`：
 * 開不起來時 `open()` 丟 `EpubOpenError`，實例根本不會出現。
 */
export class EpubBook {
  readonly metadata: BookMetadata;
  /** 閱讀順序。順序即封裝文件宣告的順序。 */
  readonly readingOrder: readonly Section[];
  /** 封面圖。兩種宣告寫法都找不到時是 `undefined`——那不是錯誤（ADR-0010）。 */
  readonly cover: CoverImage | undefined;

  private constructor(
    metadata: BookMetadata,
    readingOrder: readonly Section[],
    cover: CoverImage | undefined,
  ) {
    this.metadata = metadata;
    this.readingOrder = readingOrder;
    this.cover = cover;
  }

  /**
   * 開一本書。失敗時丟 `EpubOpenError`，`reason` 說明是哪一種壞法。
   */
  static async open(source: EpubSource): Promise<EpubBook> {
    const container = openContainer(await toBytes(source));
    const packageDocument = parsePackageDocument(
      container.text(container.packageDocumentPath),
      container.packageDocumentPath,
    );
    const resources = resolveResources(packageDocument.manifest, container);

    return new EpubBook(
      readMetadata(packageDocument),
      readReadingOrder(packageDocument.readingOrder, resources),
      readCover(packageDocument, resources, container),
    );
  }
}

/** 封面圖——書櫃要的是圖本身，所以位元組跟著一起給。 */
export interface CoverImage {
  /** 壓縮檔內的路徑，供診斷用。 */
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  /** 是哪一種寫法找到它的，依 ADR-0010 的順序：先 properties，再 meta。 */
  readonly foundBy: CoverNotation;
}

export type CoverNotation = "cover-image-property" | "meta-name";

/**
 * 封面。**先 `properties="cover-image"`，再 `<meta name="cover">`，兩者都沒有就是
 * 這本書沒有封面**——不按版本分派（ADR-0010）。
 *
 * 指到的 id 不存在、或那個資源不在封裝內時同樣回報「沒有封面」而不是丟錯：書的
 * 封裝宣告與內容不一致是常態，而一本指壞了封面的書仍然讀得完。
 */
function readCover(
  packageDocument: PackageDocument,
  resources: ReadonlyMap<string, Resource>,
  container: EpubContainer,
): CoverImage | undefined {
  const byProperty = [...resources.values()].find((resource) =>
    resource.properties.includes("cover-image"),
  );
  const found: readonly [Resource | undefined, CoverNotation] =
    byProperty === undefined
      ? [
          packageDocument.coverMetaId === undefined
            ? undefined
            : resources.get(packageDocument.coverMetaId),
          "meta-name",
        ]
      : [byProperty, "cover-image-property"];

  const [resource, foundBy] = found;
  if (resource?.path === undefined) return undefined;

  return {
    path: resource.path,
    mediaType: resource.mediaType,
    bytes: container.bytes(resource.path),
    foundBy,
  };
}

/**
 * readingOrder 中的單一項目，對應一份 XHTML 內容文件（CONTEXT.md）。
 *
 * 刻意不叫 chapter：章節是 TOC 的概念，與 Section 不是一對一。
 */
export interface Section {
  /** manifest 的 id。 */
  readonly id: string;
  /** 壓縮檔內的路徑，href 已依 URL 規則解析。 */
  readonly path: string;
  readonly mediaType: string;
  /**
   * 在不在線性的閱讀進程上（`<itemref linear="no">` 是 `false`）。
   *
   * 非線性的項目**留在這個清單裡**——封面頁與版權頁確實是書的一部分，濾掉它們
   * 是政策不是事實（ADR-0002）。
   */
  readonly linear: boolean;
}

function readReadingOrder(
  items: readonly ReadingOrderItem[],
  resources: ReadonlyMap<string, Resource>,
): readonly Section[] {
  return items.map((item) => {
    const resource = resources.get(item.idref);
    if (resource === undefined) {
      throw new EpubOpenError(
        "unknown-reading-order-item",
        `readingOrder 指向 manifest 沒有的 id：${item.idref}`,
      );
    }
    if (resource.path === undefined) {
      // 內容文件必須在封裝內——遠端資源在 manifest 可以合規，在 readingOrder
      // 不行。
      throw new EpubOpenError(
        "resource-outside-container",
        `readingOrder 的 ${item.idref} 不在封裝內`,
      );
    }

    return {
      id: resource.id,
      path: resource.path,
      mediaType: resource.mediaType,
      linear: item.linear,
    };
  });
}

/**
 * 一本書的位元組可以長什麼樣。
 *
 * `File` 是 `Blob` 的子型別，所以三種輸入（`File` / `Blob` / `ArrayBuffer`）都在
 * 這個聯集裡。`Uint8Array` 一併收下：Node 端讀檔拿到的就是它，要求呼叫端先包一層
 * `Blob` 只是為難人。
 */
export type EpubSource = Blob | ArrayBuffer | Uint8Array;

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
  /** `<package unique-identifier>` 指到的那個 `dc:identifier`，原樣照抄。 */
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

function readMetadata(packageDocument: PackageDocument): BookMetadata {
  return {
    title: packageDocument.title,
    authors: packageDocument.authors,
    language: packageDocument.language,
    identifier: packageDocument.identifier,
    epubVersion: packageDocument.epubVersion,
    pageProgressionDirection: packageDocument.pageProgressionDirection,
  };
}

async function toBytes(source: EpubSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}
