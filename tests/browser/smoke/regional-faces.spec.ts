import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  GLYPH_BOX_PX,
  glyphMarkup,
  screenshotGlyph,
  screenshotGlyphInIsolation,
  withFreshPage,
} from "../support/glyph.js";
import { decodePixels } from "../support/ink.js";
import { documentWith } from "../support/document.js";

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
 * ===========================================================================
 * generic family（serif / sans-serif）依 lang 的解析——三家不一致，不可解（#4）
 * ===========================================================================
 *
 * 這一段原本標著 fixme，等的是「把三家喬成一致」。查完之後結論是**做不到**，
 * 所以改成把每一家的實際行為釘住：分歧本身是這個測試環境的性質，它變了要有人
 * 知道。理由與量測記在 docs/browser-quirks.md，結論記在 issue #4。
 *
 * 三家各自繞開 fontconfig 的 generic 綁定的方式不同：
 *
 *   Firefox   拿書的 lang 去問 fontconfig 要 serif／sans-serif → 綁定完全生效。
 *   WebKit    有問 fontconfig 要 generic family，但不帶書的 lang；缺的 lang 由
 *             fontconfig 用**行程的 locale** 補上，於是整個行程共用一個區域
 *             字面。容器的 locale 是 C.UTF-8，落在通則的 TC。
 *   Chromium  根本沒問 fontconfig 要 generic family——那是 Blink 自己的字型
 *             偏好，解析到沒有 CJK 的 Liberation Serif／Sans；CJK 字元接著走
 *             逐字元 fallback 另外補一套字型上來。
 *
 * frond 不介入（ADR-0003：書醜不是介入理由，三家不一致也不是）。跨瀏覽器自我
 * 差分要成立就得由**讀者設定**指名字面——指名之後三家一致，那組測試在上面。
 */

/**
 * generic family + 該 lang 實際落到的字面。改這張表要附上量測。
 *
 * Chromium 那幾格是**字型堆疊**而不是單一字面，因為它的 generic family 是
 * 兩段式的：主字型（Liberation Serif／Sans）決定行高與基線、但沒有 CJK 字符，
 * CJK 再由逐字元 fallback 補上。拿單一 Noto CJK 字面去比會不相等——字符一樣，
 * 但基線由主字型決定，位置差了幾個像素。堆疊寫法把這兩段都重現出來。
 *
 * 這也是為什麼 Chromium 的 sans-serif 仍然算不一致：區域字面挑對了，但主字型
 * 是拉丁字型，行高與另外兩家不同，斷行跟著不同。
 */
const LANDS_ON: Record<string, Record<string, Record<string, string>>> = {
  serif: {
    chromium: {
      ja: '"Liberation Serif", "Noto Sans CJK JP"',
      "zh-TW": '"Liberation Serif", "Noto Sans CJK TC"',
    },
    firefox: { ja: JAPANESE_FACE, "zh-TW": TRADITIONAL_CHINESE_FACE },
    webkit: {
      ja: TRADITIONAL_CHINESE_FACE,
      "zh-TW": TRADITIONAL_CHINESE_FACE,
    },
  },
  "sans-serif": {
    chromium: {
      ja: '"Liberation Sans", "Noto Sans CJK JP"',
      "zh-TW": '"Liberation Sans", "Noto Sans CJK TC"',
    },
    firefox: {
      ja: '"Noto Sans CJK JP"',
      "zh-TW": '"Noto Sans CJK TC"',
    },
    webkit: {
      ja: '"Noto Sans CJK TC"',
      "zh-TW": '"Noto Sans CJK TC"',
    },
  },
};

/** 書宣告 generic family 時，依 lang 應該得到的字面。只有 Firefox 給得出來。 */
const CORRECT_FACE: Record<string, Record<string, string>> = {
  serif: { ja: JAPANESE_FACE, "zh-TW": TRADITIONAL_CHINESE_FACE },
  "sans-serif": { ja: '"Noto Sans CJK JP"', "zh-TW": '"Noto Sans CJK TC"' },
};

