import { expect, test, type Page } from "@playwright/test";
import { screenshotGlyph } from "../support/glyph.js";
import { decodePixels } from "../support/ink.js";

/**
 * 區域字面（TC / SC / JP）有沒有依 lang 選對。
 *
 * Noto CJK 是一個家族涵蓋繁中、簡中、日文，但那不等於一個字面：OTC 內裝著
 * Noto Serif CJK TC / SC / JP 等多個字面。取到哪一個取決於字面選擇，而字面
 * 選擇由 lang 加上 fontconfig 的語言比對決定——那正是三家瀏覽器可能各做各的
 * 地方。沒綁好的話，三家可能對同一本日文書選到不同字面，跨瀏覽器差分就會亮起
 * 與 frond 程式碼無關的紅燈。
 *
 * ===========================================================================
 * 用什麼字來測，比怎麼斷言更關鍵。實測結論，不要憑直覺改。
 * ===========================================================================
 *
 * 漢字**不能**用來鑑別字面。「骨」「直」這類漢字統一的代表字，其區域字形是由
 * 文件的 lang 經 OpenType 的 locl 特性驅動的——同一個字面在 lang=ja 與
 * lang=zh-TW 下會給出不同字形，而不同字面在同一個 lang 下給出相同字形。
 * 拿漢字去問「解析到哪個字面」，得到的答案永遠是「看不出來」，於是測試會在
 * 綁定完全失效的環境下照樣變綠。
 *
 * 標點**可以**。句點在 JP 與 TC 字面裡的位置不同（日文置於右上或左下、中文
 * 置中），而且該差異在同一個 lang 下依然存在——那才是字面本身的差異。
 *
 * 下面第一組測試把這兩條性質本身釘住，因為它們是第二組測試能夠成立的前提。
 */

/** 漢字統一的代表字。用於證明漢字由 lang 驅動，不用於鑑別字面。 */
const HAN_UNIFICATION_EXEMPLAR = "骨";

/** 句點。位置隨字面而異，是這裡唯一有鑑別力的字。 */
const IDEOGRAPHIC_FULL_STOP = "。";

const JAPANESE_FACE = '"Noto Serif CJK JP"';
const TRADITIONAL_CHINESE_FACE = '"Noto Serif CJK TC"';

test.describe("字形選擇的兩條路徑", () => {
  test("漢字的區域字形由 lang 驅動，不是由字面驅動", async ({ page }) => {
    const sameLangDifferentFace = [
      await render(page, HAN_UNIFICATION_EXEMPLAR, {
        lang: "ja",
        fontFamily: JAPANESE_FACE,
      }),
      await render(page, HAN_UNIFICATION_EXEMPLAR, {
        lang: "ja",
        fontFamily: TRADITIONAL_CHINESE_FACE,
      }),
    ] as const;

    const sameFaceDifferentLang = [
      await render(page, HAN_UNIFICATION_EXEMPLAR, {
        lang: "ja",
        fontFamily: JAPANESE_FACE,
      }),
      await render(page, HAN_UNIFICATION_EXEMPLAR, {
        lang: "zh-TW",
        fontFamily: JAPANESE_FACE,
      }),
    ] as const;

    expect(sameLangDifferentFace[0].equals(sameLangDifferentFace[1])).toBe(true);
    expect(sameFaceDifferentLang[0].equals(sameFaceDifferentLang[1])).toBe(
      false,
    );
  });

  test("標點的位置由字面驅動，是唯一有鑑別力的字", async ({ page }) => {
    // 這條是下面整組測試的前提。如果句點在兩個字面下也長得一樣，就沒有任何
    // 字能鑑別字面，下面的斷言即使全綠也沒有意義。
    const japanese = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });
    const traditionalChinese = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: TRADITIONAL_CHINESE_FACE,
    });

    expect(japanese.equals(traditionalChinese)).toBe(false);
  });
});

test.describe("指名字面", () => {
  test("同一組輸入的渲染是決定性的", async ({ page }) => {
    // 上面幾條靠逐像素相等／不等立論，所以必須先證明相同輸入會給出相同輸出，
    // 否則那些相等與不等都可能只是渲染本身不穩定。
    const first = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });
    const second = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });

    expect(first.equals(second)).toBe(true);
  });
});

/**
 * generic family（serif / sans-serif）依 lang 解析到對應區域字面——**延後**。
 *
 * 實測三家瀏覽器並不一致：Firefox 完全遵守 fontconfig 的綁定；WebKit 一律
 * 選 TC，連 lang=ja 也是；Chromium 的 CJK 落點不等於任何 Noto CJK 字面。
 *
 * 這是環境的真實分歧而不是測試寫壞了，範圍也超出「把測試環境架起來」這張票
 * ——所以 #3 收斂成只要求指名字面時的一致性，這一段獨立追蹤於 #4。
 *
 * 這裡刻意用 fixme 而不是刪掉：刪掉會讓這件事從測試報告裡消失，而它是後續
 * 真書測試會撞上的東西——真書大多用 generic family 宣告。修好之後把 fixme
 * 拿掉即可。
 */
test.describe("generic family 依 lang 的解析（見 #4）", () => {
  test.fixme(true, "三家瀏覽器解析不一致，見 #4");

  test("lang=ja 的 serif 解析到 JP 字面", async ({ page }) => {
    const viaGenericFamily = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
    });
    const japanese = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });

    expect(viaGenericFamily.equals(japanese)).toBe(true);
  });

  test("lang=zh-TW 的 serif 解析到 TC 字面", async ({ page }) => {
    const viaGenericFamily = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "zh-TW",
    });
    const traditionalChinese = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "zh-TW",
      fontFamily: TRADITIONAL_CHINESE_FACE,
    });

    expect(viaGenericFamily.equals(traditionalChinese)).toBe(true);
  });
});

async function render(
  page: Page,
  char: string,
  options: { lang: string; fontFamily?: string },
): Promise<Buffer> {
  return decodePixels(await screenshotGlyph(page, { char, ...options }));
}
