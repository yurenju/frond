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

/**
 * 冒煙測試一律指名字面，不用 generic family。
 *
 * 因為三家瀏覽器對 generic family 的 CJK 解析並不一致（見 #4），用 serif 的話
 * 這裡量到的會是「瀏覽器挑了哪套字型」而不是「這套字型的直排字符對不對」。
 * 指名之後變因只剩一個。
 *
 * 這是測試環境的選擇，不是 frond 的規則——frond 仍然尊重書自己的宣告
 * （ADR-0003）。
 */
const JAPANESE_FACE = '"Noto Serif CJK JP"';

test.describe("直排渲染", () => {
  test("行進軸是縱向：後續字元排在前一個字元下方，而不是右方", async ({
    page,
  }) => {
    await page.setContent(
      documentWith(`
        <style>
          /* 字型名帶引號，所以樣式走 <style> 而不是 style="..." 屬性——
             內層雙引號會把 HTML 屬性截斷，整條宣告連同尺寸一起消失。 */
          #text {
            writing-mode: vertical-rl;
            font-family: ${JAPANESE_FACE};
            font-size: 40px;
            line-height: 1;
            width: 400px;
            height: 400px;
          }
        </style>
        <div id="text" lang="ja">あいうえお</div>
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
      fontFamily: JAPANESE_FACE,
      writingMode,
      // 顯式要求直排字符。Chromium 與 Firefox 在 writing-mode: vertical-rl
      // 下會自動套用 vert，WebKit 不會——實測它把句點留在左下，強制之後才
      // 移到右上（見 docs/browser-quirks.md）。
      //
      // 這裡強制並不會讓斷言失去意義：問的是「這套字型有沒有直排字符、畫得
      // 出來嗎」，那是環境的性質。裝了一套沒有 vert 的字型時，強制也不會有
      // 任何效果，斷言照樣紅。
      //
      // 至於「瀏覽器會不會自動套用」則是瀏覽器的行為而非環境的性質，屬於
      // Renderer 要處理的 quirk，登記在 browser-quirks.md。
      fontFeatureSettings: writingMode === "vertical-rl" ? '"vert" 1' : "normal",
    }),
  );

  if (!ink.centroid) {
    throw new Error(
      `${writingMode} 下的字面方框沒有任何墨水——句點沒有渲染出來`,
    );
  }

  return ink.centroid;
}
