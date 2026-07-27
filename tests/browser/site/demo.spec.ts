import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { buildDemoBook } from "../../../src/test-fixtures/demo-book.ts";

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

test("展示頁開得起一本繁中直排書", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });

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

  await page.goto(`${ORIGIN}/`);

  // 開書之前：拖曳區在，工作區不在。
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();

  await page.setInputFiles("#file-input", {
    name: "demo-zh-tw.epub",
    mimeType: "application/epub+zip",
    buffer: Buffer.from(buildDemoBook()),
  });

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
