/**
 * 一節的畫面：一個 iframe，加上它裡面那份文件的量測與捲動。
 *
 * 一節一個 iframe（ADR-0006）。這幾乎沒有選擇餘地——EPUB 的樣式表大量使用 `body`、
 * `p`、`*` 這類全域選擇器，Shadow DOM 擋不住那種等級的污染；而分頁需要一個真正的
 * document 來承載 `writing-mode` 與 multi-column。
 *
 * ## 邊界在 iframe 外面，不在書的 CSS 裡
 *
 * 讀者設定的邊界靠**把 iframe 在容器裡縮進來**達成，不是注入 padding 給書。差別
 * 不只是實作偏好：padding 落在分欄容器上會讓第一欄與其餘的欄起點不一樣，於是
 * 「翻一頁 = 移動一個頁距」不再成立（foliate 為此要多記一個 `contentStart`）。
 * 縮 iframe 則讓文件完全不知道邊界的存在——頁距是乾淨的整數，書的層疊也不必跟
 * frond 搶 `body` 的 padding（spine 為了搶那一格掛了一個永不解除的 MutationObserver）。
 */

import {
  marginInsets,
  pageAt,
  pageContaining,
  pageCountFor,
  pageMetrics,
  pageOffsetFor,
  resolveColumns,
  type Insets,
  type PageMetrics,
  type WritingMode,
} from "./geometry.ts";
import type { RendererKeyEvent, RendererPointerEvent } from "./events.ts";
import { LAYOUT_STYLE_ID, layoutStylesheet } from "./layout.ts";
import { isElement, isTextLike } from "./node-type.ts";
import type { ReaderSettings } from "./settings.ts";
import type { SectionDocument } from "./document-source.ts";
import { textNodesIn } from "./text-index.ts";
import { readWritingMode } from "./writing-mode.ts";

export interface SectionViewHooks {
  /** 讀者按了內容裡的連結。frond 只擋下預設行為，跳不跳由消費端決定（ADR-0002）。 */
  readonly onLinkActivate: (href: string) => void;
  /** iframe 裡的選取範圍變了。 */
  readonly onSelectionChange: () => void;
  /** iframe 裡的指標按下或放開。座標已經換算到容器座標系。 */
  readonly onPointer: (
    kind: "pointerdown" | "pointerup",
    event: RendererPointerEvent,
  ) => void;
  /** iframe 裡的按鍵。焦點在 iframe 裡時外層收不到，所以要從這裡出去。 */
  readonly onKey: (kind: "keydown" | "keyup", event: RendererKeyEvent) => void;
}

/**
 * 書寫方向讀不出來。
 *
 * 這是一個**明確的失敗**而不是退回橫排：Firefox 在讀不到時回空字串
 * （`docs/browser-quirks.md`），而把空字串當成橫排的實作，症狀會是「直排書偶爾
 * 整本排成橫排」。
 */
export class WritingModeUnreadableError extends Error {
  constructor(path: string) {
    super(`${path} 的書寫方向讀不出來——computed style 是空字串`);
    this.name = "WritingModeUnreadableError";
  }
}

export class SectionView {
  readonly document: Document;
  readonly writingMode: WritingMode;

  private readonly frame: HTMLIFrameElement;
  private readonly source: SectionDocument;
  private readonly host: HTMLElement;
  private settings: ReaderSettings;
  private metrics: PageMetrics;
  /** 讀者設定的邊界落到四個實體邊之後的值。座標換算與 iframe 定位都要它。 */
  private insets: Insets;
  /** 依文件順序攤平的文字節點。量位置時要二分搜尋它，所以只算一次。 */
  private textNodes: readonly Text[];

  private constructor(
    frame: HTMLIFrameElement,
    source: SectionDocument,
    host: HTMLElement,
    document: Document,
    writingMode: WritingMode,
    settings: ReaderSettings,
    metrics: PageMetrics,
    insets: Insets,
  ) {
    this.frame = frame;
    this.source = source;
    this.host = host;
    this.document = document;
    this.writingMode = writingMode;
    this.settings = settings;
    this.metrics = metrics;
    this.insets = insets;
    this.textNodes = textNodesIn(document);
  }

