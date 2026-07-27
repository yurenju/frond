/**
 * `Renderer`——ADR-0005 雙層切分的上半：需要 DOM 的那一層。
 *
 * 形狀是「**純 class，接收一個容器元素**」而不是自訂元素，理由在 ADR-0005：
 * `CustomEvent.detail` 在 TypeScript 裡是 `any`，而「不必對著 `any` 猜欄位」正是
 * 這個專案存在的一半理由。
 *
 * ## 它回答什麼、不回答什麼
 *
 * frond 擁有事實，消費端擁有政策（ADR-0002）。這個 class 回答「這本書在這個
 * viewport 下是什麼樣子、現在在哪裡」——書寫方向、頁數、目前位置的 CFI 與
 * fraction、一段範圍佔據的矩形。它**不吃手勢**：`next()` 與 `previous()` 是動作
 * 不是事件處理器，「往左滑等於下一頁」這個決定屬於消費端。書是 `rtl` 這個事實由
 * `EpubBook.metadata.pageProgressionDirection` 給，不在這一層。
 */

import { parseCfi, serializeCfi, type Cfi } from "../epub/cfi.ts";
import { resolveHref } from "../epub/resource-path.ts";
import type { RenderableBook } from "./book.ts";
import { cfiForRange, rangeForCfi, sectionIndexOf, spineSegment } from "./cfi-dom.ts";
import {
  buildSectionDocument,
  ResourceUrls,
  SectionParseError,
} from "./document-source.ts";
import {
  Emitter,
  type RenderLocation,
  type RendererEvents,
  type Unsubscribe,
} from "./events.ts";
import type { WritingMode } from "./geometry.ts";
import { ProgressIndex } from "./progress.ts";
import { SectionView } from "./section-view.ts";
import {
  DEFAULT_SETTINGS,
  withSettings,
  type ReaderSettings,
} from "./settings.ts";
import { charactersBefore, countCharacters, positionAtCharacter, textNodesIn } from "./text-index.ts";

/** 要跳到一節的哪裡。 */
export type SectionAnchor =
  | { readonly kind: "first-page" }
  | { readonly kind: "last-page" }
  | { readonly kind: "fragment"; readonly id: string }
  | { readonly kind: "cfi"; readonly cfi: Cfi }
  | { readonly kind: "characters"; readonly characters: number };

export interface RendererOptions {
  readonly settings?: Partial<ReaderSettings>;
  /**
   * 在第一節渲染**之前**掛上的 listener。
   *
   * `attach()` 回傳時第一節已經排好了，也就是說那一次的 `load` 與 `relocate` 是
   * 在 `attach()` 裡面送出去的——事後再 `on()` 掛，那兩個事件已經過去了。消費端
   * 因此有兩種寫法：讀 `renderer.location` 拿初始狀態（同步、隨時可讀），或從
   * 這裡掛 listener 收到完整的事件序列。
   *
   * 有這個欄位而不是把初始事件延後送，是因為延後送會讓「事件到達的順序」與
   * 「狀態實際改變的順序」不一致，而那是最難查的一種 bug。
   */
  readonly on?: RendererListeners;
}

export type RendererListeners = {
  readonly [Name in keyof RendererEvents]?: (event: RendererEvents[Name]) => void;
};

export class Renderer {
  readonly book: RenderableBook;

  private readonly container: HTMLElement;
  private readonly emitter = new Emitter<RendererEvents>();
  private readonly restoreContainerStyle: () => void;
  private readonly resizeObserver: ResizeObserver | undefined;

  private currentSettings: ReaderSettings;
  private resources: ResourceUrls;
  private view: SectionView | undefined;
  private sectionIndex = 0;
  private index: ProgressIndex | undefined;
  private destroyed = false;
  /** 上一次送出去的位置，用來擋掉沒有變化的 `relocate`。 */
  private lastEmitted: string | undefined;

