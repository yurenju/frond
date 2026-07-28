import { expect, test } from "@playwright/test";
import { loadDefaultStyles, mount, openReactHarness } from "./support/harness.ts";

/**
 * 預設樣式的兩個性質。它們一起才構成「完全可選」這句話：
 *
 *   1. **不 import 就完全不存在。** 零件本身一條宣告都不帶。
 *   2. **import 了也蓋得過去。** 整份包在 `:where()` 裡，優先權是 0。
 *
 * 第二點特別值得測。一份「可選」但優先權很高的預設樣式，實際上是一份你得先對付掉
 * 才能開始的東西——而優先權是靠選擇器寫法維持的，改一條規則就可能悄悄破功，CSS
 * 不會為此報任何錯。
 */

test.beforeEach(async ({ page }) => {
  await openReactHarness(page);
});

test("不 import 樣式的話，按鈕維持瀏覽器原生的樣子", async ({ page }) => {
  await mount(page, { book: "one" });

  // 原生 `<button>` 自帶邊框。預設樣式會把它清掉——這裡沒 import，所以它還在。
  const border = await page
    .getByTestId("next")
    .evaluate((element) => getComputedStyle(element).borderTopStyle);

  expect(border).not.toBe("none");
});

test("import 之後按鈕的原生外觀被清掉", async ({ page }) => {
  await loadDefaultStyles(page);
  await mount(page, { book: "one" });

  const styles = await page.getByTestId("next").evaluate((element) => {
    const computed = getComputedStyle(element);
    return { border: computed.borderTopStyle, cursor: computed.cursor };
  });

  expect(styles.border).toBe("none");
  expect(styles.cursor).toBe("pointer");
});

test("消費端一條 class 規則就蓋得過預設樣式", async ({ page }) => {
  await loadDefaultStyles(page);
  await page.addStyleTag({ content: ".viewport { min-height: 123px; }" });
  await mount(page, { book: "one" });

  // 預設樣式對 viewport 設了 `min-height: var(--frond-viewport-min-height)`，而它
  // 包在 `:where()` 裡，優先權 0。消費端最普通的一條 class 規則就該贏——不必
  // `!important`，也不必在意兩份 stylesheet 誰先載入。
  const minHeight = await page
    .getByTestId("viewport")
    .evaluate((element) => getComputedStyle(element).minHeight);

  expect(minHeight).toBe("123px");
});

test("只設 custom property 也能微調，不必重寫規則", async ({ page }) => {
  await loadDefaultStyles(page);
  await page.addStyleTag({ content: ":root { --frond-progress-thickness: 9px; }" });
  await mount(page, { book: "one" });

  const height = await page
    .getByTestId("progress")
    .evaluate((element) => getComputedStyle(element).height);

  expect(height).toBe("9px");
});