  static async mount(
    host: HTMLElement,
    source: SectionDocument,
    settings: ReaderSettings,
    hooks: SectionViewHooks,
    path: string,
  ): Promise<SectionView> {
    const frame = host.ownerDocument.createElement("iframe");

    // `allow-scripts` 是被 WebKit 逼出來的，不是因為要跑書的腳本：少了它，
    // WebKit 連 parent 掛在 contentDocument 上的 listener 都收不到（bug 218086，
    // #7 已在三家重現）。書的腳本已經在文件還是文字的時候拿掉了
    // （`document-source.ts`），所以這個 sandbox 值不會讓書內的程式碼跑起來。
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
    frame.setAttribute("title", "");
    frame.style.border = "0";
    frame.style.display = "block";
    frame.style.position = "absolute";
    frame.style.background = "transparent";
    host.append(frame);

    // 載入前先用一個對稱的邊界撐開。軸向的邊界要有書寫方向才映得出實體邊，而
    // 那要等文件排出來才讀得到——所以正式的尺寸在下面讀到方向之後再量一次。
    // 純量的邊界兩次算出來一樣，那條路上不會有第二次 reflow。
    sizeFrame(frame, host, marginInsets(settings.margin, "horizontal-tb"));

    await new Promise<void>((resolve, reject) => {
      frame.addEventListener("load", () => resolve(), { once: true });
      frame.addEventListener(
        "error",
        () => reject(new Error(`${path} 的 iframe 載入失敗`)),
        { once: true },
      );
      frame.src = source.url;
    });

    const document = frame.contentDocument;
    if (document === null) {
      throw new Error(`${path} 載入後取不到 contentDocument`);
    }

    // 字型載入完才量。分頁是字型的函數：字型還沒到位時量到的斷行與斷頁是暫時的，
    // 而那組數字會被寫進頁數與位置。foliate 也是用它取代 Firefox 上不可靠的
    // `ResizeObserver`（`docs/browser-quirks.md` 表一 #3）。
    await document.fonts.ready;

    const reading = readWritingMode(document);
    if (reading.kind === "unreadable") throw new WritingModeUnreadableError(path);

    // 量幾何**之前**再 size 一次：`metricsFor` 讀的是 iframe 的 client 尺寸，
    // 而軸向的邊界到這一刻才知道該扣哪兩邊。
    const insets = marginInsets(settings.margin, reading.writingMode);
    sizeFrame(frame, host, insets);

    const view = new SectionView(
      frame,
      source,
      host,
      document,
      reading.writingMode,
      settings,
      metricsFor(frame, settings, reading.writingMode),
      insets,
    );
    view.applyLayout();
    view.attachHooks(hooks);

    return view;
  }

  /**
   * 這一節共幾頁。
   *
   * ## 為什麼不能只看捲動總長
   *
   * 捲動總長會把**只有邊距的尾巴**算成一頁。直排時特別容易踩到：書寫
   * `p { margin: 0 0 1em }`（實際的書的常態）時，那個 `margin-bottom` 是實體
   * 邊界，在 `vertical-rl` 下落在**分頁軸**上——最後一段的下邊距因此可能把捲動
   * 總長推進下一欄，而那一欄裡一個字都沒有。
   *
   * 讀者翻到那一頁會看到全白，而「空白頁」正是封閉缺陷清單裡的一項
   * （`docs/agents/pull-requests.md`）。更麻煩的是它讓位置的往返失去 identity：
   * 那一頁報得出頁碼，卻報不出屬於自己的 CFI（最靠近的位置在上一頁），於是
   * 「CFI → 跳過去 → CFI」在最後一頁對不上。
   *
   * 所以頁數取兩者的小者：捲動總長算出來的，與**內容實際延伸到的那一頁**。
   */
  get pageCount(): number {
    const byScroll = pageCountFor(this.metrics, this.scrollExtent);
    const lastWithContent = this.lastPageWithContent();

    return lastWithContent === undefined
      ? byScroll
      : Math.max(1, Math.min(byScroll, lastWithContent + 1));
  }

  /** 目前停在第幾頁，從 0 起算。 */
  get page(): number {
    return Math.min(pageAt(this.metrics, this.scrollOffset), this.pageCount - 1);
  }

