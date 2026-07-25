import type { Page } from "@playwright/test";
import { documentWith } from "./document.js";

/**
 * 單一字元的渲染與截圖。
 *
 * 直排字符與區域字面兩組測試都需要「把一個字放進一個字面方框、截圖、看像素」，
 * 差別只在事後怎麼分析。共用一份可以保證兩邊的方框大小、行高、溢出處理一致
 * ——這些值若在兩個檔案裡各自宣告，會無聲地飄開，而飄開之後兩組結論就不再
 * 可比。
 */

/** 字面方框的邊長。取得大，讓抗鋸齒相對於字面尺寸可以忽略。 */
export const GLYPH_BOX_PX = 200;

export interface GlyphRequest {
  readonly char: string;
  /** 文件宣告的語言。區域字面的選用就是由它驅動的。 */
  readonly lang: string;
  /** 預設走 generic family，讓 fontconfig 的綁定決定結果。 */
  readonly fontFamily?: string;
  readonly writingMode?: "horizontal-tb" | "vertical-rl";
}

export async function screenshotGlyph(
  page: Page,
  request: GlyphRequest,
): Promise<Buffer> {
  const {
    char,
    lang,
    fontFamily = "serif",
    writingMode = "horizontal-tb",
  } = request;

  // 樣式走 <style> 而不是 style="..." 屬性。字型名稱帶引號是常態
  // （font-family: "Noto Serif CJK JP"），塞進雙引號的 HTML 屬性裡會把屬性
  // 截斷，於是整條宣告連同 width / height / writing-mode 一起消失，只剩 lang
  // 還活著——而畫面仍然畫得出字，測試仍然跑得完，只是量到的是別的東西。
  await page.setContent(
    documentWith(`
      <style>
        #glyph {
          writing-mode: ${writingMode};
          font-family: ${fontFamily};
          font-size: ${GLYPH_BOX_PX}px;
          line-height: 1;
          width: ${GLYPH_BOX_PX}px;
          height: ${GLYPH_BOX_PX}px;
          overflow: hidden;
        }
      </style>
      <div id="glyph" lang="${lang}">${char}</div>
    `),
  );
  await page.evaluate(() => document.fonts.ready);

  return page.locator("#glyph").screenshot();
}
