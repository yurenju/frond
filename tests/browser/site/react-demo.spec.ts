import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { buildDemoBook } from "../../../packages/frond/src/test-fixtures/demo-book.ts";

/**
 * 展示站的 React 那一頁（`site/react/`）真的跑得起來。
 *
 * ## 它蓋的東西與 `tests/browser/react/` 不同
 *
 * 那一批對著**原始碼**跑（harness 用 esbuild 的 alias 把套件名指回各自的 `src/`），
 * 所以它們抓不到只在出貨產物上成立的錯：`exports` 的路徑打錯、`files` 漏了東西、
 * emit 出來的 `.js` 少一個副檔名。那幾種在消費端是致命的，而在這個 repo 裡怎麼跑
 * 都是綠的。
 *
 * 這一支相反：它載入的是 `npm run site` 打包出來的 `bundle.js`，而那一次打包走的
 * 是 node_modules 解析，也就是**消費端 `npm install` 之後拿到的那些檔案**
 * （`scripts/bundle-site-react.ts`）。所以它是 frond-react 版的「消費端那條路」。
 *
 * ## 它也守著頁面上那兩個開關
 *
 * 「預設樣式可以完全不用」與「政策要顯式打開」是 frond-react 最容易被當成客套話
 * 的兩個主張，而那一頁把它們做成了開關。開關壞掉的話，那一頁會變成在展示兩句沒有
 * 兌現的話——所以它們在這裡有斷言。
 *
 * ## 這支測試依賴 `site/react/bundle.js` 存在
 *
 * 也就是要 `npm run site` 跑過。容器裡由 `Dockerfile` 負責，所以
 * `npm run test:container` 直接就有。
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SITE = join(REPO_ROOT, "site");
const ORIGIN = "http://frond-site.test";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

test.use({ viewport: { width: 1180, height: 780 } });

/** 把 `site/` 供給這個分頁。路由攔截，理由見 `site/demo.spec.ts` 的檔頭。 */
async function serveSite(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;

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

/** 開書並等到第一頁排好。 */
async function openDemoBook(page: Page): Promise<void> {
  await serveSite(page);
  await page.goto(`${ORIGIN}/react/`);
  await page.getByTestId("file-input").setInputFiles(DEMO_EPUB);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");
}

test("React 展示頁開得起一本繁中直排書", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });

  await serveSite(page);
  await page.goto(`${ORIGIN}/react/`);

  // 開書之前：拖曳區在，reader 不在。
  await expect(page.getByTestId("dropzone")).toBeVisible();
  await expect(page.getByTestId("viewport")).toHaveCount(0);

  await page.getByTestId("file-input").setInputFiles(DEMO_EPUB);

  await expect(page.getByTestId("book-title")).toHaveText("渡口");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-writing-mode", "vertical-rl");
  await expect(page.getByTestId("status-writing-mode")).toHaveText("Vertical");
  await expect(page.getByTestId("status-cfi")).toContainText("epubcfi(");

  // 整書索引建好之後 fraction 才有值（user story 25）。
  await expect(page.getByTestId("status-fraction")).toContainText("Book progress");
  await expect(page.getByTestId("progress")).toHaveAttribute("data-state", "loaded");

  // StrictMode 開著（`app.tsx` 最後那一段），所以這一條同時在守「effect 跑兩次不
  // 會留下第二個 iframe」——而且是對著**出貨產物**守的。
  await expect(page.getByTestId("viewport").locator("iframe")).toHaveCount(1);

  expect(failures).toEqual([]);
});

test("翻頁按鈕走得動，開頭時往回是 disabled", async ({ page }) => {
  await openDemoBook(page);

  const previous = page.getByTestId("previous");
  await expect(previous).toBeDisabled();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-at-start", "");

  const first = await page.getByTestId("status-cfi").textContent();
  await page.getByTestId("next").click();
  await expect(page.getByTestId("status-cfi")).not.toHaveText(first ?? "");

  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(page.getByTestId("status-cfi")).toHaveText(first ?? "");
});

test("字級是受控的 prop：拉了就重排，不會把讀者丟回第一頁", async ({ page }) => {
  await openDemoBook(page);

  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-at-start", "");

  await page.getByTestId("next").click();
  await expect(viewport).not.toHaveAttribute("data-at-start", "");

  await page.getByTestId("font-size").fill("34");

  // 排版真的換過了。
  await expect(page.getByTestId("status-cfi")).toContainText("epubcfi(");

  // 而讀者**還在原來的地方**——換設定走的是 `applySettings()`，不是重新
  // `attach()`。重掛的話讀者會被丟回開頭，而那在拖滑桿時是每一格都發生一次。
  //
  // 斷言用 `data-at-start` 而不是頁碼：頁碼會隨字級整批改變，那正是這個設定在做
  // 的事（CONTEXT.md：頁是版面的產物）。
  await expect(viewport).not.toHaveAttribute("data-at-start", "");
  await expect(viewport.locator("iframe")).toHaveCount(1);
});