  goToPage(page: number): void {
    const clamped = Math.min(Math.max(0, page), this.pageCount - 1);
    const offset = pageOffsetFor(this.metrics, clamped);
    const root = this.document.documentElement;

    if (this.metrics.axis === "y") root.scrollTop = offset;
    else root.scrollLeft = offset;
  }

  /**
   * 版面變了（容器尺寸、讀者的邊界或欄數）之後重新量一次。
   *
   * **不重新載入文件**：換的只是 `<style id="frond-layout">` 的內容，DOM 不動，
   * 所以指向節點的 `Range` 在重排之後仍然有效——位置的回復因此不必依賴 CFI 的
   * 字串往返。
   */
  relayout(settings: ReaderSettings): void {
    this.settings = settings;
    this.insets = marginInsets(settings.margin, this.writingMode);
    sizeFrame(this.frame, this.host, this.insets);
    this.metrics = metricsFor(this.frame, settings, this.writingMode);
    this.applyLayout();
  }

  /** 一個 `Range` 落在分頁軸上的哪個位置（已加回捲動量）。 */
  offsetOf(range: Range): number {
    const rect = firstVisibleRect(range);
    if (rect === undefined) return 0;

    return this.metrics.axis === "y"
      ? rect.top + this.document.documentElement.scrollTop
      : rect.left + this.document.documentElement.scrollLeft;
  }

  /**
   * 一個 `Range` 落在第幾頁。
   *
   * 走的是 `pageContaining` 而不是 `pageAt`——內容的位置落在一頁裡面的任何地方，
   * 不是頁距的整數倍（`geometry.ts`）。
   */
  pageOf(range: Range): number {
    return Math.min(
      pageContaining(this.metrics, this.offsetOf(range)),
      this.pageCount - 1,
    );
  }

  /**
   * 某一頁最前面那個字元。
   *
   * 二分搜尋而不是從頭掃：`huge-single-section` 那本書的一節有一千多個段落，
   * 每翻一頁掃一次的話每次都要量幾千個矩形。二分搜尋成立的前提是**文字節點在
   * 分頁軸上的位置隨文件順序遞增**——那正是分欄版面的性質。
   *
   * 找不到（整節沒有文字，例如 `empty-and-image-only-sections` 的那一節）時回
   * `undefined`。
   */
  positionAtPageStart(page: number): { readonly node: Text; readonly offset: number } | undefined {
    if (this.textNodes.length === 0) return undefined;

    const target = pageOffsetFor(this.metrics, page);
    const nodeIndex = this.firstNodeAtOrAfter(target);
    const node = this.textNodes[nodeIndex];
    if (node === undefined) {
      // 目標落在最後一個文字節點之後：停在它的結尾。
      const last = this.textNodes[this.textNodes.length - 1]!;
      return { node: last, offset: last.length };
    }

    // 這一個節點可能跨在頁的邊界上（長段落），所以再往節點裡面二分一次。
    return { node, offset: this.firstCharacterAtOrAfter(node, target) };
  }

  /**
   * 把一個位置變成這份文件裡的一個 `Range`。
   *
   * 放在這裡而不是讓呼叫端自己 `createRange()`：`Range` 必須由**這一份**文件建
   * 出來，拿外層文件的 `createRange()` 去指 iframe 裡的節點會丟
   * `WrongDocumentError`。把那個約束收在擁有文件的這一邊，呼叫端就不會有第二個
   * 地方需要記得它。
   */
  rangeAt(position: { readonly node: Node; readonly offset: number }): Range {
    const range = this.document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    return range;
  }

  /** 涵蓋整個元素的 `Range`——跳到某個錨點時要的那一個。 */
  rangeOfNode(node: Node): Range {
    const range = this.document.createRange();
    range.selectNode(node);
    return range;
  }

  /** 這份文件裡 id 是這個的元素。 */
  elementById(id: string): Element | null {
    return this.document.getElementById(id);
  }

