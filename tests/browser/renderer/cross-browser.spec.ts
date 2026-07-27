import { expect, test } from "@playwright/test";
// 直接取產生 fixture 的那份散文，而不是走 `test-fixtures/index.ts` 的公開面：
// 這裡要的是**產生器的輸入**，那正是獨立 oracle 的來源。公開面給的是產出的
// 位元組，從它反推字元數等於再實作一次渲染端的走訪。
import { PROSE } from "../../../src/test-fixtures/prose.ts";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * 跨瀏覽器自我差分——**只比與分頁無關的量**。
 *
 * ADR-0004 被兩次實測連續收窄過，所以先講清楚這支比什麼、不比什麼：
 *
 * | | 比不比 | 依據 |
 * | --- | --- | --- |
 * | 書寫方向 | **比** | 與版面無關，是書的宣告加 CSSOM 的結果 |
 * | 每一節第一頁的 CFI | **比** | 那是該節的第一個文字節點，與斷頁無關 |
 * | 全書字元數、各節起點的 fraction | **比** | 字元數是書的性質，不是版面的性質 |
 * | 欄寬、行內尺寸 | **比** | 由 viewport 與設定算出來，不是量出來的 |
 * | 頁數、斷頁位置、頁碼 | **不比** | ADR-0004 的 #7 修訂：三家的分欄 fragmentation 本來就不一致 |
 *
 * ## 三家怎麼「互比」
 *
 * Playwright 把三家跑成三個獨立的 project，彼此看不到對方的結果。所以差分寫成
 * **每一家各自對同一組期望值斷言**：任一家偏離就是那一家紅。效果與兩兩互比相同，
 * 而且多一個好處——期望值寫在測試裡，讀 diff 的人看得到那個數字是什麼。
 *
 * 期望值一律**獨立算出來**而不是從某一次執行抄下來的：字元數由 `PROSE` 直接加
 * 總，CFI 由規格的定址規則推導。抄一次執行結果的話，這支測試只能證明「行為沒有
 * 變」，不能證明「行為是對的」。
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("書寫方向：三家必須一致", () => {
  const EXPECTED = [
    { fixture: "vertical-japanese", writingMode: "vertical-rl" },
    { fixture: "writing-mode-on-body", writingMode: "vertical-rl" },
    // **這一格是這支 spec 最有牙齒的一條。** 那本書只寫了 `-epub-` 與
    // `-webkit-` 前綴，而 Firefox 兩種都不認——沒有正規化的話它會排成
    // `horizontal-tb`，而另外兩家是 `vertical-rl`。三家一致本身就是產出。
    { fixture: "writing-mode-prefixed-only", writingMode: "vertical-rl" },
    { fixture: "ppd-rtl-vertical", writingMode: "vertical-rl" },
    { fixture: "huge-single-section", writingMode: "horizontal-tb" },
    { fixture: "nested-toc", writingMode: "horizontal-tb" },
  ] as const;

  for (const { fixture, writingMode } of EXPECTED) {
    test(`${fixture} 排成 ${writingMode}`, async ({ page }) => {
      const location = await mountFixture(page, fixture, {});
      expect(location.writingMode).toBe(writingMode);
    });
  }
});