test.describe("generic family 依 lang 的解析（#4：不可解，釘住現況）", () => {
  for (const generic of ["serif", "sans-serif"]) {
    for (const lang of ["ja", "zh-TW"]) {
      test(`${generic} + lang=${lang} 落在這一家的實測字面上`, async ({
        browser,
      }, testInfo) => {
        const landsOnFace = lookUp(
          lookUp(
            lookUp(LANDS_ON, generic, "LANDS_ON"),
            testInfo.project.name,
            "LANDS_ON",
          ),
          lang,
          "LANDS_ON",
        );
        const correctFace = lookUp(
          lookUp(CORRECT_FACE, generic, "CORRECT_FACE"),
          lang,
          "CORRECT_FACE",
        );

        const viaGenericFamily = await renderInIsolation(
          browser,
          lang,
          generic,
        );
        const landsOn = await renderInIsolation(browser, lang, landsOnFace);
        const correct = await renderInIsolation(browser, lang, correctFace);

        expect(viaGenericFamily.equals(landsOn)).toBe(true);
        // 同一條斷言順便回答「這個落點對不對」，兩者不會各自漂走。
        expect(viaGenericFamily.equals(correct)).toBe(
          landsOnFace === correctFace,
        );
      });
    }
  }

  /**
   * Chromium 的字元 fallback 是**一頁一次**的，而 frond 一個 Section 一個
   * iframe、整本書共用一頁——所以這一條不是實驗室裡的細節，是 frond 的實際
   * 配置會撞上的東西：同一頁裡先渲染的 Section 決定了後面所有 Section 的
   * 區域字面。
   *
   * 三家的簽名剛好互不相同，一條測試分得出來是誰壞了：
   *
   *   Chromium  同頁內兩個 iframe 拿到同一個字面（第一個贏），換順序結果跟著換
   *   Firefox   各自依 lang，順序無關
   *   WebKit    兩個都一樣但順序無關——它從頭到尾就沒看 lang
   */
  const FALLBACK_SIGNATURE: Record<
    string,
    { sameWithinPage: boolean; stableAcrossOrders: boolean }
  > = {
    chromium: { sameWithinPage: true, stableAcrossOrders: false },
    firefox: { sameWithinPage: false, stableAcrossOrders: true },
    webkit: { sameWithinPage: true, stableAcrossOrders: true },
  };

  test("同一頁的兩個 iframe：Chromium 由第一個決定，Firefox 各自依 lang，WebKit 都不看 lang", async ({
    browser,
  }, testInfo) => {
    const signature = lookUp(
      FALLBACK_SIGNATURE,
      testInfo.project.name,
      "FALLBACK_SIGNATURE",
    );

    const [japanese, chineseAfterJapanese] = await renderTwoFrames(browser, [
      "ja",
      "zh-TW",
    ]);
    const [chinese, japaneseAfterChinese] = await renderTwoFrames(browser, [
      "zh-TW",
      "ja",
    ]);

    expect(japanese.equals(chineseAfterJapanese)).toBe(
      signature.sameWithinPage,
    );
    expect(chinese.equals(japaneseAfterChinese)).toBe(signature.sameWithinPage);
    // 同一份 lang=zh-TW 的內容，只因為排在日文內容後面就換了字面。
    expect(chineseAfterJapanese.equals(chinese)).toBe(
      signature.stableAcrossOrders,
    );
  });
});

/** 表裡沒有這一格時，錯誤訊息要指得出是哪張表少了什麼。 */
function lookUp<T>(table: Record<string, T>, key: string, name: string): T {
  const value = table[key];
  if (value === undefined) {
    throw new Error(`${name} 沒有 "${key}" 這一格——新增 browser project 或 lang 時要一起補上實測結果`);
  }
  return value;
}

async function render(
  page: Page,
  char: string,
  options: { lang: string; fontFamily?: string },
): Promise<Buffer> {
  return decodePixels(await screenshotGlyph(page, { char, ...options }));
}

/** 一次一個全新的 page——理由見 screenshotGlyphInIsolation。 */
async function renderInIsolation(
  browser: Browser,
  lang: string,
  fontFamily?: string,
): Promise<Buffer> {
  return decodePixels(
    await screenshotGlyphInIsolation(browser, {
      char: IDEOGRAPHIC_FULL_STOP,
      lang,
      ...(fontFamily === undefined ? {} : { fontFamily }),
    }),
  );
}

/**
 * 一頁兩個 iframe，各自宣告 serif 與自己的 lang，依宣告順序回傳兩者的像素。
 *
 * 兩個 iframe 是**先後**掛上去的，不是一次寫進 setContent。這條測試的主題就是
 * 「誰先渲染」，而同時掛兩個的話兩份 srcdoc 誰先跑完並不保證——那會讓斷言的
 * 紅綠取決於一個沒有人控制的競速。
 */
async function renderTwoFrames(
  browser: Browser,
  langs: readonly [string, string],
): Promise<[Buffer, Buffer]> {
  return withFreshPage(browser, async (page) => {
    await page.setContent(documentWith(""));

    const rendered: Buffer[] = [];
    for (const lang of langs) {
      rendered.push(await appendFrameAndScreenshot(page, lang));
    }
    const [first, second] = rendered;
    return [first!, second!];
  });
}

async function appendFrameAndScreenshot(
  page: Page,
  lang: string,
): Promise<Buffer> {
  // srcdoc 用單引號包，內層的 lang="…" 才不會把屬性截斷。這裡一律走 generic
  // family，所以標記裡沒有帶引號的字型名。
  const frame = `<iframe id="frame-${lang}" width="${GLYPH_BOX_PX + 20}" height="${
    GLYPH_BOX_PX + 20
  }" style="border:0" srcdoc='${glyphMarkup({
    char: IDEOGRAPHIC_FULL_STOP,
    lang,
  })}'></iframe>`;

  await page.evaluate((html) => {
    document.body.insertAdjacentHTML("beforeend", html);
  }, frame);

  const glyph = page.frameLocator(`#frame-${lang}`).locator("#glyph");
  await glyph.waitFor();
  await page
    .frameLocator(`#frame-${lang}`)
    .locator("body")
    .evaluate(() => document.fonts.ready);

  return decodePixels(await glyph.screenshot());
}
