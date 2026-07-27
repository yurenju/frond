import { expect, test } from "@playwright/test";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * 把書渲染進容器，並認出它的書寫方向。
 *
 * 書寫方向這一格是這支 spec 的重心，理由是它**只有在瀏覽器裡才問得出答案**：判準
 * 是 CSSOM，而字串比對會漏掉書實際的寫法（ADR-0010、`docs/browser-quirks.md`）。
 * 三個宣告寫法各有一份 fixture，彼此是對照組。
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("渲染進容器", () => {
  test("掛上去就排得出第一頁", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");

    expect(location.sectionIndex).toBe(0);
    expect(location.page).toBe(0);
    expect(location.pageCount).toBeGreaterThanOrEqual(1);
    expect(location.atStart).toBe(true);
    expect(location.cfi).toMatch(/^epubcfi\(/);
  });

  test("內容真的在畫面上——iframe 有一份載好的文件", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const html = await page.evaluate(() => window.frond.html());

    expect(html).toContain("朝の光");
    // frond 自己那兩份樣式表都掛上去了。
    expect(html).toContain('id="frond-layout"');
    expect(html).toContain('id="frond-reader"');
  });

  test("書內的腳本不會進到文件裡（ADR-0006）", async ({ page }) => {
    // `manifest-href-parent-prefix` 帶了一份 js 資源。書內腳本一律拿掉——
    // iframe 為了讓 parent 收得到事件必須帶 allow-scripts，所以擋得住書內程式碼
    // 的只有這一步。
    await mountFixture(page, "manifest-href-parent-prefix");

    const html = await page.evaluate(() => window.frond.html());

    expect(html).not.toContain("<script");
  });
});

test.describe("書寫方向的偵測", () => {
  test("宣告在 <html> 上：直排", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("宣告在 <body> 上：一樣認得出直排", async ({ page }) => {
    // InDesign 產的書就是這個形狀。只讀 documentElement 的 library 會判成橫排
    // ——spine 為此自己寫了一支 detectVerticalBook（ADR-0002）。
    const location = await mountFixture(page, "writing-mode-on-body");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("只有 -epub- 與 -webkit- 前綴：三家都排成直排", async ({ page }) => {
    // **這一條在 Firefox 上才有牙齒。** 那本書沒有無前綴的宣告，而 Firefox 兩種
    // 前綴都不認，所以沒有正規化的話它會整本排成橫排（《入境大廳》的形狀，
    // docs/browser-quirks.md）。另外兩家本來就認得前綴，所以它們在這一條上證明
    // 的是「補一條無前綴的宣告沒有把它們弄壞」。
    const location = await mountFixture(page, "writing-mode-prefixed-only");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("沒有直排宣告的書是橫排", async ({ page }) => {
    const location = await mountFixture(page, "huge-single-section");
    expect(location.writingMode).toBe("horizontal-tb");
  });

  test("直排的頁沿 y 推進，橫排沿 x", async ({ page }) => {
    // 讀者字級放大到 64px，這一節才排得出不只一頁——`vertical-japanese` 每節只有
    // 三個段落，書自己的字級下一屏就裝得下，而那時候 `next()` 會直接跨到下一節，
    // 量到的捲動位置就永遠是 0。#7 的 foliate spike 用的也是這個字級。
    const vertical = await mountFixture(page, "vertical-japanese", {
      settings: { fontSize: 64 },
    });
    expect(vertical.pageCount).toBeGreaterThan(1);

    await page.evaluate(() => window.frond.next());
    const verticalOffset = await page.evaluate(() => window.frond.scrollOffset());

    const horizontal = await mountFixture(page, "huge-single-section");
    expect(horizontal.pageCount).toBeGreaterThan(1);

    await page.evaluate(() => window.frond.next());
    const horizontalOffset = await page.evaluate(() => window.frond.scrollOffset());

    // `scrollOffset()` 依書寫方向讀 scrollTop 或 scrollLeft，所以兩邊都大於零
    // 就表示各自的那一軸真的動了。這同時證明了 `overflow: hidden` 的分欄容器
    // 仍然捲得動——讀者捲不動它，frond 捲得動。
    expect(verticalOffset).toBeGreaterThan(0);
    expect(horizontalOffset).toBeGreaterThan(0);
  });
});

test.describe("分頁的幾何", () => {
  test("直排的欄寬等於一個 viewer 高", async ({ page }) => {
    // spine 那句「直排欄寬必須剛好等於一個 viewer 高」的機器版本。容器 800×600、
    // 邊界 24，所以 iframe 是 752×552，直排的欄寬取高度 552。
    await mountFixture(page, "vertical-japanese", { settings: { margin: 24 } });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toBe("552px");
  });

  test("橫排的欄寬等於一個 viewer 寬", async ({ page }) => {
    await mountFixture(page, "huge-single-section", {
      settings: { margin: 24, columns: 1 },
    });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toBe("752px");
  });

  test("直排時注入直排標點的字符設定，橫排時不注入", async ({ page }) => {
    // WebKit 在直排下不自動套用 `vert`，日文句點留在左下（browser-quirks.md
    // 第一條）。三家共用同一條規則不分支——實測強制之後 Chromium 與 Firefox 的
    // 結果逐位元組不變。
    //
    // `vertical-writing.spec.ts` 那條驗的是「這套字型有直排字符且畫得出來」，
    // 因為它自己注入了 `"vert" 1`。這一條驗的是**Renderer 本身有做這件事**。
    await mountFixture(page, "vertical-japanese");
    expect(
      await page.evaluate(() => window.frond.computed("html", "font-feature-settings")),
    ).toContain("vert");

    await mountFixture(page, "huge-single-section");
    expect(
      await page.evaluate(() => window.frond.computed("html", "font-feature-settings")),
    ).not.toContain("vert");
  });

  test("欄寬是整數像素", async ({ page }) => {
    // 分數欄寬會讓頁距累積誤差，翻幾十頁之後一屏疊出兩個半頁。
    await mountFixture(page, "vertical-japanese", { settings: { margin: 25 } });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toMatch(/^\d+px$/);
  });
});
