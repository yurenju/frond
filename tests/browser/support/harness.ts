import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { EpubBook } from "../../../src/epub/index.ts";
import type { AilmentName } from "../../../src/test-fixtures/index.ts";

/**
 * 把 frond 餵進瀏覽器。
 *
 * ## 為什麼沒有打包器
 *
 * `Renderer` 的模組圖裡**一個 bare specifier 都沒有**——它只相依 `src/renderer/`
 * 自己與 `src/epub/` 裡兩支零相依的純函式模組（`cfi.ts`、`resource-path.ts`）。
 * 解壓與 XML 解析那兩個套件在 `EpubBook` 那一層，而 `Renderer` 收的是
 * `RenderableBook` 這個窄介面而不是 `EpubBook`（`src/renderer/book.ts`）。
 *
 * 於是「把原始碼送進頁面」剩下一件事：把 TypeScript 的型別剝掉。Node 內建的
 * `stripTypeScriptTypes` 就做這個，所以這裡不需要引入打包器，也就不需要為了測試
 * 而多一份與正式建置不同的模組解析設定——那種設定漂掉的時候，症狀是「測試綠但
 * 消費端 build 不起來」。
 *
 * 剝型別而不是轉譯，代價是原始碼裡不能出現不可抹除的語法（`enum`、`namespace`、
 * 建構子參數屬性）。那個限制與 `tsconfig.json` 已經為了讓 `node` 直接跑 `src/`
 * 而接受的限制是同一條，所以沒有新增任何約束。
 *
 * ## 為什麼是攔截而不是起一個伺服器
 *
 * 容器以 `--network=none` 執行（`scripts/test-in-container.sh`）。Playwright 的
 * 路由攔截在請求離開瀏覽器之前就把它接走，所以連 loopback 都不需要——少一個會在
 * 別人的環境變成無法重現的紅燈的東西。
 */

export const ORIGIN = "http://frond.test";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 頁面裡那個容器元素的 id。 */
export const VIEWPORT_ID = "viewport";

/**
 * 讓這個 page 認得 `http://frond.test`，並開啟外殼頁面。
 *
 * 呼叫之後 `window.frond` 就緒（`tests/browser/support/page/frond-page.ts`）。
 */
export async function openHarness(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/") {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: shell(),
      });
      return;
    }

    if (url.pathname.startsWith("/book/")) {
      await fulfilBookRequest(route, url);
      return;
    }

    const source = await readSourceFile(url.pathname);
    if (source === undefined) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }

    await route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: source,
    });
  });

  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.frond !== undefined);
}

/**
 * 把一份合成 fixture 掛上去，回傳掛好之後的位置。
 *
 * 書在 **Node 這一側**用 `EpubBook` 開，逐檔餵進頁面。這樣測到的是實際的書經過
 * 實際的解析層之後的內容——不是一份為了方便而手寫的 XHTML——而瀏覽器那邊仍然不
 * 需要解壓與 XML 解析。
 */
export async function mountFixture(
  page: Page,
  fixture: AilmentName,
  options: MountOptions = {},
): Promise<Snapshot> {
  return page.evaluate(
    ([name, mountOptions]) => window.frond.mount(name as string, mountOptions as MountOptions),
    [fixture, options] as const,
  );
}

/** 掛書時可以先給一組讀者設定。 */
export interface MountOptions {
  readonly settings?: SettingsPatch;
  /** 容器尺寸。省略時用外殼頁面的預設值。 */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** 第一節要渲染哪裡。對應 `RendererOptions.start`。 */
  readonly start?:
    | { readonly cfi: string }
    | { readonly sectionIndex: number; readonly fragment?: string };
}

/** `ReaderSettings` 的可序列化版本——`page.evaluate` 只送得過去純資料。 */
export interface SettingsPatch {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly margin?: number | { readonly block: number; readonly inline: number };
  readonly columns?: 1 | 2 | "auto";
  readonly theme?: { readonly foreground: string; readonly background: string };
}

/**
 * 一次量測。
 *
 * `fraction` 用 `null` 而不是 `undefined`：跨過 `page.evaluate` 的邊界時
 * `undefined` 的欄位會整個消失，於是「還沒建好索引」與「這個欄位不存在」變成同
 * 一件事。
 */