test.describe("位置：三家必須一致", () => {
  test("每一節第一頁的 CFI 逐字元相同", async ({ page }) => {
    // 期望值由規格的定址規則推導，不是抄執行結果：
    //
    // - `/6` ——`<package>` 的內容模型規定 metadata、manifest、spine，spine 恆為
    //   第三個元素，序號 2 × 3
    // - `/2`、`/4`、`/6` ——第 1、2、3 個 `<itemref>`
    // - `!` 之後從內容文件的根元素數起：`<head>` 是 `/2`，`<body>` 是 `/4`
    // - `<body>` 的第一個元素是 `<h1>`，序號 `/2`
    // - `<h1>` 底下只有一塊文字，序號 `/1`；`:0` 是它的第一個字元
    const expected = [
      "epubcfi(/6/2!/4/2/1:0)",
      "epubcfi(/6/4!/4/2/1:0)",
      "epubcfi(/6/6!/4/2/1:0)",
    ];

    await mountFixture(page, "vertical-japanese", {});

    for (const [index, cfi] of expected.entries()) {
      const location = await page.evaluate(
        (target) => window.frond.goToSection(target as number),
        index,
      );
      expect(location.cfi, `第 ${index} 節`).toBe(cfi);
    }
  });

  test("全書字元數三家相同，而且等於 fixture 的散文長度", async ({ page }) => {
    // 獨立的 oracle：直接從產生 fixture 的那份散文算，不從渲染結果反推。
    const expected = PROSE.reduce(
      (total, prose) =>
        total +
        prose.title.length +
        prose.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0),
      0,
    );

    await mountFixture(page, "vertical-japanese", {});
    const characters = await page.evaluate(() => window.frond.waitForIndex());

    expect(characters).toBe(expected);
  });

  test("各節起點的 fraction 三家相同", async ({ page }) => {
    const lengths = PROSE.map(
      (prose) =>
        prose.title.length +
        prose.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0),
    );
    const total = lengths.reduce((sum, length) => sum + length, 0);

    await mountFixture(page, "vertical-japanese", {});
    await page.evaluate(() => window.frond.waitForIndex());

    let before = 0;
    for (const [index, length] of lengths.entries()) {
      const location = await page.evaluate(
        (target) => window.frond.goToSection(target as number),
        index,
      );

      expect(location.fraction, `第 ${index} 節`).toBeCloseTo(before / total, 10);
      before += length;
    }
  });
});

test.describe("版面參數：三家必須一致", () => {
  test("直排的欄寬與行內尺寸", async ({ page }) => {
    // 這些是**算出來的**而不是量出來的，所以它們可以互比——而頁數是量出來的，
    // 不能。容器 800×600、邊界 24：版面 752×552，直排的行內軸是高度。
    await mountFixture(page, "vertical-japanese", { settings: { margin: 24 } });

    expect(await computed(page, "column-width")).toBe("552px");
    expect(await computed(page, "column-count")).toBe("1");
    expect(await computed(page, "height")).toBe("552px");
    expect(await computed(page, "width")).toBe("752px");
  });

  test("橫排雙欄的欄寬", async ({ page }) => {
    await mountFixture(page, "huge-single-section", {
      settings: { margin: 24, columns: 2 },
    });

    // (752 − 40) / 2 = 356。
    expect(await computed(page, "column-width")).toBe("356px");
    expect(await computed(page, "column-count")).toBe("2");
  });
});

/**
 * 這裡**沒有**任何一條比頁數。
 *
 * ADR-0004 的 #7 修訂實測到：同一本指名 `Noto Serif CJK JP` 的直排 fixture、同一
 * 個 800×600 viewport、讀者字級 64px，Chromium 排 4 頁而 Firefox 與 WebKit 各排
 * 3 頁，三家的總墨水量只差 0.01%——內容沒有遺失也沒有重複，分岔的純粹是斷頁位置。
 *
 * 硬留一條「三家頁數應該相同」的斷言，結果會是一片永遠紅著、沒有人看的差分測試，
 * 而真正的 bug 躲在後面。頁數那一格由 `invariants.spec.ts` 用單一瀏覽器內的自我
 * 一致性守。
 *
 * 下面這條測試把那件事**變成可以觀察的**而不是只寫在註解裡：它記錄各家實際排出
 * 幾頁，永遠通過，但數字會出現在測試輸出裡。
 */
test("直排放大字級之後的頁數（只記錄，不互比）", async ({ page }, testInfo) => {
  const location = await mountFixture(page, "vertical-japanese", {
    settings: { fontSize: 64 },
  });

  testInfo.annotations.push({
    type: "pageCount",
    description: `${testInfo.project.name}：第一節在 64px 下排成 ${location.pageCount} 頁`,
  });

  // 唯一的斷言是「排得出頁來」。頁數本身不比。
  expect(location.pageCount).toBeGreaterThan(0);
});

async function computed(
  page: Parameters<typeof mountFixture>[0],
  property: string,
): Promise<string> {
  return page.evaluate(
    (name) => window.frond.computed("html", name as string),
    property,
  );
}
