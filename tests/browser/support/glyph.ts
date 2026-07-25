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

  await page.setContent(
    documentWith(`
      <div id="glyph" lang="${lang}" style="
        writing-mode: ${writingMode};
        font-family: ${fontFamily};
        font-size: ${GLYPH_BOX_PX}px;
        line-height: 1;
        width: ${GLYPH_BOX_PX}px;
        height: ${GLYPH_BOX_PX}px;
        overflow: hidden;
      ">${char}</div>
    `),
  );
  await page.evaluate(() => document.fonts.ready);

  return page.locator("#glyph").screenshot();
}
