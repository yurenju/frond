import { expect, test, type Page } from "@playwright/test";
import { documentWith } from "../support/document.js";
import { analyseInk, type InkAnalysis } from "../support/ink.js";

/**
 * 這個環境到底排不排得出直排。
 *
 * 冒煙測試的用意不是測 frond——frond 還沒有任何程式碼——而是證明「三家瀏覽器
 * 都能在這個容器裡正確排出直排」這個前提成立。前提不成立的話，後面所有的
 * 不變量與跨瀏覽器差分都建立在流沙上。
 */

/** 一個字的方框大小。取得大是為了讓抗鋸齒相對於字面尺寸可以忽略。 */
const GLYPH_BOX_PX = 200;

test.describe("直排渲染", () => {
  test("行進軸是縱向：後續字元排在前一個字元下方，而不是右方", async ({
    page,
  }) => {
    await page.setContent(
      documentWith(`
        <div id="text" lang="ja" style="
          writing-mode: vertical-rl;
          font-family: serif;
          font-size: 40px;
          line-height: 1;
          width: 400px;
          height: 400px;
        ">あいうえお</div>
      `),
    );
    await page.evaluate(() => document.fonts.ready);

    const rects = await page.evaluate(() => {
      const textNode = document.getElementById("text")?.firstChild;
      if (!textNode) throw new Error("找不到測試用的文字節點");

      const rectOf = (index: number) => {
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const { top, left, width, height } = range.getBoundingClientRect();
        return { top, left, width, height };
      };

      return { first: rectOf(0), second: rectOf(1) };
    });

    // 刻意用幾何而不是 computed style。computed style 會老實回報
    // vertical-rl，但畫出來的像素仍可能是橫的——那正是這條斷言要抓的。
    expect(rects.second.top).toBeGreaterThanOrEqual(
      rects.first.top + rects.first.height * 0.5,
    );

    // 兩個字在同一行上，水平位置一致。
    expect(Math.abs(rects.second.left - rects.first.left)).toBeLessThan(1);
  });

  test("標點取到直排字符：句點在直排下位於右上，橫排下位於左下", async ({
    page,
  }) => {
    const horizontal = await inkOfIdeographicFullStop(page, "horizontal-tb");
    const vertical = await inkOfIdeographicFullStop(page, "vertical-rl");

    // 先確認兩邊都真的畫出了東西。空白代表字型缺件或字根本沒渲染。
    expect(horizontal.pixelCount).toBeGreaterThan(0);
    expect(vertical.pixelCount).toBeGreaterThan(0);

    const horizontalCentroid = horizontal.centroid;
    const verticalCentroid = vertical.centroid;
    if (!horizontalCentroid || !verticalCentroid) {
      throw new Error("墨水重心不存在，但像素數大於零——ink 分析有問題");
    }

    // 橫排：句點在字面方框的左下。
    expect(horizontalCentroid.x).toBeLessThan(0.5);
    expect(horizontalCentroid.y).toBeGreaterThan(0.5);

    // 直排：vert / vrt2 把句點搬到右上。
    //
    // 這條斷言是整個測試環境最重要的一條。它擋掉的是最惡劣的失敗模式：裝了
    // 一套沒有直排字符的 CJK 字型，於是 computed style 回報 vertical-rl、
    // 內容也確實被切成 N 頁且無重複遺失、幾何不變量全數通過，但畫面上的直排
    // 標點是錯的。那種缺陷原本只有抽樣的視覺判讀那層抓得到——等於漏網。
    //
    // 沒有直排字符時，句點會留在左下，下面兩條就會紅。
    expect(verticalCentroid.x).toBeGreaterThan(0.5);
    expect(verticalCentroid.y).toBeLessThan(0.5);
  });
});

async function inkOfIdeographicFullStop(
  page: Page,
  writingMode: "horizontal-tb" | "vertical-rl",
): Promise<InkAnalysis> {
  await page.setContent(
    documentWith(`
      <div id="glyph" lang="ja" style="
        writing-mode: ${writingMode};
        font-family: serif;
        font-size: ${GLYPH_BOX_PX}px;
        line-height: 1;
        width: ${GLYPH_BOX_PX}px;
        height: ${GLYPH_BOX_PX}px;
        overflow: hidden;
      ">。</div>
    `),
  );
  await page.evaluate(() => document.fonts.ready);

  return analyseInk(await page.locator("#glyph").screenshot());
}
