import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Page } from "@playwright/test";

/**
 * 把 frond-react 餵進瀏覽器。
 *
 * ## 為什麼這一份需要打包器，而 `tests/browser/support/harness.ts` 不需要
 *
 * 那一份靠的是 frond 的模組圖裡一個 bare specifier 都沒有——把型別剝掉就能直接
 * 送進 `<script type="module">`。**frond-react 沒有那個性質，而且不該有**：它必然
 * import `react`，那正是它與 frond 的分界線。
 *
 * 而 `react` 在 npm 上出的是 CommonJS，瀏覽器載不動。所以這裡多一個 esbuild：它
 * 是 devDependency，不進任何一個套件的出貨面（`scripts/finish-build.ts` 每次 build
 * 都在確認這件事）。
 *
 * 這不是把「不需要打包器」那個性質弄丟了——那個性質從來只屬於 frond，而它仍然由
 * 展示站每一次部署在驗證（`scripts/build-site.sh`）。
 *
 * ## 打包的是原始碼，不是 dist
 *
 * `alias` 把兩個套件名指回各自的 `src/`。理由與那一份 harness 相同：測試要對著
 * 原始碼跑，才不必為了看一個改動而先 build 一次。
 *
 * 代價是這裡證明不了「出貨的那包東西裝起來能用」。那件事在 `release.yml`——它在
 * repo 外面建一個假的消費端，裝 tarball，然後同時驗執行期與型別。
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ENTRY = resolve(REPO_ROOT, "tests/browser/react/support/page/react-page.tsx");

export const ORIGIN = "http://frond-react.test";

/**
 * 打包一次就好。
 *
 * Playwright 的每一個 worker 是一個獨立的行程，但同一個 worker 裡的每一支 spec
 * 共用這個模組——不快取的話，三家瀏覽器乘上每支 spec 各打包一次，而 esbuild 的
 * 啟動成本會變成整套測試裡最貴的一格。
 */
let bundling: Promise<string> | undefined;

function bundle(): Promise<string> {
  bundling ??= build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    // React 的開發版會在 StrictMode 底下多印東西，也會多跑一次 effect——而「多跑
    // 一次 effect 不該留下第二個 iframe」正是這批測試要抓的事。所以用開發版，不是
    // 生產版。
    define: { "process.env.NODE_ENV": '"development"' },
    alias: {
      "@yurenju/frond-react": resolve(REPO_ROOT, "packages/frond-react/src/index.ts"),
      "@yurenju/frond/renderer": resolve(REPO_ROOT, "packages/frond/src/renderer/index.ts"),
    },
  }).then((result) => {
    const output = result.outputFiles[0];
    if (output === undefined) throw new Error("esbuild 沒有產出任何檔案");
    return output.text;
  });

  return bundling;
}

/** 這個 page 認得 `http://frond-react.test`，並開啟外殼頁面。 */
export async function openReactHarness(page: Page): Promise<void> {
  const script = await bundle();

  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/") {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: shell() });
      return;
    }

    if (url.pathname === "/react-page.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: script });
      return;
    }

    if (url.pathname === "/styles.css") {
      await route.fulfill({
        contentType: "text/css; charset=utf-8",
        path: resolve(REPO_ROOT, "packages/frond-react/styles.css"),
      });
      return;
    }

    await route.fulfill({ status: 404, body: "" });
  });

  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.reactHarness !== undefined);
}

/**
 * 外殼頁面。
 *
 * **刻意不載入 `styles.css`。** 這批測試的預設狀態是「消費端什麼都沒 import」，
 * 而那正是「預設樣式完全可選」這句話要被驗證的地方——要驗它有沒有生效的那支 spec
 * 自己叫 `loadDefaultStyles()`。
 */
function shell(): string {
  return `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8">
    <title>frond-react harness</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      /*
       * 外殼給 viewport 一個尺寸。frond-react 自己一格都不設（見 viewport.tsx 的
       * 檔頭），所以沒有這一段的話高度是 0，每一支 spec 都會量到空的畫面——而症狀
       * 看起來會像 frond 壞了。
       */
      .viewport { width: 800px; height: 600px; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/react-page.js"></script>
  </body>
</html>`;
}

/** 把預設樣式掛上去。驗「可選」的那支 spec 用它。 */
export async function loadDefaultStyles(page: Page): Promise<void> {
  await page.addStyleTag({ url: `${ORIGIN}/styles.css` });
}

/** 掛哪一本合成的書。`null` 是「還沒選書」。 */
export type BookChoice = "one" | "two" | null;

export interface MountConfig {
  readonly book: BookChoice;
  readonly settings?: SettingsPatch | undefined;
  /** 用 `<StrictMode>` 包起來。 */
  readonly strict?: boolean | undefined;
  /** 掛 `useKeyboardPaging()`。 */
  readonly keyboard?: boolean | undefined;
  /** 翻頁按鈕改用 `asChild`，child 是一個帶著自己 `onClick` 的 `<button>`。 */
  readonly asChild?: boolean | undefined;
}

/** `ReaderSettings` 的可序列化版本——`page.evaluate` 只送得過去純資料。 */
export interface SettingsPatch {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly margin?: number;
  readonly columns?: 1 | 2 | "auto";
}

export interface LocationSnapshot {
  readonly sectionIndex: number;
  readonly sectionPath: string;
  readonly page: number;
  readonly pageCount: number;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

/** 頁面那一側的操作面。實作在 `tests/browser/react/support/page/react-page.tsx`。 */
export interface ReactHarness {
  /** 建一棵新的 React 樹。已經有一棵的話先卸載。 */
  mount(config: MountConfig): Promise<void>;
  /** 換 props，**不重建 React 樹**——受控那條路要靠它才測得到。 */
  update(config: MountConfig): Promise<void>;
  /** 卸載整棵樹。`Root` 的 cleanup 該在這裡把 `Renderer` 收掉。 */
  unmount(): Promise<void>;
  /** viewport 底下有幾個 iframe。StrictMode 的重複掛載會讓它變成 2。 */
  iframeCount(): number;
  /** 收到過幾次 `load`。**換一次讀者設定也會多一次**——它重建文件。 */
  loadCount(): number;
  /**
   * 出現過幾個不同的 `Renderer` 實例，也就是掛了幾次書。
   *
   * 「換設定不該重掛」與「換書該重掛」兩件事都靠它量。用 identity 而不是計數，
   * 理由見 `react-page.tsx` 裡 `seenRenderers` 的註解。
   */
  attachCount(): number;
  location(): LocationSnapshot | null;
  /** 目前這一節的 iframe 裡，某個選擇器的 computed style。 */
  computed(selector: string, property: string): string;
  /** 消費端自己那個 `onClick`（`asChild` 用）被呼叫過幾次。 */
  childClickCount(): number;
}

declare global {
  interface Window {
    readonly reactHarness: ReactHarness;
  }
}

export async function mount(page: Page, config: MountConfig): Promise<void> {
  await page.evaluate((value) => window.reactHarness.mount(value as MountConfig), config);
}

export async function update(page: Page, config: MountConfig): Promise<void> {
  await page.evaluate((value) => window.reactHarness.update(value as MountConfig), config);
}
