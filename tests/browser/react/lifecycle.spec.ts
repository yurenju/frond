import { expect, test } from "@playwright/test";
import { mount, openReactHarness, update } from "./support/harness.ts";

/**
 * `Root` 的生命週期。
 *
 * 這一批是這個套件真正的風險所在。frond-react 加上去的邏輯很少，但它加的那一點
 * 全部落在 React 的生命週期上——而那正是薄包裝最容易出錯的地方：effect 跑兩次、
 * cleanup 沒 destroy、props 換了卻整本書重掛。三種的共同症狀都是「看起來會動」。
 */

test.beforeEach(async ({ page }) => {
  await openReactHarness(page);
});

test("StrictMode 底下只留一個 iframe", async ({ page }) => {
  // `Renderer.attach()` 是非同步的，而 StrictMode 會在它 resolve 之前就把 effect
  // 的 cleanup 跑掉。cleanup 只寫 `renderer?.destroy()` 的話，那一刻 `renderer`
  // 還是 undefined——於是第一次 attach 的成果沒有人收，iframe 留在 DOM 裡。
  //
  // 症狀是兩本書疊在一起，而且只有開了 StrictMode 的人看得到。
  await mount(page, { book: "one", strict: true });

  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");

  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(1);
  expect(await page.evaluate(() => window.reactHarness.attachCount())).toBe(1);
});

test("沒有書的時候停在 idle，給了書才掛", async ({ page }) => {
  await mount(page, { book: null });

  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "idle");
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(0);

  await update(page, { book: "one" });
  await expect(viewport).toHaveAttribute("data-state", "ready");
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(1);
});

test("book 變回 undefined 時把 Renderer 收掉", async ({ page }) => {
  await mount(page, { book: "one" });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  await update(page, { book: null });

  // 容器還在（那是消費端的版面），但書沒了。iframe 留著的話，記憶體與資源的
  // blob URL 一起洩，而畫面上看不出任何異狀——所以這條要量 DOM，不是量狀態。
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "idle");
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(0);
});

test("整棵樹卸載時把 iframe 一起帶走", async ({ page }) => {
  await mount(page, { book: "one" });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  await page.evaluate(() => window.reactHarness.unmount());

  expect(await page.evaluate(() => document.querySelectorAll("iframe").length)).toBe(0);
});

test("換書會重掛，位置回到新書的開頭", async ({ page }) => {
  await mount(page, { book: "one" });
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");

  await page.getByTestId("next").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBeGreaterThan(0);

  await update(page, { book: "two" });
  await expect(viewport).toHaveAttribute("data-state", "ready");

  await expect
    .poll(async () => await page.evaluate(() => window.reactHarness.location()))
    .toMatchObject({ sectionPath: "two-a.xhtml", page: 0 });

  expect(await page.evaluate(() => window.reactHarness.attachCount())).toBe(2);
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(1);
});

test("換讀者設定不重掛，也不把讀者送回第一頁", async ({ page }) => {
  await mount(page, { book: "one", settings: { fontSize: 16 } });
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");

  await page.getByTestId("next").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBeGreaterThan(0);

  await update(page, { book: "one", settings: { fontSize: 28 } });

  await expect
    .poll(async () => await page.evaluate(() => window.reactHarness.computed("p", "font-size")))
    .toBe("28px");

  // 同一個 `Renderer`：換設定走的是 `applySettings()`，不是重新 `attach()`。
  // 重掛的話讀者會被丟回第一頁，而那在調字級滑桿的時候是每一格都發生一次。
  expect(await page.evaluate(() => window.reactHarness.attachCount())).toBe(1);
  expect(
    (await page.evaluate(() => window.reactHarness.location()))?.page,
  ).toBeGreaterThan(0);
});

test("什麼都沒變的 re-render 不會動到底下的 Renderer", async ({ page }) => {
  await mount(page, { book: "one" });
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");

  await page.getByTestId("next").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(1);

  // 這條守的是 `Viewport` 那個 ref callback 的 identity。寫成 inline 箭頭函式的話
  // React 每次 render 都會用 null 呼叫舊的、再用節點呼叫新的——也就是每次 render
  // 都對 `Root` 送一次「viewport 不見了」再送一次「viewport 回來了」。
  //
  // 那一對今天會被 React 的 bail out 吃掉，所以症狀不一定看得見。看得見的那一天，
  // 讀者會發現畫面每隔一下就閃回第一頁。
  for (let round = 0; round < 5; round += 1) {
    await update(page, { book: "one" });
  }

  expect(await page.evaluate(() => window.reactHarness.attachCount())).toBe(1);
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(1);
  expect((await page.evaluate(() => window.reactHarness.location()))?.page).toBe(1);
});

test("settings 傳同樣的值進來不會重新套用", async ({ page }) => {
  await mount(page, { book: "one", settings: { fontSize: 20 } });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  const before = await page.evaluate(() => window.reactHarness.loadCount());

  // 物件字面量每次 render 都是新的 identity。比對若看 identity，這一次會重排一次
  // 版面——而消費端寫 `settings={{ fontSize }}` 是最自然的寫法，也就是說每一次
  // re-render 都會重排。
  await update(page, { book: "one", settings: { fontSize: 20 } });
  await update(page, { book: "one", settings: { fontSize: 20 } });

  expect(await page.evaluate(() => window.reactHarness.loadCount())).toBe(before);
});
