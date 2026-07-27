/**
 * `Renderer` 對「一本書」的要求，以及一份 in-memory 的實作。
 *
 * ## 為什麼 `Renderer` 不直接吃 `EpubBook`
 *
 * ADR-0002 明列 frond **必須自己提供 fake / in-memory 實作，並視為公開 API 的
 * 一部分**——上層測試自己的整合層時不該被迫造假物。這個介面就是那句話的落點：
 * `EpubBook` 結構上滿足它（那件事由 `tests/node/renderer/book.test.ts` 在型別層
 * 釘住），而 `MemoryBook` 是另一個滿足它的實作。
 *
 * 收窄介面還買到第二件事，而那件事在這個 repo 裡是具體的：`Renderer` 的相依因此
 * **不含解壓與 XML 解析**。瀏覽器測試要把 frond 餵進頁面時，模組圖裡沒有任何
 * bare specifier 要解析，於是整套測試不需要打包器（`tests/browser/support/harness.ts`）。
 * 那不是巧合——`EpubBook` 那一層本來就與渲染無關，會被拖進來只是因為型別綁在
 * 一起。
 *
 * ## 這裡的型別是結構性的，不是從 `EpubBook` import 來的
 *
 * 直接 import `Section` 與 `Resource` 會讓這個介面跟著 `EpubBook` 的每一次擴充
 * 走，而 `Renderer` 用不到的欄位（`properties`、manifest 的 id）會變成 fake 的
 * 義務。所以這裡寫**渲染實際需要的那幾格**，另外用一條型別斷言確保 `EpubBook`
 * 仍然滿足它——漂開的時候會在 `npm run typecheck` 紅，不是在執行期。
 */

/** 一本渲染得出來的書。 */
export interface RenderableBook {
  /** 閱讀順序。順序即封裝文件宣告的順序（CONTEXT.md）。 */
  readonly readingOrder: readonly RenderableSection[];
  /**
   * 書宣告的資源。`Renderer` 只從這裡取 media type——內容文件引用一份資源時
   * 給的是路徑，而 `blob:` 需要知道型別才建得起來。
   */
  readonly resources: readonly RenderableResource[];
  /**
   * 壓縮檔內某個路徑的位元組。混淆過的字型在這一層已經還原。
   *
   * @throws 路徑不存在或解不開時丟——**不回空位元組**。空位元組在畫面上的症狀
   * 是缺圖或滿頁豆腐字，那時候沒有人查得到根因在取用這一步。
   */
  bytes(path: string): Uint8Array;
}

export interface RenderableSection {
  readonly path: string;
  readonly mediaType: string;
  /**
   * 在不在線性的閱讀進程上。`Renderer` **不濾掉** `false` 的那幾項——封面頁與
   * 版權頁確實是書的一部分，濾掉它們是政策不是事實（ADR-0002）。
   */
  readonly linear: boolean;
}

export interface RenderableResource {
  readonly location: RenderableLocation;
  readonly mediaType: string;
}

export type RenderableLocation =
  | { readonly kind: "in-container"; readonly path: string }
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "remote" };

/**
 * 一份 in-memory 的書——公開 API 的一部分（ADR-0002），不是測試工具。
 *
 * 上層要測「拿到 relocate 事件之後 UI 該怎麼更新」這類純決策的程式碼時，需要一本
 * 可以精確控制的書，而不是一個 EPUB 檔案。這裡給的就是那個。
 */
export class MemoryBook implements RenderableBook {
  readonly readingOrder: readonly RenderableSection[];
  readonly resources: readonly RenderableResource[];

  private readonly files: ReadonlyMap<string, Uint8Array>;

  private constructor(
    readingOrder: readonly RenderableSection[],
    resources: readonly RenderableResource[],
    files: ReadonlyMap<string, Uint8Array>,
  ) {
    this.readingOrder = readingOrder;
    this.resources = resources;
    this.files = files;
  }

  bytes(path: string): Uint8Array {
    const bytes = this.files.get(path);
    if (bytes === undefined) {
      throw new Error(`這本 MemoryBook 裡沒有 ${path}`);
    }
    return bytes;
  }

  static of(spec: MemoryBookSpec): MemoryBook {
    const encoder = new TextEncoder();
    const files = new Map<string, Uint8Array>();

    const readingOrder = spec.sections.map((section) => {
      files.set(
        section.path,
        typeof section.content === "string"
          ? encoder.encode(section.content)
          : section.content,
      );
      return {
        path: section.path,
        mediaType: section.mediaType ?? XHTML_MEDIA_TYPE,
        linear: section.linear ?? true,
      };
    });

    for (const resource of spec.resources ?? []) {
      files.set(resource.path, resource.bytes);
    }

    const resources: RenderableResource[] = [
      ...readingOrder.map((section) => ({
        location: { kind: "in-container" as const, path: section.path },
        mediaType: section.mediaType,
      })),
      ...(spec.resources ?? []).map((resource) => ({
        location: { kind: "in-container" as const, path: resource.path },
        mediaType: resource.mediaType,
      })),
    ];

    return new MemoryBook(readingOrder, resources, files);
  }
}

const XHTML_MEDIA_TYPE = "application/xhtml+xml";

export interface MemoryBookSpec {
  readonly sections: readonly MemorySectionSpec[];
  readonly resources?: readonly MemoryResourceSpec[];
}

export interface MemorySectionSpec {
  readonly path: string;
  /** XHTML 原始碼，或已經編碼好的位元組。 */
  readonly content: string | Uint8Array;
  readonly mediaType?: string;
  readonly linear?: boolean;
}

export interface MemoryResourceSpec {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}
