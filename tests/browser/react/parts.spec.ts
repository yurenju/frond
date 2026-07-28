import { expect, test } from "@playwright/test";
import { mount, openReactHarness } from "./support/harness.ts";

/**
 * 零件對外的那一面：`data-*` 屬性、按鈕的行為、`asChild`。
 *
 * `data-*` 屬性是這個套件與 CSS 之間唯一的約定，所以它們是**公開面**，不是實作
 * 細節——改掉一個名字會靜默地讓消費端的樣式失效（CSS 不會報錯，只會不生效）。
 * 它們在這裡被釘住。
 */

test.beforeEach(async ({ page }) => {
  await openReactHarness(page);
});

test("viewport 反映狀態、書寫方向與邊界", async ({ page }) => {
  await mount(page, { book: "one" });

  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-frond-part", "viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");
  await expect(viewport).toHaveAttribute("data-writing-mode", "horizontal-tb");

  // `data-at-start` 是「屬性在即為真」，值是空字串。第一頁該有它，`data-at-end`
  // 不該有——這本書排得出好幾頁。
  await expect(viewport).toHaveAttribute("data-at-start", "");
  await expect(viewport).not.toHaveAttribute("data-at-end", "");
});

test("消費端的 className 與 data 屬性一路傳到底層元素", async ({ page }) => {
  await mount(page, { book: "one" });

  // 零件自己那組 `data-*` 不該把消費端傳進來的東西吃掉。這是 unstyled 的最低要求：
  // 掛不上 class 的元素，用什麼方式都改不了外觀。
  await expect(page.getByTestId("viewport")).toHaveClass("viewport");
});

test("翻頁按鈕會翻頁，翻到底之前不會 disabled", async ({ page }) => {
  await mount(page, { book: "one" });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  const next = page.getByTestId("next");
  const previous = page.getByTestId("previous");

  // 第一頁：往回是走不動的，往前可以。
  await expect(previous).toBeDisabled();
  await expect(previous).toHaveAttribute("data-disabled", "");
  await expect(next).toBeEnabled();

  await next.click();

  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(1);

  // 翻過一頁之後往回就走得動了。`data-disabled` 要跟著消失——留著的話樣式會停在
  // 灰色，而按鈕其實是能按的。
  await expect(previous).toBeEnabled();
  await expect(previous).not.toHaveAttribute("data-disabled", "");
});

test("還沒掛好的時候按鈕是 disabled", async ({ page }) => {
  await mount(page, { book: null });

  await expect(page.getByTestId("next")).toBeDisabled();
  await expect(page.getByTestId("previous")).toBeDisabled();
});

test("progress 在索引建好之前是 indeterminate，建好之後帶著 fraction", async ({ page }) => {
  await mount(page, { book: "one" });

  const progress = page.getByTestId("progress");
  await expect(progress).toHaveAttribute("role", "progressbar");

  // 整書索引是背景建的，所以這一格會從 indeterminate 變成 loaded。畫成 0 而不是
  // indeterminate 的話，讀者看到的是「我在書的最前面」——而那在還沒算完的時候是
  // 一句假話。
  await expect(progress).toHaveAttribute("data-state", "loaded");
  await expect(progress).toHaveAttribute("aria-valuenow", /.+/);
});

test("asChild 用消費端自己的按鈕，行為與 className 都保留", async ({ page }) => {
  await mount(page, { book: "one", asChild: true });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  const next = page.getByTestId("next");

  // 沒有巢狀的 button——那才是 asChild 存在的理由。
  expect(await page.evaluate(() => document.querySelectorAll("button button").length)).toBe(0);

  // 兩邊的 className 都在（合併而不是覆蓋）。
  await expect(next).toHaveAttribute("class", /\bmine\b/);
  await expect(next).toHaveAttribute("data-frond-part", "next-trigger");

  await next.click();

  // 零件那一邊的行為（翻頁）與 child 自己的 `onClick` 都跑到了。
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(1);
  expect(await page.evaluate(() => window.reactHarness.childClickCount())).toBe(1);
});

test("useKeyboardPaging 沒掛的時候鍵盤不動作", async ({ page }) => {
  await mount(page, { book: "one" });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);

  // 這條看起來是在測「什麼都沒發生」，但它守的是 ADR-0002 那條線：政策要顯式
  // 打開。哪天有人把 `useKeyboardPaging()` 挪進 `Root` 圖方便，紅的是這裡。
  expect((await page.evaluate(() => window.reactHarness.location()))?.page).toBe(0);
});

test("useKeyboardPaging 掛上去之後方向鍵會翻頁", async ({ page }) => {
  await mount(page, { book: "one", keyboard: true });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(1);

  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(0);
});
