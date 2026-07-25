import { expect, test, type Page } from "@playwright/test";
import { documentWith } from "../support/document.js";
import { screenshotGlyph } from "../support/glyph.js";
import { analyseInk, type InkAnalysis } from "../support/ink.js";

/**
 * 這個環境到底排不排得出直排。
 *
 * 冒煙測試的用意不是測 frond——frond 還沒有任何程式碼——而是證明「三家瀏覽器
 * 都能在這個容器裡正確排出直排」這個前提成立。前提不成立的話，後面所有的
 * 不變量與跨瀏覽器差分都建立在流沙上。
 */

/** 日文的句點。在直排下應由 vert / vrt2 換成位於右上的字符。 */
const IDEOGRAPHIC_FULL_STOP = "。";

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
    const horizontal = await inkOfFullStop(page, "horizontal-tb");
    const vertical = await inkOfFullStop(page, "vertical-rl");

    // 橫排：句點在字面方框的左下。
    expect(horizontal.x).toBeLessThan(0.5);
    expect(horizontal.y).toBeGreaterThan(0.5);

    // 直排：vert / vrt2 把句點搬到右上。
    //
    // 這條斷言是整個測試環境最重要的一條。它擋掉的是最惡劣的失敗模式：裝了
    // 一套沒有直排字符的 CJK 字型，於是 computed style 回報 vertical-rl、
    // 內容也確實被切成 N 頁且無重複遺失、幾何不變量全數通過，但畫面上的直排
    // 標點是錯的。那種缺陷原本只有抽樣的視覺判讀那層抓得到——等於漏網。
    //
    // 沒有直排字符時，句點會留在左下，下面兩條就會紅。
    expect(vertical.x).toBeGreaterThan(0.5);
    expect(vertical.y).toBeLessThan(0.5);
  });
});

/**
 * 句點的墨水重心，正規化到字面方框內的 [0, 1]。
 *
 * 沒有墨水時直接丟——那代表字根本沒渲染出來，而不是「重心在某處」。讓它成為
 * 錯誤而不是一個假的座標，可以避免下游的象限斷言把空白誤判成通過。
 */
async function inkOfFullStop(
  page: Page,
  writingMode: "horizontal-tb" | "vertical-rl",
): Promise<{ x: number; y: number }> {
  const ink: InkAnalysis = analyseInk(
    await screenshotGlyph(page, {
      char: IDEOGRAPHIC_FULL_STOP,
      lang: "ja",
      writingMode,
    }),
  );

  if (!ink.centroid) {
    throw new Error(
      `${writingMode} 下的字面方框沒有任何墨水——句點沒有渲染出來`,
    );
  }

  return ink.centroid;
}
