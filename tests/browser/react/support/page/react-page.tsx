/**
 * 瀏覽器那一側的操作面。
 *
 * 它跑在頁面裡，所以它看得到真的 React 樹與真的 `Renderer`；spec 那一側只拿得到
 * 可序列化的東西加上一般的 DOM 斷言。
 *
 * ## 為什麼書是 `MemoryBook` 而不是合成 fixture
 *
 * 這一批測試量的是 **frond-react 加上去的那一層**——掛載、卸載、換書、換設定、
 * `data-*` 屬性——而不是 frond 排版排得對不對（那是 `tests/browser/renderer/`
 * 的事，而且它們用的是實際解析出來的書）。
 *
 * `MemoryBook` 是公開 API 的一部分（ADR-0002），所以這裡順便也在示範消費端該怎麼
 * 測他們自己接 frond 的那一層：不需要一個 EPUB 檔案。
 */

import { StrictMode, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import * as Reader from "@yurenju/frond-react";
import { MemoryBook, type ReaderSettings, type RenderableBook } from "@yurenju/frond/renderer";
import type {
  LocationSnapshot,
  MountConfig,
  ReactHarness,
  SettingsPatch,
} from "../harness.ts";

/** 段落夠多，一節排得出好幾頁——不然 `atEnd` 從第一頁就是真的。 */
function prose(marker: string): string {
  const paragraph = `<p>${marker}　この文章は折り返しと改ページを起こすためだけに置かれている。`
    .concat("いろはにほへとちりぬるを".repeat(24))
    .concat("</p>");

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${marker}</title></head>
<body>${paragraph.repeat(8)}</body></html>`;
}

const BOOKS: Record<"one" | "two", RenderableBook> = {
  one: MemoryBook.of({
    sections: [
      { path: "one-a.xhtml", content: prose("one-a") },
      { path: "one-b.xhtml", content: prose("one-b") },
    ],
  }),
  two: MemoryBook.of({
    sections: [{ path: "two-a.xhtml", content: prose("two-a") }],
  }),
};

// --- 一顆給 React 讀的外部狀態 ----------------------------------------------
//
// 用 `useSyncExternalStore` 而不是把 `setState` 存到模組變數裡。後者要在 render
// 期間寫一個模組層的變數，而那在 StrictMode 底下（render 會跑兩次）是最容易騙過
// 自己的一種寫法——偏偏 StrictMode 正是這批測試要驗的東西。

let config: MountConfig = { book: null };
const subscribers = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function publish(next: MountConfig): void {
  config = next;
  for (const listener of subscribers) listener();
}

// --- 觀測 -------------------------------------------------------------------

let loadCount = 0;
let childClickCount = 0;
let location: LocationSnapshot | null = null;

/**
 * 出現過的 `Renderer` 實例。**大小就是「掛了幾次書」。**
 *
 * 用集合而不是計數器，是因為 StrictMode 會把每一個 effect 掛、卸、再掛一次——計數
 * 器在那裡會跳成 2，而那一次「重掛」用的仍然是同一個 `Renderer`。要區分的兩件事
 * （「effect 跑了兩次」與「真的又 attach 了一次」）只有 identity 分得開。
 *
 * 這也是為什麼不能用 `load` 事件的次數來當這個指標：換一次讀者設定會重建文件，
 * 於是 `load` 也會多一次——但那不是重掛書。
 */
const seenRenderers = new Set<unknown>();

function toSettings(patch: SettingsPatch | undefined): Partial<ReaderSettings> | undefined {
  return patch as Partial<ReaderSettings> | undefined;
}

function App(): ReactNode {
  const current = useSyncExternalStore(subscribe, () => config);
  const book = current.book === null ? undefined : BOOKS[current.book];

  return (
    <Reader.Root
      book={book}
      settings={toSettings(current.settings)}
      onLoad={() => {
        loadCount += 1;
      }}
      onRelocate={(event) => {
        location = {
          sectionIndex: event.sectionIndex,
          sectionPath: event.sectionPath,
          page: event.page,
          pageCount: event.pageCount,
          atStart: event.atStart,
          atEnd: event.atEnd,
        };
      }}
    >
      <Observer />
      {current.keyboard === true ? <Paging /> : null}
      <Reader.Viewport className="viewport" data-testid="viewport" />
      <Toolbar asChild={current.asChild === true} />
      <Reader.Progress data-testid="progress" />
    </Reader.Root>
  );
}

/** 記下每一個出現過的 `Renderer`。它自己不畫任何東西。 */
function Observer(): ReactNode {
  const { renderer } = Reader.useReader();

  useEffect(() => {
    if (renderer !== undefined) seenRenderers.add(renderer);
  }, [renderer]);

  return null;
}

/**
 * 政策掛在一個什麼都不畫的元件上。
 *
 * 這正是 `paging.ts` 檔頭建議的形狀——寫在這裡是因為它同時是這個套件的使用範例，
 * 而範例最好就是測試實際跑的那一份。
 */
function Paging(): ReactNode {
  Reader.useKeyboardPaging();
  return null;
}

function Toolbar({ asChild }: { readonly asChild: boolean }): ReactNode {
  if (!asChild) {
    return (
      <>
        <Reader.PreviousTrigger data-testid="previous">前一頁</Reader.PreviousTrigger>
        <Reader.NextTrigger data-testid="next">下一頁</Reader.NextTrigger>
      </>
    );
  }

  // child 帶著自己的 `onClick` 與自己的 `className`——兩者都該與零件那一份共存，
  // 而不是被覆蓋掉（`slot.tsx` 的合併規則）。
  return (
    <>
      <Reader.PreviousTrigger asChild>
        <button type="button" data-testid="previous" className="mine">
          前一頁
        </button>
      </Reader.PreviousTrigger>
      <Reader.NextTrigger asChild>
        <button
          type="button"
          data-testid="next"
          className="mine"
          onClick={() => {
            childClickCount += 1;
          }}
        >
          下一頁
        </button>
      </Reader.NextTrigger>
    </>
  );
}

// --- 掛載 -------------------------------------------------------------------

let root: ReactRoot | undefined;

/**
 * 等 React 把這一次更新刷出去，以及 `Renderer` 掛書那一段非同步的工作跑完。
 *
 * 兩個 `requestAnimationFrame` 加一次 microtask flush 不是一個保證——真正的等待
 * 由 spec 那一側的 `expect(locator).toHaveAttribute(…)` 輪詢負責。這裡只是讓
 * `mount()` 回來的時候通常已經有東西可看，省下每支 spec 開頭一行 wait。
 */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function viewportElement(): HTMLElement | null {
  return document.querySelector("[data-frond-part='viewport']");
}

const harness: ReactHarness = {
  async mount(next: MountConfig): Promise<void> {
    if (root !== undefined) {
      root.unmount();
      root = undefined;
    }

    loadCount = 0;
    childClickCount = 0;
    location = null;
    seenRenderers.clear();
    config = next;

    const container = document.getElementById("root");
    if (container === null) throw new Error("外殼頁面沒有 #root");

    root = createRoot(container);
    root.render(next.strict === true ? <StrictMode><App /></StrictMode> : <App />);

    await settled();
  },

  async update(next: MountConfig): Promise<void> {
    publish(next);
    await settled();
  },

  async unmount(): Promise<void> {
    root?.unmount();
    root = undefined;
    await settled();
  },

  iframeCount(): number {
    return viewportElement()?.querySelectorAll("iframe").length ?? 0;
  },

  loadCount(): number {
    return loadCount;
  },

  attachCount(): number {
    return seenRenderers.size;
  },

  location(): LocationSnapshot | null {
    return location;
  },

  computed(selector: string, property: string): string {
    const frame = viewportElement()?.querySelector("iframe");
    if (!(frame instanceof HTMLIFrameElement)) return "";

    const document = frame.contentDocument;
    const view = document?.defaultView;
    if (document == null || view === null || view === undefined) return "";

    const element = document.querySelector(selector);
    if (element === null) return "";

    return view.getComputedStyle(element).getPropertyValue(property);
  },

  childClickCount(): number {
    return childClickCount;
  },
};

Object.defineProperty(window, "reactHarness", { value: harness });
