import { expect, test, type Page } from "@playwright/test";
import { screenshotGlyph } from "../support/glyph.js";
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
 *
 * 斷言的形狀很重要。「lang=ja 與 lang=zh-TW 渲染不同」是不夠的：任何兩個不同
 * 的字面都能讓它變綠，包括 ja 選到 SC、zh-TW 選到 JP 這種錯得剛好對稱的情況。
 * 更糟的是它不會 falsify——把 fontconfig 的綁定整個拿掉，各家瀏覽器仍會用
 * 自己的語言比對選出不同的字面，測試照樣綠。
 *
 * 所以改成對照具名字面：generic family 加 lang 的渲染結果，必須與「直接指名
 * 該區域字面」的渲染結果逐像素相同。
 */

/**
 * 漢字統一的代表字：「骨」在日文與繁中的字形不同（上半部方框的開口方向）。
 *
 * 如果「具名字面本身就渲染出不同字形」那條在某個 Noto CJK 版本下失敗，不必然
 * 是綁定壞了——也可能是這個字在該版本的兩個字面裡剛好一致。屆時換一個代表字
 * （「直」、「令」、「兌」都是常見的例子）並在此記下換的原因與版本。
 */
const HAN_UNIFICATION_EXEMPLAR = "骨";

const JAPANESE_FACE = '"Noto Serif CJK JP"';
const TRADITIONAL_CHINESE_FACE = '"Noto Serif CJK TC"';

test.describe("區域字面的選用", () => {
  test("具名的 JP 與 TC 字面本身就渲染出不同字形", async ({ page }) => {
    // 這條是下面兩條的前提。如果兩個具名字面渲染相同，代表其中一個根本不存在
    // 而靜默 fallback 到了另一個——那時候「解析到對應字面」即使全綠也沒有
    // 意義。
    const japanese = await renderExemplar(page, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });
    const traditionalChinese = await renderExemplar(page, {
      lang: "zh-TW",
      fontFamily: TRADITIONAL_CHINESE_FACE,
    });

    expect(japanese.equals(traditionalChinese)).toBe(false);
  });

  test("lang=ja 的 serif 解析到 JP 字面", async ({ page }) => {
    const viaGenericFamily = await renderExemplar(page, { lang: "ja" });
    const japanese = await renderExemplar(page, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });
    const traditionalChinese = await renderExemplar(page, {
      lang: "zh-TW",
      fontFamily: TRADITIONAL_CHINESE_FACE,
    });

    expect(viaGenericFamily.equals(japanese)).toBe(true);
    expect(viaGenericFamily.equals(traditionalChinese)).toBe(false);
  });

  test("lang=zh-TW 的 serif 解析到 TC 字面", async ({ page }) => {
    const viaGenericFamily = await renderExemplar(page, { lang: "zh-TW" });
    const traditionalChinese = await renderExemplar(page, {
      lang: "zh-TW",
      fontFamily: TRADITIONAL_CHINESE_FACE,
    });
    const japanese = await renderExemplar(page, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });

    expect(viaGenericFamily.equals(traditionalChinese)).toBe(true);
    expect(viaGenericFamily.equals(japanese)).toBe(false);
  });

  test("同一組輸入的渲染是決定性的", async ({ page }) => {
    // 上面幾條靠逐像素相等／不等立論，所以必須先證明相同輸入會給出相同輸出，
    // 否則那些相等與不等都可能只是渲染本身不穩定。
    const first = await renderExemplar(page, { lang: "ja" });
    const second = await renderExemplar(page, { lang: "ja" });

    expect(first.equals(second)).toBe(true);
  });
});

async function renderExemplar(
  page: Page,
  options: { lang: string; fontFamily?: string },
): Promise<Buffer> {
  return decodePixels(
    await screenshotGlyph(page, {
      char: HAN_UNIFICATION_EXEMPLAR,
      ...options,
    }),
  );
}