  /**
   * 一段範圍在容器座標系裡的矩形——消費端要自己畫 highlight 時要的幾何
   * （user story 49、51）。
   *
   * 給的是**相對於容器**而不是相對於 iframe：消費端把 highlight 畫在容器上，
   * 而 iframe 自己還被邊界推移過。顏色、樣式、動畫由消費端決定，frond 只給幾何
   * （ADR-0002）。
   */
  rectsFor(range: Range): readonly DOMRect[] {
    // 長度為零的 range 走 `measurable`（先撐開一個字元）而不是直接問它自己的
    // 矩形，理由與量位置時相同：游標在欄邊界上會被畫到上一欄的結尾。順帶也解掉
    // 「零寬的矩形被濾光、消費端收到空陣列」那一格。
    const resolved =
      measurable(range)
        .map((candidate) =>
          [...candidate.getClientRects()].filter(
            (rect) => rect.width > 0 && rect.height > 0,
          ),
        )
        .find((rects) => rects.length > 0) ?? [];

    return resolved.map(
      (rect) =>
        new DOMRect(
          rect.left + this.insets.left,
          rect.top + this.insets.top,
          rect.width,
          rect.height,
        ),
    );
  }

  /** 目前選取的範圍。沒有選取或選取不在這份文件裡時是 `undefined`。 */
  selection(): Range | undefined {
    const selection = this.document.getSelection();
    if (selection === null || selection.rangeCount === 0) return undefined;

    const range = selection.getRangeAt(0);
    return range.collapsed ? undefined : range;
  }

  destroy(): void {
    this.frame.remove();
    this.source.release();
  }

  /**
   * 內容實際延伸到第幾頁。一個字也沒有、一張圖也沒有的節回 `undefined`。
   *
   * 「內容」包含文字與被取代元素（圖片、影片）——只看文字的話，
   * `empty-and-image-only-sections` 那種純圖片的節會被判成零頁。
   *
   * ## 文件順序的最後一個文字節點不一定畫得出來
   *
   * 這是實際的書上量到的一個病症（`hidden-trailing-notes`）：書把註腳放在正文
   * **後面**、用 `display: none` 藏起來，讀者點上標才看到，是很常見的做法；整份
   * `nav.xhtml` 被藏起來也是。那些節點在文件順序上是最後幾個，但它們一個矩形都
   * 量不到。
   *
   * 拿那種節點當內容的終點，`getBoundingClientRect()` 給的是**全零**——於是
   * `axisEndOf` 算出 0、`pageContaining` 算出第 0 頁，整節的頁數被壓成 1。
   * 症狀是讀者只讀得到一章的第一頁，其餘全部翻不過去，而且**不會有任何錯誤**：
   * 頁數看起來是一個正常的數字。樣本裡最嚴重的一節有 8778 個畫得出來的字元，
   * 全書只報得出 1 頁。
   *
   * 所以要從後往前找**第一個量得到矩形的**文字節點，而不是取最後一個。走訪的
   * 長度就是尾巴上藏起來的節點數，正常的書是零步。
   */
  private lastPageWithContent(): number | undefined {
    let end: number | undefined;

    for (let index = this.textNodes.length - 1; index >= 0; index -= 1) {
      const range = this.document.createRange();
      range.selectNodeContents(this.textNodes[index]!);
      const rect = renderedRect(range);
      if (rect !== undefined) {
        end = this.axisEndOf(rect);
        break;
      }
    }

    for (const element of this.document.querySelectorAll(REPLACED_ELEMENTS)) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const candidate = this.axisEndOf(rect);
      end = end === undefined ? candidate : Math.max(end, candidate);
    }

    if (end === undefined) return undefined;

