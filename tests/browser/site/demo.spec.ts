import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { buildDemoBook } from "../../../packages/frond/src/test-fixtures/demo-book.ts";

/**
 * 展示頁（`site/`）真的跑得起來。
 *
 * ## 為什麼這是一支常駐測試而不是一次性的證據 spec
 *
 * `site/` 是出貨的一部分——它是 README 指過去的地方，也是「不需要打包器」這個
 * 宣稱唯一的實物證明。而它沒有任何其他東西守著：`npm run typecheck` 看不到
 * `site/app.js`（那是純 JavaScript，刻意的），`npm run build` 只管 `dist/`。
 *
 * 這不是假設性的風險。第一次寫出來的時候，`#workspace { display: flex }` 用 id
 * 選擇器蓋掉了 UA 樣式表給 `[hidden]` 的 `display: none`，於是「開書前先藏起工作
 * 區」整個失效——而 JavaScript 那一側完全正常，`element.hidden = true` 有跑、
 * 沒有報錯。那種壞法只有把頁面真的開起來才看得見。
 *
 * ## 這支測試依賴 `site/frond/` 存在
 *
 * 也就是說它要 `npm run site` 跑過。容器裡由 `Dockerfile` 負責（`COPY . .` 之後
 * 那一行），所以 `npm run test:container` 直接就有。
 *
 * ## 頁面怎麼送進瀏覽器
 *
 * 路由攔截，與 `tests/browser/support/harness.ts` 同一招——容器以 `--network=none`
 * 執行，連 loopback 都沒有。
 *
 * ## README 的截圖
 *
 * `docs/images/` 底下那兩張是這支測試的斷言點上截的，但截圖本身不留在這裡：一支
 * 每次 CI 都寫檔案的測試會讓 `docs/` 隨機髒掉。要重截的話把
 * `page.screenshot({ path: … })` 加回去，走 `npm run evidence`
 * （`docs/agents/pull-requests.md`），然後把圖搬到 `docs/images/`。
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SITE = join(REPO_ROOT, "site");
const ORIGIN = "http://frond.test";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

test.use({ viewport: { width: 1180, height: 780 } });

/** 把 `site/` 供給這個分頁。路由攔截，理由見檔頭。 */
async function serveSite(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname === "/" ? "/index.html" : url.pathname;

    try {
      const body = await readFile(join(SITE, path));
      await route.fulfill({
        contentType: CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
        body,
      });
    } catch {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });
}

const DEMO_EPUB = {
  name: "demo-zh-tw.epub",
  mimeType: "application/epub+zip",
  get buffer(): Buffer {
    return Buffer.from(buildDemoBook());
  },
};

test("展示頁開得起一本繁中直排書", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });

  await serveSite(page);

  await page.goto(`${ORIGIN}/`);

  // 開書之前：拖曳區在，工作區不在。
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();

  await page.setInputFiles("#file-input", DEMO_EPUB);

  // 開書之後：書名、直排、頁數都要有值。
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#book-title")).toHaveText("渡口");
  await expect(page.locator("#status-writing-mode")).toHaveText("直排");
  await expect(page.locator("#status-page")).toContainText("第 1 /");
  await expect(page.locator("#status-cfi")).toContainText("epubcfi(");

  // 整書索引建好之後 fraction 才有值（user story 25）。
  await expect(page.locator("#status-fraction")).toContainText("%");

  // 翻頁走得動，而且往回翻回得來。
  const first = await page.locator("#status-cfi").textContent();
  await page.locator("#next").click();
  await expect(page.locator("#status-cfi")).not.toHaveText(first ?? "");
  await page.locator("#previous").click();
  await expect(page.locator("#status-cfi")).toHaveText(first ?? "");

  // 檢查分頁：只用 EpubBook 的那一半。
  await page.locator("#tab-inspect").click();
  await expect(page.locator("#panel-inspect")).toBeVisible();
  await expect(page.locator(".facts")).toContainText("EPUB 3");
  await expect(page.locator(".facts")).toContainText("rtl");

  expect(failures).toEqual([]);
});

/**
 * 書框排成書的比例：寬螢幕上是攤開（1.4），窄螢幕上是單頁（0.7）。
 *
 * ## 為什麼這件事需要一支測試
 *
 * 比例是靠 `100cqh` 從外面那一層量出來的（`site/style.css` 的 `.viewer-frame`），
 * 而**容器查詢單位在高度不確定的祖先鏈上會解析成 0**——那時 `#viewer` 塌成只剩
 * 邊框的 2px，書一個字都畫不出來。這條鏈上任何一層把 `height` 改回 `min-height`
 * 就會踩到，而 JavaScript 那一側完全正常：`attach()` 成功、狀態列有值、沒有任何
 * 錯誤。寫這一版的時候就先踩了一次。
 *
 * 所以斷言分兩半：比例對不對，以及書框有沒有真的量到大小。
 */
test("書框在寬螢幕上是攤開的比例，窄螢幕上是單頁", async ({ page }) => {
  await serveSite(page);
  await page.goto(`${ORIGIN}/`);
  await page.setInputFiles("#file-input", DEMO_EPUB);
  await expect(page.locator("#status-cfi")).toContainText("epubcfi(");

  const shapeOfViewer = async () => {
    const box = await page.locator("#viewer").boundingBox();
    if (box === null) throw new Error("#viewer 量不到");
    return box;
  };

  // 1180×780：書框比攤開還寬，於是攤開，且被高度卡住——它填滿可用的高度。
  const spread = await shapeOfViewer();
  expect(spread.width / spread.height).toBeCloseTo(1.4, 1);
  expect(spread.height).toBeGreaterThan(300);

  // 390×844：手機。攤開在這裡會被寬度卡住而只用掉一半的高度，所以改單頁。
  await page.setViewportSize({ width: 390, height: 844 });
  const single = await shapeOfViewer();
  expect(single.width / single.height).toBeCloseTo(0.7, 1);
  expect(single.height).toBeGreaterThan(300);

  // 換了大小之後書要重排——frond 自己盯著容器（`Renderer` 的 ResizeObserver），
  // 頁數是它有沒有重排的證據。
  await expect(page.locator("#status-page")).toContainText("第 1 /");
});
