import { openContainer, type EpubContainer } from "./container.ts";
import { readCover, type CoverImage } from "./cover.ts";
import { EpubOpenError, EpubResourceError } from "./errors.ts";
import { readFontObfuscation, type FontObfuscation } from "./font-obfuscation.ts";
import {
  parsePackageDocument,
  type BookMetadata,
  type ReadingOrderItem,
} from "./package-document.ts";
import { resolveResources, type Resource } from "./resources.ts";
import { readToc, type NavigationDocument, type Toc, type TocItem } from "./toc.ts";

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
  /**
   * TOC——有層次的標題與位置對照。頂層項目在這裡，子項目在各自的 `children`
   * 底下，深度不限。
   *
   * 一份導覽文件都沒有的書在這裡是空清單，那不是錯誤（ADR-0010）。
   */
  readonly toc: readonly TocItem[];
  /**
   * TOC 讀自哪一份導覽文件（user story 15）。
   *
   * 兩份都在是常態而 frond 只用其中一份，所以這是消費端唯一能據以查證「NCX 說
   * 了別的」的線索——要不要提示讀者由消費端決定（ADR-0002）。
   */
  readonly navigationDocument: NavigationDocument | undefined;
  /**
   * manifest 宣告的每一項資源，依宣告順序——圖片、樣式表、字型、內容文件全部
   * 在內。
   *
   * 每一項的 `location` 分得出**三種**情況：拿得到（`in-container`）、在遠端
   * （`remote`，EPUB 3 允許，frond 不下載）、不在包裡（`missing`，書宣告了但
   * 壓縮檔裡沒有）。後兩者刻意不壓成同一格：那會讓消費端分不出「這一項本來就
   * 不在包裡」與「這本書寫錯了」，而兩者該做的事不同（`resources.ts`）。
   */
  readonly resources: readonly Resource[];

  private readonly container: EpubContainer;
  private readonly obfuscation: FontObfuscation;
  private readonly byId: ReadonlyMap<string, Resource>;

  private constructor(
    metadata: BookMetadata,
    readingOrder: readonly Section[],
    cover: CoverImage | undefined,
    toc: Toc,
    resources: ReadonlyMap<string, Resource>,
    container: EpubContainer,
    obfuscation: FontObfuscation,
  ) {
    this.metadata = metadata;
    this.readingOrder = readingOrder;
    this.cover = cover;
    this.toc = toc.items;
    this.navigationDocument = toc.readFrom;
    this.resources = [...resources.values()];
    this.byId = resources;
    this.container = container;
    this.obfuscation = obfuscation;
  }

  /**
   * 壓縮檔內某個路徑的位元組。
   *
   * 這是 `Renderer` 排版時要的那一條：Section 的 XHTML（`section.path`）、內容
   * 文件裡 `<img src>` 與 `url()` 解析出來的圖片、樣式表與字型，全部走這裡。
   *
   * **以路徑為鍵而不是以 manifest 的 id**，因為 id 是消費端手上最沒有的東西：
   * 一份內容文件引用另一份資源時給的是相對 href，解析出來就是路徑。要 id 那一
   * 側的事實（media type、遠端與否）看 `resources` 或 `resource()`。
   *
   * IDPF 混淆過的字型在這裡還原（`font-obfuscation.ts`）。解不開的混淆丟
   * `EpubResourceError` 而**不吐出壞位元組**——壞字型在畫面上的症狀是滿頁豆腐
   * 字，那時候沒有人查得到根因在解碼。
   *
   * @throws EpubResourceError 壓縮檔裡沒有這個路徑，或那一項的混淆解不開
   */
  bytes(path: string): Uint8Array {
    return readBytes(this.container, this.obfuscation, path);
  }

  /** 依 manifest 的 id 找一項資源。manifest 沒有宣告過這個 id 時是 `undefined`。 */
  resource(id: string): Resource | undefined {
    return this.byId.get(id);
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
    const toc = readToc(packageDocument, resources, container);
    const obfuscation = readFontObfuscation(
      container,
      packageDocument.metadata.identifier,
    );

    return new EpubBook(
      packageDocument.metadata,
      readReadingOrder(packageDocument.readingOrder, resources),
      // 封面走的是與 `bytes()` 同一個函式，不是另一條「差不多」的路——同一個
      // 路徑在同一本書上只能有一種答案。
      readCover(resources, packageDocument.coverMetaId, (path) =>
        readBytes(container, obfuscation, path),
      ),
      toc,
      resources,
      container,
      obfuscation,
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

/**
 * 取一份資源的位元組——`bytes()` 與封面共用的那一個。
 *
 * 提成模組層的函式而不是留在方法裡，是因為封面在**實例存在之前**就要讀
 * （`open()` 裡）。各寫一次的話兩條路會在錯誤型別上分岔：直接叫
 * `container.bytes()` 缺檔時丟的是 `EpubOpenError`，而那是開書階段的錯誤型別。
 */
function readBytes(
  container: EpubContainer,
  obfuscation: FontObfuscation,
  path: string,
): Uint8Array {
  if (!container.has(path)) {
    throw new EpubResourceError("missing-resource", `壓縮檔內沒有 ${path}`);
  }
  return obfuscation.restore(path, container.bytes(path));
}

async function toBytes(source: EpubSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}