    // 減一個像素，讓剛好填滿一頁的內容不會因為容差而被算進下一頁。
    return pageContaining(this.metrics, Math.max(0, end - 1));
  }

  /** 一個矩形在分頁軸上的遠端，已加回捲動量。 */
  private axisEndOf(rect: DOMRect): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y"
      ? rect.bottom + root.scrollTop
      : rect.right + root.scrollLeft;
  }

  private get scrollExtent(): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y" ? root.scrollHeight : root.scrollWidth;
  }

  private get scrollOffset(): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y" ? root.scrollTop : root.scrollLeft;
  }

  private applyLayout(): void {
    const style = this.document.getElementById(LAYOUT_STYLE_ID);
    if (style === null) return;
    style.textContent = layoutStylesheet(this.metrics, this.writingMode);
  }

  private attachHooks(hooks: SectionViewHooks): void {
    this.document.addEventListener("click", (event) => {
      // **不能用 `instanceof Element`。** 這支模組跑在外層頁面的 realm，而事件的
      // target 來自 iframe 的 realm——兩個 realm 有各自的 `Element` 建構子，所以
      // `instanceof` 一律是 false。症狀是連結事件完全不送，而且不會有任何錯誤
      // 訊息，看起來就像「這個 listener 沒有掛上」。
      const target = event.target as Node | null;
      if (target === null) return;

      const element = isElement(target) ? target : target.parentElement;
      const anchor = element?.closest("a[href]") ?? null;
      if (anchor === null) return;

      // 擋下預設行為是必要的：讓 iframe 自己導航過去會把整個渲染狀態丟掉，而
      // 那之後 frond 手上的 document 參考指向一份已經不在畫面上的文件。
      event.preventDefault();
      hooks.onLinkActivate(anchor.getAttribute("href") ?? "");
    });

    this.document.addEventListener("selectionchange", () => {
      hooks.onSelectionChange();
    });

    // 一律 `passive`：frond 不對指標與按鍵做任何決定，也就沒有要擋的預設行為。
    // 非 passive 的 touch listener 會讓瀏覽器每一次都等 listener 跑完才決定要不要
    // 捲動，而那正是選字與捲動在手機上變頓的原因。
    for (const kind of ["pointerdown", "pointerup"] as const) {
      this.document.addEventListener(
        kind,
        (event) => {
          hooks.onPointer(kind, this.describePointer(event as unknown as PointerFacts));
        },
        { passive: true },
      );
    }

    for (const kind of ["keydown", "keyup"] as const) {
      this.document.addEventListener(
        kind,
        (event) => {
          hooks.onKey(kind, describeKey(event as unknown as KeyFacts));
        },
        { passive: true },
      );
    }
  }

  /**
   * 一次指標事件在容器座標系裡的位置與當下的兩個 DOM 條件。
   *
   * iframe 的內容自己捲，而 iframe 本身只有一個 viewport 那麼大——所以事件的
   * `clientX`／`clientY` 已經是相對於可視區域的，**不必再加回捲動量**。要加的
   * 只有 iframe 在容器裡被推移的那一段，也就是讀者設定的邊界。這與 `rectsFor()`
   * 的換算是同一條，兩者因此回同一個座標系。
   *
   * （spine 在 epub.js 上要減掉 `scrollLeft`，是因為那邊的 iframe 撐滿整個已捲動
   * 的節。frond 的 iframe 不是那個形狀，照抄那一步會讓座標整頁偏掉。）
   */
  private describePointer(event: PointerFacts): RendererPointerEvent {
    // **不能用 `instanceof Element`**——target 來自 iframe 的 realm，理由與上面
    // 那個 click listener 相同。
    const target = event.target as Node | null;
    const element = target === null ? null : isElement(target) ? target : target.parentElement;

    return {
      x: event.clientX + this.insets.left,
      y: event.clientY + this.insets.top,
      width: this.host.clientWidth,
      height: this.host.clientHeight,
      hasSelection: this.selection() !== undefined,
      isLink: (element?.closest("a[href]") ?? null) !== null,
    };
  }

  /** 第一個起點在 `target` 之後（含）的文字節點的索引。 */
  private firstNodeAtOrAfter(target: number): number {
    let low = 0;
    let high = this.textNodes.length;

    while (low < high) {
      const middle = (low + high) >> 1;
      const node = this.textNodes[middle]!;
      if (this.endOffsetOfNode(node) >= target) high = middle;
      else low = middle + 1;
    }

    return low;
  }

  /** 這個節點裡第一個落在 `target` 之後（含）的字元。 */
  private firstCharacterAtOrAfter(node: Text, target: number): number {
    let low = 0;
    let high = node.length;

    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.offsetOfCharacter(node, middle) >= target) high = middle;
      else low = middle + 1;
    }

    return Math.min(low, Math.max(0, node.length - 1));
  }

  /** 一個節點結尾在分頁軸上的位置。 */
  private endOffsetOfNode(node: Text): number {
    const range = this.document.createRange();
    range.selectNodeContents(node);
    const rect = lastVisibleRect(range);
    if (rect === undefined) return 0;

    return this.metrics.axis === "y"
      ? rect.bottom + this.document.documentElement.scrollTop
      : rect.right + this.document.documentElement.scrollLeft;
  }

  /** 一個字元在分頁軸上的位置。 */
  private offsetOfCharacter(node: Text, offset: number): number {
    const range = this.document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, Math.min(offset + 1, node.length));
    return this.offsetOf(range);
  }
}

