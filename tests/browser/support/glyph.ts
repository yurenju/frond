import type { Browser, Page } from "@playwright/test";
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
  /**
   * OpenType 特性。用於顯式要求直排字符——WebKit 不會自動套用，
   * 見 docs/browser-quirks.md。
   */
  readonly fontFeatureSettings?: string;
}

/**
 * 一個字面方框的標記。獨立出來是為了讓 iframe 內的版本（見
 * regional-faces.spec.ts 的 Chromium fallback 快取那組）與這裡走同一份樣式。
 *
 * 樣式走 <style> 而不是 style="..." 屬性。字型名稱帶引號是常態
 * （font-family: "Noto Serif CJK JP"），塞進雙引號的 HTML 屬性裡會把屬性
 * 截斷，於是整條宣告連同 width / height / writing-mode 一起消失，只剩 lang
 * 還活著——而畫面仍然畫得出字，測試仍然跑得完，只是量到的是別的東西。
 */
export function glyphMarkup(request: GlyphRequest): string {
  const {
    char,
    lang,
    fontFamily = "serif",
    writingMode = "horizontal-tb",
    fontFeatureSettings = "normal",
  } = request;

  return `
      <style>
        #glyph {
          writing-mode: ${writingMode};
          font-family: ${fontFamily};
          font-feature-settings: ${fontFeatureSettings};
          font-size: ${GLYPH_BOX_PX}px;
          line-height: 1;
          width: ${GLYPH_BOX_PX}px;
          height: ${GLYPH_BOX_PX}px;
          overflow: hidden;
        }
      </style>
      <div id="glyph" lang="${lang}">${char}</div>
    `;
}

export async function screenshotGlyph(
  page: Page,
  request: GlyphRequest,
): Promise<Buffer> {
  await page.setContent(documentWith(glyphMarkup(request)));
  await page.evaluate(() => document.fonts.ready);

  return page.locator("#glyph").screenshot();
}

/**
 * 同上，但每次量測都給一個全新的 page。
 *
 * **量 generic family 時必須用這個。** Chromium 的字元 fallback 結果是一頁一次
 * 的：某個碼位第一次需要 fallback 時解析出來的字面，會被那一頁記住，後續文件
 * 即使換了 lang 也拿到同一個字面（見 docs/browser-quirks.md）。共用一個 page
 * 連續量好幾個 lang，量到的會是第一個 lang 的答案，而且看起來很像「Chromium
 * 不理會 lang」——那是量測方法造成的，不是瀏覽器的行為。
 *
 * 指名字面時不需要這個：字面自己涵蓋該碼位，根本不會走 fallback。
 */
export async function screenshotGlyphInIsolation(
  browser: Browser,
  request: GlyphRequest,
): Promise<Buffer> {
  return withFreshPage(browser, (page) => screenshotGlyph(page, request));
}

/** 一個用完就丟的 context 與 page。同上，理由是那份 fallback 快取。 */
export async function withFreshPage<T>(
  browser: Browser,
  use: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();
  try {
    return await use(await context.newPage());
  } finally {
    await context.close();
  }
}