  private constructor(
    book: RenderableBook,
    container: HTMLElement,
    settings: ReaderSettings,
  ) {
    this.book = book;
    this.container = container;
    this.currentSettings = settings;
    this.resources = new ResourceUrls(book, settings);

    // iframe 是絕對定位的（邊界靠 inset 給），所以容器必須是它的定位參考。
    // 只在容器還是 static 的時候動它，而且記下原值——`destroy()` 要還原。
    const view = container.ownerDocument.defaultView;
    const originalPosition = container.style.position;
    const originalBackground = container.style.backgroundColor;

    if (view !== null && view.getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    this.applyContainerTheme();

    this.restoreContainerStyle = () => {
      container.style.position = originalPosition;
      container.style.backgroundColor = originalBackground;
    };

    if (view !== null && typeof view.ResizeObserver === "function") {
      this.resizeObserver = new view.ResizeObserver(() => {
        void this.resize();
      });
      this.resizeObserver.observe(container);
    }
  }

  /**
   * 把一本書掛到一個容器元素上，渲染第一節。
   *
   * 整書索引**不在這裡等**：它要把每一節都讀過一次，而讀者要的是第一頁盡快出現。
   * 索引好了會送一個 `indexed` 事件，在那之前 `location.fraction` 是 `undefined`
   * （user story 25）。
   */
  static async attach(
    book: RenderableBook,
    container: HTMLElement,
    options: RendererOptions = {},
  ): Promise<Renderer> {
    const renderer = new Renderer(
      book,
      container,
      withSettings(DEFAULT_SETTINGS, options.settings ?? {}),
    );

    for (const [name, listener] of Object.entries(options.on ?? {})) {
      renderer.emitter.on(
        name as keyof RendererEvents,
        listener as (event: RendererEvents[keyof RendererEvents]) => void,
      );
    }

    await renderer.loadSection(0, { kind: "first-page" });
    void renderer.buildIndex();

    return renderer;
  }

  get settings(): ReaderSettings {
    return this.currentSettings;
  }

  /** 目前這一節排出來的書寫方向。**一本書的每一節不保證相同。** */
  get writingMode(): WritingMode {
    return this.view?.writingMode ?? "horizontal-tb";
  }

  get location(): RenderLocation {
    return this.describeLocation();
  }

  on<Name extends keyof RendererEvents>(
    name: Name,
    listener: (event: RendererEvents[Name]) => void,
  ): Unsubscribe {
    return this.emitter.on(name, listener);
  }

  /**
   * 往後翻一頁，翻到這一節的結尾時**自動接續到下一節**（user story 28）。
   *
   * 到書末時什麼也不做——不丟錯，也不繞回第一頁。`location.atEnd` 是消費端該看
   * 的那個事實。
   */
  async next(): Promise<void> {
    const view = this.view;
    if (view === undefined) return;

    if (view.page + 1 < view.pageCount) {
      view.goToPage(view.page + 1);
      this.emitRelocate();
      return;
    }

    if (this.sectionIndex + 1 >= this.book.readingOrder.length) return;
    await this.loadSection(this.sectionIndex + 1, { kind: "first-page" });
  }

  /** 往前翻一頁，翻過這一節的開頭時接到**上一節的最後一頁**。 */
  async previous(): Promise<void> {
    const view = this.view;
    if (view === undefined) return;

    if (view.page > 0) {
      view.goToPage(view.page - 1);
      this.emitRelocate();
      return;
    }

    if (this.sectionIndex === 0) return;
    await this.loadSection(this.sectionIndex - 1, { kind: "last-page" });
  }

  async goToSection(index: number, anchor: SectionAnchor = { kind: "first-page" }): Promise<void> {
    if (index < 0 || index >= this.book.readingOrder.length) return;
    await this.loadSection(index, anchor);
  }

  /**
   * 跳到一個 TOC 項目指向的位置（user story 26）。
   *
   * 收的是解析後的路徑而不是原樣的 href——`TocItem.target` 給的就是這個形狀，而
   * href 的正規化（`%2c`、`../`）已經在 `EpubBook` 那一層做完了。要 Renderer 再
   * 解析一次 href 等於把同一種正規化實作第二遍，而那正是 spine 的原罪（ADR-0002）。
   */
  async goTo(target: { readonly path: string; readonly fragment?: string | undefined }): Promise<void> {
    const index = this.book.readingOrder.findIndex(
      (section) => section.path === target.path,
    );
    if (index === -1) return;

    await this.loadSection(
      index,
      target.fragment === undefined
        ? { kind: "first-page" }
        : { kind: "fragment", id: target.fragment },
    );
  }

  /** 跳到一個 CFI（user story 20）。認不出來的 CFI 什麼也不做。 */
  async goToCfi(cfi: string | Cfi): Promise<void> {
    const parsed = typeof cfi === "string" ? tryParse(cfi) : cfi;
    if (parsed === undefined) return;

    const index = sectionIndexOf(parsed);
    if (index === undefined || index >= this.book.readingOrder.length) return;

    await this.loadSection(index, { kind: "cfi", cfi: parsed });
  }

  /**
   * 跳到一個全書進度（user story 24）。
   *
   * 索引還沒建好時什麼也不做——那時候 `location.fraction` 也是 `undefined`，
   * 定位軸本來就該是停用的。
   */
  async goToFraction(fraction: number): Promise<void> {
    const index = this.index;
    if (index === undefined) return;

    const { sectionIndex, charactersIntoSection } = index.locate(fraction);
    await this.loadSection(sectionIndex, {
      kind: "characters",
      characters: Math.round(charactersIntoSection),
    });
  }

  /**
   * 換一組讀者設定，並停在同一段文字上（user story 19、46）。
   *
   * **整節重建**。理由是介入本身寫在文字裡：拿掉書的 `!important`、把絕對字級
   * 換成 `rem`（`css.ts`），這兩件事發生在文件還是字串的時候，改不動已經解析好
   * 的 DOM。所以換設定必然要重來一次，而位置靠 CFI 帶回去——那正是 CFI 存在的
   * 理由，也是 user story 19 要的行為。
   */
  async applySettings(patch: Partial<ReaderSettings>): Promise<void> {
    const cfi = this.currentCfi();
    this.currentSettings = withSettings(this.currentSettings, patch);
    this.applyContainerTheme();

    const previousResources = this.resources;
    this.resources = new ResourceUrls(this.book, this.currentSettings);

    await this.loadSection(
      this.sectionIndex,
      cfi === undefined ? { kind: "first-page" } : { kind: "cfi", cfi },
    );

    // 舊的位址等新文件掛好之後才收——收早了，換設定的那一瞬間畫面會缺圖。
    previousResources.release();
  }

  /**
   * 容器尺寸變了之後重排，並停在原本讀到的地方（user story 32）。
   *
   * 與換設定不同，這裡**不重建文件**：版面參數換的只是那一份注入的樣式表，DOM
   * 不動。所以位置用一個 `Range` 直接帶過去，連 CFI 的字串往返都不必——少一次
   * 往返就少一組會對不上的邊界條件。
   */
  async resize(): Promise<void> {
    const view = this.view;
    if (view === undefined || this.destroyed) return;

    const anchor = view.positionAtPageStart(view.page);
    view.relayout(this.currentSettings);

    if (anchor !== undefined) view.goToPage(view.pageOf(view.rangeAt(anchor)));

    this.emitRelocate();
  }

  /**
   * 一個 CFI 在畫面上佔據的矩形，座標相對於容器（user story 49、51）。
   *
   * frond 只給幾何——顏色、樣式、動畫由消費端決定（ADR-0002）。位置不在目前這
   * 一節時回空陣列。
   */
  rectsFor(cfi: string | Cfi): readonly DOMRect[] {
    const view = this.view;
    if (view === undefined) return [];

    const parsed = typeof cfi === "string" ? tryParse(cfi) : cfi;
    if (parsed === undefined) return [];
    if (sectionIndexOf(parsed) !== this.sectionIndex) return [];

    const range = rangeForCfi(view.document, parsed);
    return range === undefined ? [] : view.rectsFor(range);
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.view?.destroy();
    this.view = undefined;
    this.resources.release();
    this.restoreContainerStyle();
    this.emitter.clear();
  }

  // --- 內部 -----------------------------------------------------------------

  /**
   * 讀者的底色也要塗在容器上，不只塗在文件裡。
   *
   * 邊界是靠把 iframe 在容器裡縮進來做的（`section-view.ts`），所以那一圈**不在
   * 文件裡**——只塗文件的話，深色模式下文字四周會留一圈消費端頁面的底色。實測
   * 就是一條白框（`docs/evidence/32/`）。
   *
   * 沒有主題時不碰容器：那時候消費端自己的底色才是對的答案。
   */
  private applyContainerTheme(): void {
    const theme = this.currentSettings.theme;
    this.container.style.backgroundColor = theme === undefined ? "" : theme.background;
  }

  private async loadSection(index: number, anchor: SectionAnchor): Promise<void> {
    if (this.destroyed) return;

    const section = this.book.readingOrder[index];
    if (section === undefined) return;

    const previous = this.view;
    let view: SectionView;

    try {
      view = await SectionView.mount(
        this.container,
        buildSectionDocument(this.book, section.path, this.currentSettings, this.resources),
        this.currentSettings,
        {
          onLinkActivate: (href) => this.emitLinkActivate(href),
          onSelectionChange: () => this.emitSelection(),
        },
        section.path,
      );
    } catch (error) {
      this.emitter.emit("error", {
        sectionIndex: index,
        sectionPath: section.path,
        reason:
          error instanceof SectionParseError
            ? "malformed-content-document"
            : "unreadable-section",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (this.destroyed) {
      view.destroy();
      return;
    }

    previous?.destroy();
    this.view = view;
    this.sectionIndex = index;

    this.emitter.emit("load", {
      sectionIndex: index,
      sectionPath: section.path,
      writingMode: view.writingMode,
    });

    this.applyAnchor(view, anchor);
    this.emitRelocate();
  }

  private applyAnchor(view: SectionView, anchor: SectionAnchor): void {
    switch (anchor.kind) {
      case "first-page":
        view.goToPage(0);
        return;

      case "last-page":
        view.goToPage(view.pageCount - 1);
        return;

      case "fragment": {
        const target = view.elementById(anchor.id);
        // 指不到的錨點停在這一節的開頭。TOC 指向不存在的 id 是實際的書會有的
        // 形狀，而讓它變成錯誤會把點目錄這件事整個打斷。
        view.goToPage(target === null ? 0 : view.pageOf(view.rangeOfNode(target)));
        return;
      }

      case "cfi": {
        const range = rangeForCfi(view.document, anchor.cfi);
        // 走不到就停在這一節的開頭。書換了一版、CFI 來自別的閱讀器，兩種都會
        // 走到這裡，而它們的處置不是丟錯把閱讀流程打斷。
        view.goToPage(range === undefined ? 0 : view.pageOf(range));
        return;
      }

      case "characters": {
        const position = positionAtCharacter(textNodesIn(view.document), anchor.characters);
        view.goToPage(position === undefined ? 0 : view.pageOf(view.rangeAt(position)));
        return;
      }
    }
  }

  /**
   * 整書索引：把每一節讀一次、數字元。
   *
   * 一節一節做，中間讓出執行緒——一本 300 節的書一口氣解析完會讓第一頁卡住不動，
   * 而第一頁已經在畫面上了，讀者正在讀它。
   */
  private async buildIndex(): Promise<void> {
    const counts: number[] = [];
    const parser = new DOMParser();
    const decoder = new TextDecoder();

    for (const section of this.book.readingOrder) {
      if (this.destroyed) return;

      let characters = 0;
      try {
        const parsed = parser.parseFromString(
          decoder.decode(this.book.bytes(section.path)),
          "application/xhtml+xml",
        );
        // 解不開的那一節算 0 個字元。它在畫面上也會是錯誤事件，而讓整個索引
        // 因為一節壞掉就建不起來，代價是整本書的定位軸都不能用。
        characters = parsed.querySelector("parsererror") === null
          ? countCharacters(parsed)
          : 0;
      } catch {
        characters = 0;
      }

      counts.push(characters);
      await yieldToBrowser();
    }

    if (this.destroyed) return;

    this.index = ProgressIndex.of(counts);
    this.emitter.emit("indexed", { characters: this.index.characters });
    this.emitRelocate();
  }

  private currentCfi(): Cfi | undefined {
    const view = this.view;
    if (view === undefined) return undefined;

    const position = view.positionAtPageStart(view.page);
    if (position === undefined) {
      // 一個字都沒有的節（純圖片）。指向整節的 CFI 仍然是一個合法的位置。
      return { kind: "point", path: [spineSegment(this.sectionIndex)] };
    }

    return cfiForRange(view.rangeAt(position), this.sectionIndex);
  }

  private describeLocation(): RenderLocation {
    const view = this.view;
    const section = this.book.readingOrder[this.sectionIndex];
    const cfi = this.currentCfi();

    return {
      sectionIndex: this.sectionIndex,
      sectionPath: section?.path ?? "",
      page: view?.page ?? 0,
      pageCount: view?.pageCount ?? 1,
      cfi: cfi === undefined ? "" : serializeCfi(cfi),
      fraction: this.currentFraction(),
      atStart: this.sectionIndex === 0 && (view?.page ?? 0) === 0,
      atEnd:
        this.sectionIndex === this.book.readingOrder.length - 1 &&
        (view?.page ?? 0) === (view?.pageCount ?? 1) - 1,
    };
  }

  private currentFraction(): number | undefined {
    const index = this.index;
    const view = this.view;
    if (index === undefined || view === undefined) return undefined;

    const position = view.positionAtPageStart(view.page);
    if (position === undefined) return index.fractionAt(this.sectionIndex, 0);

    return index.fractionAt(
      this.sectionIndex,
      charactersBefore(textNodesIn(view.document), position.node, position.offset),
    );
  }

  private emitRelocate(): void {
    const location = this.describeLocation();

    // 同一個位置不重複送。翻到書末再按一次「下一頁」時什麼都沒變，而重複的
    // relocate 會讓消費端誤以為位置動了（例如把進度同步到雲端）。
    //
    // **簽章要含 CFI。** 少了它，一次讓頁碼不變但位置真的變了的重排（換 viewport
    // 之後同一頁裝了別的內容）會被當成沒變而吃掉——而那正是消費端最需要收到的
    // 一次事件：存進度存的是 CFI，不是頁碼。
    const signature = [
      location.sectionIndex,
      location.page,
      location.fraction ?? "",
      location.cfi,
    ].join(":");
    if (signature === this.lastEmitted) return;
    this.lastEmitted = signature;

    this.emitter.emit("relocate", location);
  }

  private emitLinkActivate(href: string): void {
    const section = this.book.readingOrder[this.sectionIndex];
    const resolved = resolveHref(href, section?.path ?? "");

    if (resolved.kind === "remote") {
      this.emitter.emit("linkactivate", {
        href,
        sectionIndex: undefined,
        fragment: undefined,
        externalUrl: resolved.url,
      });
      return;
    }

    if (resolved.kind === "outside-container") {
      this.emitter.emit("linkactivate", {
        href,
        sectionIndex: undefined,
        fragment: undefined,
        externalUrl: undefined,
      });
      return;
    }

    const index = this.book.readingOrder.findIndex(
      (candidate) => candidate.path === resolved.path,
    );

    this.emitter.emit("linkactivate", {
      href,
      sectionIndex: index === -1 ? undefined : index,
      fragment: resolved.fragment,
      externalUrl: undefined,
    });
  }

  private emitSelection(): void {
    const view = this.view;
    if (view === undefined) return;

    const range = view.selection();
    if (range === undefined) {
      this.emitter.emit("selection", { cfi: undefined, text: "" });
      return;
    }

    this.emitter.emit("selection", {
      cfi: serializeCfi(cfiForRange(range, this.sectionIndex)),
      text: range.toString(),
    });
  }
}

function tryParse(cfi: string): Cfi | undefined {
  try {
    return parseCfi(cfi);
  } catch {
    return undefined;
  }
}

/** 讓出執行緒一次。`setTimeout(0)` 三家都會排在下一個 task。 */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
