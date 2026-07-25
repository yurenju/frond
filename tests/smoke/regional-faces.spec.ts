import { expect, test, type Page } from "@playwright/test";
import { documentWith } from "../support/document.js";
import { decodePixels } from "../support/ink.js";

/**
 * 區域字面（TC / SC / JP）有沒有依 lang 選對。
 *
 * Noto CJK 是一個家族涵蓋繁中、簡中、日文，但那不等於一個字面。因為漢字統一，
 * 共用碼位在各區域有不同字形，OTC 內實際裝著 Noto Serif CJK TC / SC / JP 等
 * 多個字面。取到哪一個取決於字面選擇，而字面選擇通常由 lang 加上 fontconfig
 * 的語言比對決定——那正是三家瀏覽器可能各做各的地方。
 *
 * 如果沒綁好，三家可能對同一本日文書選到不同字面，跨瀏覽器差分就會亮起與
 * frond 程式碼無關的紅燈，而紅燈的原因藏在字型層極難查。
 */

const GLYPH_BOX_PX = 200;

/**
 * 漢字統一的代表字：「骨」在日文與繁中的字形不同（上半部方框的開口方向）。
 *
 * 如果這條斷言在某個 Noto CJK 版本下失敗（兩者渲染相同），那不必然是綁定壞了
 * ——也可能是這個字在該版本的兩個字面裡剛好一致。屆時換一個代表字（「直」、
 * 「令」、「兌」都是常見的例子）並在此記下換的原因與版本。
 */
const HAN_UNIFICATION_EXEMPLAR = "骨";

test.describe("區域字面的選用", () => {
  test("同一個碼位在 lang=ja 與 lang=zh-TW 下解析到不同的字面", async ({
    page,
  }) => {
    const japanese = await renderExemplar(page, "ja");
    const traditionalChinese = await renderExemplar(page, "zh-TW");

    expect(japanese.equals(traditionalChinese)).toBe(false);
  });

  test("同一個 lang 下的渲染是決定性的", async ({ page }) => {
    // 上一條靠「兩張圖不同」立論，所以必須先證明「相同輸入會給出相同輸出」，
    // 否則那個不同可能只是渲染本身不穩定。
    const first = await renderExemplar(page, "ja");
    const second = await renderExemplar(page, "ja");

    expect(first.equals(second)).toBe(true);
  });
});

async function renderExemplar(page: Page, lang: string): Promise<Buffer> {
  await page.setContent(
    documentWith(`
      <div id="glyph" lang="${lang}" style="
        font-family: serif;
        font-size: ${GLYPH_BOX_PX}px;
        line-height: 1;
        width: ${GLYPH_BOX_PX}px;
        height: ${GLYPH_BOX_PX}px;
        overflow: hidden;
      ">${HAN_UNIFICATION_EXEMPLAR}</div>
    `),
  );
  await page.evaluate(() => document.fonts.ready);

  return decodePixels(await page.locator("#glyph").screenshot());
}
