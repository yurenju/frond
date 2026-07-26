import { expect, test, type Page } from "@playwright/test";
import { documentWith } from "../support/document.js";

/**
 * 書用**哪一種寫法**宣告直排，三家認不認。
 *
 * 這一組與 `vertical-writing.spec.ts` 的分工：那邊問「這個環境排不排得出直排」
 * （環境性質），這邊問「書的宣告寫成這樣，瀏覽器收不收」（瀏覽器行為）。後者
 * 是 quirk，登記在 `docs/browser-quirks.md`。
 *
 * 觸發點是一本真書。ADR-0007 的觸發點之一《入境大廳》（Adobe InDesign 17.0.1
 * 產、EPUB 3、繁中直排）在 `<body>` 上宣告的是 `-epub-writing-mode` 與
 * `-webkit-writing-mode`——**無前綴的 `writing-mode` 一次都沒出現**。實測
 * Firefox 兩種前綴都不認，於是那本書在 Firefox 上整本排成橫排。
 *
 * 這一組刻意**釘住分歧而不期待三家一致**，理由同 `regional-faces.spec.ts`：
 * 分歧是瀏覽器的性質，frond 要據此決定介入，所以它變了必須有人知道。
 */

/** 指名字面，理由同 vertical-writing.spec.ts：generic family 的解析三家不一致（#4）。 */
const JAPANESE_FACE = '"Noto Serif CJK JP"';

/** Firefox 不認 `-epub-` 與 `-webkit-` 的 writing-mode 前綴（本檔實測）。 */
const IGNORES_PREFIXED_WRITING_MODE = ["firefox"];

interface Layout {
  /** `<html>` 的 computed `writing-mode`。 */
  readonly html: string;
  /** `<body>` 的 computed `writing-mode`。 */
  readonly body: string;
  /** 幾何上真的排成直排了嗎——字元往下推進而不是往右。 */
  readonly vertical: boolean;
}

test.describe("直排宣告的寫法", () => {
  test("無前綴的 writing-mode：三家都認，html 與 body 兩個位置都認", async ({
    page,
  }) => {
    const onHtml = await layoutOf(page, `html { writing-mode: vertical-rl; }`);
    const onBody = await layoutOf(page, `body { writing-mode: vertical-rl; }`);

    expect(onHtml.vertical).toBe(true);
    expect(onBody.vertical).toBe(true);

    // 宣告在 body 上時，`<html>` 仍然是橫排——這正是「只讀 documentElement 的
    // library 會把 InDesign 的書判成橫排」那個坑（ADR-0003 的介入清單有一格）。
    expect(onHtml.html).toBe("vertical-rl");
    expect(onBody.html).toBe("horizontal-tb");
    expect(onBody.body).toBe("vertical-rl");
  });

  test("-epub- 與 -webkit- 前綴：Firefox 不認，另外兩家認", async ({
    page,
  }, testInfo) => {
    const ignores = IGNORES_PREFIXED_WRITING_MODE.includes(
      testInfo.project.name,
    );

    for (const property of ["-epub-writing-mode", "-webkit-writing-mode"]) {
      const layout = await layoutOf(page, `body { ${property}: vertical-rl; }`);

      // 幾何與 computed style 在這裡會一起翻——宣告被丟掉的話兩者都是橫排。
      // 兩個都斷言是因為它們的失敗模式不同：computed style 說得出「宣告沒被
      // 接受」，幾何說得出「讀者看到的是橫排」，而 frond 需要的是後者。
      expect(layout.vertical, `${property} 的幾何`).toBe(!ignores);
      expect(layout.body, `${property} 的 computed 值`).toBe(
        ignores ? "horizontal-tb" : "vertical-rl",
      );
    }
  });

  test("真書的形狀：兩種前綴都給、無前綴不給，Firefox 上整份是橫排", async ({
    page,
  }, testInfo) => {
    // 《入境大廳》OEBPS 樣式表裡那條宣告的實際形狀。
    const layout = await layoutOf(
      page,
      `body {
         -epub-writing-mode: vertical-rl;
         -webkit-writing-mode: vertical-rl;
       }`,
    );

    const ignores = IGNORES_PREFIXED_WRITING_MODE.includes(
      testInfo.project.name,
    );

    expect(layout.vertical).toBe(!ignores);

    // 這條斷言記錄的是一個**真書在真瀏覽器上排錯**的事實，不是 frond 的 bug。
    // 它的處置見 docs/browser-quirks.md：frond 要把前綴宣告正規化成無前綴，
    // 否則直排是硬需求的專案會在三家裡有一家整本橫排。
    if (ignores) {
      expect(layout.body).toBe("horizontal-tb");
    }
  });

  test("舊語法 tb-rl：三家都認，且正規化成 vertical-rl", async ({ page }) => {
    // `writing-mode: tb-rl` 是 SVG 1.1 / 早期 CSS3 的寫法。本機兩本真書
    //（《我的公寓》《給力》）的樣式表裡仍然有它，與現代語法並存。
    for (const selector of ["html", "body"]) {
      const layout = await layoutOf(
        page,
        `${selector} { writing-mode: tb-rl; }`,
      );

      expect(layout.vertical, `${selector} 上的 tb-rl`).toBe(true);
      // 三家都把它正規化成現代值，所以讀 computed style 的偵測不必認得舊語法。
      expect(layout.body, `${selector} 上的 tb-rl 的 computed 值`).toBe(
        "vertical-rl",
      );
    }
  });

  test("冒號後沒有空白：三家都認", async ({ page }) => {
    // 《入境大廳》寫的是 `-epub-writing-mode:vertical-rl`（無空白）。這一格
    // 三家都正常，登記它是為了說明**偵測不可以用字串比對**：CSSOM 看到的是
    // 正規化後的值，而在原始碼上比對 "writing-mode: vertical-rl" 會漏掉這本。
    const layout = await layoutOf(page, `body { writing-mode:vertical-rl; }`);

    expect(layout.vertical).toBe(true);
    expect(layout.body).toBe("vertical-rl");
  });
});

/**
 * 把一段 CSS 套上去，回報 computed 的書寫方向與**幾何上**的實際排向。
 *
 * 幾何用相鄰兩個字元的 range 量（同 vertical-writing.spec.ts）：直排時第二個字
 * 在第一個字下方、水平位置相同。只讀 computed style 是不夠的——這一組要回答的
 * 是「讀者看到的是直排還是橫排」。
 */
async function layoutOf(page: Page, css: string): Promise<Layout> {
  await page.setContent(
    documentWith(`
      <style>
        #text {
          font-family: ${JAPANESE_FACE};
          font-size: 32px;
          line-height: 1;
          width: 400px;
          height: 400px;
        }
        ${css}
      </style>
      <div id="text" lang="ja">あい</div>
    `),
  );
  await page.evaluate(() => document.fonts.ready);

  return page.evaluate(() => {
    const textNode = document.getElementById("text")?.firstChild;
    if (!textNode) throw new Error("找不到測試用的文字節點");

    const rectOf = (index: number) => {
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      return range.getBoundingClientRect();
    };

    const first = rectOf(0);
    const second = rectOf(1);

    return {
      html: getComputedStyle(document.documentElement).writingMode,
      body: getComputedStyle(document.body).writingMode,
      vertical:
        second.top >= first.top + first.height * 0.5 &&
        Math.abs(second.left - first.left) < 1,
    };
  });
}
