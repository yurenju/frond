import { openContainer } from "./container.ts";
import { readCover, type CoverImage } from "./cover.ts";
import { EpubOpenError } from "./errors.ts";
import {
  parsePackageDocument,
  type BookMetadata,
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
      packageDocument.metadata,
      readReadingOrder(packageDocument.readingOrder, resources),
      readCover(resources, packageDocument.coverMetaId, container),
    );
  }
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
    if (resource.location.kind === "remote") {
      // 內容文件必須在封裝內——遠端資源在 manifest 可以合規，在 readingOrder
      // 不行。
      throw new EpubOpenError(
        "resource-outside-container",
        `readingOrder 的 ${item.idref} 不在封裝內`,
      );
    }
    if (resource.location.kind === "missing") {
      // **缺檔只在這裡致命**（`resources.ts`）。readingOrder 上的一格缺了，讀者
      // 就是少了一段內容，而那個洞在翻到它之前不會有人發現——正是本票要擋的
      // 「靜默失敗或半開的狀態」。
      throw new EpubOpenError(
        "missing-resource",
        `readingOrder 的 ${item.idref} 指向壓縮檔內不存在的 ${resource.location.path}`,
      );
    }

    return {
      id: resource.id,
      path: resource.location.path,
      mediaType: resource.mediaType,
      linear: item.linear,
    };
  });
}

async function toBytes(source: EpubSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}