export interface Snapshot {
  readonly writingMode: "horizontal-tb" | "vertical-rl";
  readonly sectionIndex: number;
  readonly sectionPath: string;
  readonly page: number;
  readonly pageCount: number;
  readonly cfi: string;
  readonly fraction: number | null;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

/** 頁面那一側的操作面。實作在 `tests/browser/support/page/frond-page.ts`。 */
export interface FrondHarness {
  mount(fixture: string, options: MountOptions): Promise<Snapshot>;
  /**
   * 用手寫的 XHTML 掛一本 `MemoryBook`，不經過任何 committed fixture。
   *
   * 給的是「這份內容會不會被正確處理」這類問題——例如帶著腳本的書。那種內容
   * 不該變成一份 committed fixture：ADR-0007 的紀律是一個檔一個病症，而
   * 「書裡有 script」不是一個排版病症，它是一個安全性質，做成檔案只會讓每一支
   * 掃過 fixture 目錄的測試都多處理一個特例。
   *
   * 這也正是 ADR-0002 要求 frond 自己提供 in-memory 實作的用途。
   */
  mountInline(sections: readonly string[], options: MountOptions): Promise<Snapshot>;
  next(): Promise<Snapshot>;
  previous(): Promise<Snapshot>;
  goToSection(index: number): Promise<Snapshot>;
  goTo(path: string, fragment?: string): Promise<Snapshot>;
  goToCfi(cfi: string): Promise<Snapshot>;
  goToFraction(fraction: number): Promise<Snapshot>;
  applySettings(patch: SettingsPatch): Promise<Snapshot>;
  resize(width: number, height: number): Promise<Snapshot>;
  /**
   * 連按 N 次「下一頁」，**不等前一次落地**就發下一次。
   *
   * 模擬快速滑動：消費端不會等 `next()` 的 promise。這是「按 N 次前進 N 頁」那條
   * 不變量唯一測得到的方式——逐次 await 的話佇列永遠只有一個人，測不到任何東西。
   */
  rapidNext(times: number): Promise<Snapshot>;
  /** 連續發 N 次 `applySettings`，不等前一次落地——模擬拖滑桿。 */
  rapidApplySettings(patches: readonly SettingsPatch[]): Promise<Snapshot>;
  /** 一個全書進度落在哪一節。索引還沒建好時是 `null`。 */
  locate(fraction: number): SectionAtSnapshot | null;
  /** iframe 元素在容器裡的位置與尺寸——驗邊界用。 */
  frameBox(): Rect;
  snapshot(): Snapshot;
  /** 等整書索引建好，回傳全書字元數。 */
  waitForIndex(): Promise<number>;
  /** 某個 CFI 指到的位置往後 `length` 個字元。位置走不到時是 `null`。 */
  textAt(cfi: string, length: number): string | null;
  /** 某個 CFI 在容器座標系裡的矩形。 */
  rectsFor(cfi: string): readonly Rect[];
  /** 容器目前的尺寸——判斷一個矩形在不在畫面上時要用它。 */
  containerSize(): { readonly width: number; readonly height: number };
  /** 目前這一節的 iframe 裡，某個選擇器的 computed style。 */
  computed(selector: string, property: string): string;
  /** 目前這一節的 iframe 文件的 outerHTML——查改寫結果用。 */
  html(): string;
  /** 這一節目前這一頁上，畫得出來的第一個字元的文件座標。 */
  scrollOffset(): number;
  /** 收到過的事件名稱與內容，依順序。 */
  events(): readonly EventRecord[];
  /** 在 iframe 裡選取一段文字，供選字事件測試用。 */
  selectText(selector: string): void;
  /** 點一個連結，供 linkactivate 測試用。 */
  clickLink(selector: string): void;
  destroy(): void;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** `Renderer.locate()` 的可序列化版本。 */
export interface SectionAtSnapshot {
  readonly sectionIndex: number;
  readonly sectionPath: string;
  readonly charactersIntoSection: number;
}

export interface EventRecord {
  readonly name: string;
  readonly payload: unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var frond: FrondHarness;

  interface Window {
    readonly frond: FrondHarness;
  }
}

/** 外殼頁面。容器的尺寸與 `playwright.config.ts` 的 viewport 一致。 */
function shell(): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <title>frond harness</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
      #${VIEWPORT_ID} { width: 800px; height: 600px; position: relative; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="${VIEWPORT_ID}"></div>
    <script type="module" src="/tests/browser/support/page/frond-page.ts"></script>
  </body>
</html>`;
}

/**
 * 讀一支原始碼並剝掉型別。
 *
 * 只放行 `src/` 與 `tests/` 底下的 `.ts`。限制範圍不是安全考量（這是本機的測試
 * 執行器），是為了讓「頁面載得到什麼」這件事有一個明確的邊界——路徑打錯時得到
 * 404 而不是一份意料之外的檔案。
 */
async function readSourceFile(pathname: string): Promise<string | undefined> {
  if (!pathname.endsWith(".ts")) return undefined;

  const absolute = resolve(REPO_ROOT, `.${pathname}`);
  const inside = relative(REPO_ROOT, absolute);
  if (inside.startsWith("..") || !ALLOWED_ROOTS.has(inside.split(sep)[0] ?? "")) {
    return undefined;
  }

  try {
    return stripTypeScriptTypes(await readFile(absolute, "utf8"), { mode: "strip" });
  } catch {
    return undefined;
  }
}

const ALLOWED_ROOTS = new Set(["src", "tests"]);

const FIXTURE_DIRECTORY = join(REPO_ROOT, "tests", "fixtures");

/** 開過的書留著，同一支 spec 裡換設定重掛時不必重開一次。 */
const openedBooks = new Map<string, Promise<EpubBook>>();

function bookFor(name: string): Promise<EpubBook> {
  const existing = openedBooks.get(name);
  if (existing !== undefined) return existing;

  const opening = readFile(join(FIXTURE_DIRECTORY, `${name}.epub`)).then((bytes) =>
    EpubBook.open(bytes),
  );
  openedBooks.set(name, opening);
  return opening;
}

async function fulfilBookRequest(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
  url: URL,
): Promise<void> {
  // `/book/<name>/manifest.json` 或 `/book/<name>/bytes?path=…`
  const [, , name, kind] = url.pathname.split("/");
  if (name === undefined || kind === undefined) {
    await route.fulfill({ status: 404, body: "" });
    return;
  }

  const book = await bookFor(name);

  if (kind === "manifest.json") {
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        readingOrder: book.readingOrder.map((section) => ({
          path: section.path,
          mediaType: section.mediaType,
          linear: section.linear,
        })),
        resources: book.resources
          .filter((resource) => resource.location.kind === "in-container")
          .map((resource) => ({
            path: resource.location.kind === "in-container" ? resource.location.path : "",
            mediaType: resource.mediaType,
          })),
      }),
    });
    return;
  }

  const path = url.searchParams.get("path");
  if (path === null) {
    await route.fulfill({ status: 400, body: "" });
    return;
  }

  try {
    await route.fulfill({
      contentType: "application/octet-stream",
      body: Buffer.from(book.bytes(path)),
    });
  } catch {
    await route.fulfill({ status: 404, body: "" });
  }
}