test("預設樣式關得掉，關掉之後零件回到瀏覽器原生的樣子", async ({ page }) => {
  await openDemoBook(page);

  const next = page.getByTestId("next");
  const borderOf = () =>
    next.evaluate((element) => getComputedStyle(element).borderTopStyle);

  // 開著：預設樣式把原生按鈕的邊框清掉了。
  await expect(page.getByTestId("toggle-styles")).toBeChecked();
  expect(await borderOf()).toBe("none");

  await page.getByTestId("toggle-styles").uncheck();

  // 關掉：`<link disabled>`，於是那份樣式表整份不生效，邊框回來了。
  //
  // 這一條看起來很小，但它守的是「預設樣式完全可選」這句話——那句話一旦不成立，
  // 頁面上那個開關就是在展示一個沒有兌現的主張。
  expect(await borderOf()).not.toBe("none");

  // 書還在，而且沒有被重掛。樣式與 Renderer 是兩件無關的事。
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("viewport").locator("iframe")).toHaveCount(1);
});

/**
 * 這本 demo 書是直排，所以「往前」的橫向箭頭是 **ArrowLeft** 而不是 ArrowRight。
 *
 * `useKeyboardPaging()` 沒有拿到頁面推進方向時會從書寫方向推：`vertical-rl` 一律
 * 當成 `rtl`（`paging.ts` 的檔頭）。這條測試因此順便釘住了那個推論——寫成
 * ArrowRight 的話它會靜靜地什麼都不做，而那正是這個推論壞掉時的症狀。
 */
const FORWARD_KEY = "ArrowLeft";

/**
 * 位置一律看 CFI，不看頁碼。
 *
 * **頁是版面的產物，不是書的性質**（CONTEXT.md）——同一節在 780 高的視窗裡是兩頁，
 * 在 900 高的裡可能是一頁。斷言寫成「翻到第 3 頁」的測試因此會在改一行 CSS 之後
 * 紅掉，而紅的原因與它要守的東西無關。第一版就是這樣寫的，然後在調整書框高度之後
 * 全紅。
 */
async function cfiOf(page: Page): Promise<string> {
  return (await page.getByTestId("status-cfi").textContent()) ?? "";
}

test("政策關得掉：關掉之後方向鍵不翻頁，按鈕還是能翻", async ({ page }) => {
  await openDemoBook(page);
  const start = await cfiOf(page);

  // 開著：方向鍵翻得動。
  await page.keyboard.press(FORWARD_KEY);
  await expect(page.getByTestId("status-cfi")).not.toHaveText(start);
  const afterKey = await cfiOf(page);

  await page.getByTestId("toggle-paging").uncheck();

  await page.keyboard.press(FORWARD_KEY);
  await page.waitForTimeout(300);

  // 關掉之後鍵盤沒有反應——ADR-0002 那條線在這一頁上是看得到的。
  await expect(page.getByTestId("status-cfi")).toHaveText(afterKey);

  // 但按鈕仍然能翻：按鈕是動作，不是政策。
  await page.getByTestId("next").click();
  await expect(page.getByTestId("status-cfi")).not.toHaveText(afterKey);
});

test("直排書的方向鍵跟著頁面推進方向走", async ({ page }) => {
  await openDemoBook(page);
  const start = await cfiOf(page);

  // 直排 ⇒ rtl ⇒ 往左是下一頁。
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("status-cfi")).not.toHaveText(start);

  // 往右走得回來。
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("status-cfi")).toHaveText(start);

  // `ArrowDown` 在兩種書寫方向下都是「下一頁」——那是所有捲動介面的慣例，讀者的
  // 手指記得的是那個意思，不是排版方向（`paging.ts` 的註解）。
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("status-cfi")).not.toHaveText(start);
});

test("目錄跳得過去", async ({ page }) => {
  await openDemoBook(page);

  const toc = page.getByTestId("toc");
  await expect(toc).toBeEnabled();

  const first = await page.getByTestId("status-cfi").textContent();
  await toc.selectOption({ index: 2 });

  await expect(page.getByTestId("status-cfi")).not.toHaveText(first ?? "");
});