/**
 * iframe 在容器裡縮進讀者設定的邊界。
 *
 * 定位用實體的 `left`／`top` 而不是邏輯的 `inset-inline-start`／`inset-block-start`。
 * 那兩個邏輯屬性解析的是**容器**的書寫方向，也就是消費端 app 的方向，與書的方向
 * 無關——消費端頁面是 rtl 的時候，`inset-inline-start` 會變成右邊，而 `rectsFor()`
 * 加回去的是 `rect.left`。兩邊用不同的參考系，highlight 會整片偏移。
 */
function sizeFrame(frame: HTMLIFrameElement, host: HTMLElement, insets: Insets): void {
  const width = Math.max(1, Math.floor(host.clientWidth - insets.left - insets.right));
  const height = Math.max(1, Math.floor(host.clientHeight - insets.top - insets.bottom));

  frame.style.left = `${insets.left}px`;
  frame.style.top = `${insets.top}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
}

/**
 * 指標事件裡 frond 讀的那幾格。
 *
 * 寫成一個窄介面而不是用 `PointerEvent`：事件來自 iframe 的 realm，型別上是外層
 * realm 的建構子，實際上不是同一個——只讀資料欄位是安全的，而窄介面讓「只讀資料
 * 欄位」這件事變成型別擋得住的東西。
 */
interface PointerFacts {
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget | null;
}

interface KeyFacts {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

function describeKey(event: KeyFacts): RendererKeyEvent {
  return {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    isComposing: event.isComposing,
  };
}

function metricsFor(
  frame: HTMLIFrameElement,
  settings: ReaderSettings,
  writingMode: WritingMode,
): PageMetrics {
  const viewport = {
    width: frame.clientWidth,
    height: frame.clientHeight,
  };

  return pageMetrics({
    writingMode,
    viewport,
    columns: resolveColumns(writingMode, settings.columns, viewport),
    // 欄距同時是相鄰兩頁之間那條看不見的縫，讀者看不到它——所以它不需要是一個
    // 設定，取一個固定值就好。取 0 也可以，取一個正值是為了讓雙欄時兩欄之間
    // 有實際的間隔。
    gap: COLUMN_GAP,
  });
}

/**
 * 欄距。
 *
 * 單欄時它完全落在畫面外（兩頁之間），雙欄時它是頁內那條分隔。取 40px 是因為
 * 雙欄的兩段文字靠太近會讀錯行，而這個值同時決定了單欄時兩頁之間的距離——那一段
 * 讀者永遠看不到，所以它多大都不影響版面。
 */
const COLUMN_GAP = 40;

/**
 * 有內容但沒有文字的元素。判斷「這一頁是不是空的」時要算它們。
 *
 * 不含 `<iframe>` / `<object>` / `<embed>`：那三個在文件還是文字的時候就已經
 * 整個拿掉了（`document-source.ts` 的 `stripScriptedContent`），寫在這裡只會讓
 * 讀的人以為它們會出現。
 */
const REPLACED_ELEMENTS = "img, svg, video, canvas";

/**
 * 一段範圍的第一個**有面積**的矩形。
 *
 * 三條實測到的坑都由這一個函式擋住（`docs/browser-quirks.md` 的 foliate 補丁表）：
 *
 * - collapsed 的 range 有時候一個 client rect 都不回（表二 #7）。CFI 的定位大量
 *   產生 collapsed range，所以這一格一定會踩到。
 * - Firefox 的 `getBoundingClientRect()` 會漏掉寬為零、高不為零的 rect（表一 #5，
 *   本專案的探針沒有踩到那個前提，所以狀態是未知而不是「Firefox 沒這個 bug」）。
 * - range 的起點緊接在前一欄的連字號之後時，那一欄會多出一個零寬的 rect（表二
 *   #12）。取第一個有面積的就跳過它了。
 *
 * 所以這裡一律走 `getClientRects()` 並濾掉沒有面積的，而不是用
 * `getBoundingClientRect()`。
 */
function firstVisibleRect(range: Range): DOMRect | undefined {
  for (const candidate of measurable(range)) {
    for (const rect of candidate.getClientRects()) {
      if (rect.width > 0 || rect.height > 0) return rect;
    }
  }
  return undefined;
}

/**
 * 一個 range 該拿哪些形式去量，依序。
 *
 * **長度為零的 range 一律先撐開一個字元再量，而不是先問它自己的矩形。** 這不是
 * 效能考量，是正確性：長度為零的位置落在欄的邊界上時，瀏覽器把游標畫在**上一欄
 * 的結尾**而不是這一欄的開頭（文字游標的 affinity——同一個位置在換行處有兩個
 * 合理的畫法）。於是「這一頁最前面那個字元」量出來會落在上一頁。
 *
 * 症狀特別難查：它只在位置剛好是換頁點時發生，而那正是 frond 每一次回報位置時
 * 都會碰到的情況。表現出來是「用 CFI 跳回剛才那一頁，落到了上一頁」，而且只有
 * 部分頁面會這樣。
 *
 * 撐開之後量到的是那個字元自己的框，沒有 affinity 的餘地。撐不開時（節點結尾、
 * 空節點）才退回原本的 range。
 */
function measurable(range: Range): readonly Range[] {
  if (!range.collapsed) return [range];

  const expanded = uncollapse(range);
  return expanded === undefined ? [range] : [expanded, range];
}

/**
 * 一個範圍**實際畫出來**的最後一個矩形。畫不出來時是 `undefined`。
 *
 * 與 `lastVisibleRect` 的差別只有畫不出來那一格，而那一格的兩種處置服務兩個不同
 * 的問題，所以是兩支函式而不是一個旗標：
 *
 * | | 問的是 | 量不到時要什麼 |
 * | --- | --- | --- |
 * | `renderedRect` | 內容延伸到哪裡（頁數） | **`undefined`**——藏起來的內容不佔頁 |
 * | `lastVisibleRect` | 這個位置在畫面的哪裡（CFI） | 一個大概的位置，見下 |
 *
 * 混用的代價是實際踩過的：頁數那一側拿到全零的矩形，整節就被壓成一頁
 * （`lastPageWithContent`）。
 */
function renderedRect(range: Range): DOMRect | undefined {
  for (const candidate of measurable(range)) {
    let found: DOMRect | undefined;
    for (const rect of candidate.getClientRects()) {
      if (rect.width > 0 || rect.height > 0) found = rect;
    }
    if (found !== undefined) return found;
  }

  return undefined;
}

function lastVisibleRect(range: Range): DOMRect | undefined {
  const rendered = renderedRect(range);
  if (rendered !== undefined) return rendered;

  // 一個矩形都量不到。空白節點那一格已經在 `text-index.ts` 濾掉了，剩下的是
  // `display: none` 之類的內容——退回它所在的元素，讓位置至少落在對的區域。
  // 回 `undefined` 的話二分搜尋會拿到 0，而 0 在任何一頁都成立，搜尋就失去方向。
  const element = range.startContainer.parentElement;
  return element?.getBoundingClientRect();
}

/** 把一個長度為零的 range 撐成一個字元寬。撐不開時回 `undefined`。 */
function uncollapse(range: Range): Range | undefined {
  if (!range.collapsed) return undefined;

  const container = range.startContainer;
  const expanded = range.cloneRange();

  if (isTextLike(container)) {
    const length = container.nodeValue?.length ?? 0;
    if (range.startOffset < length) {
      expanded.setEnd(container, range.startOffset + 1);
      return expanded;
    }
    if (range.startOffset > 0) {
      expanded.setStart(container, range.startOffset - 1);
      return expanded;
    }
    return undefined;
  }

  expanded.selectNode(container);
  return expanded;
}
