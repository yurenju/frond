import { expect, test, type Page } from "@playwright/test";

/**
 * 分頁的地基：multicol 在直排與橫排下，欄沿哪一軸溢出、`column-width` 量的是
 * 哪個方向、捲動座標的正負慣例是什麼。
 *
 * **這支沒有任何 frond 程式碼參與**（`docs/browser-quirks.md` 的〈這個數字是誰
 * 排的〉）：`page.setContent` 餵一份手寫的 HTML／CSS，量到的是瀏覽器本身的行為，
 * 換渲染器仍然成立。它釘住的是 `src/renderer/geometry.ts` 每一條公式所依賴的
 * 前提——那些公式若建立在錯的軸上，症狀是「一屏疊出好幾頁」而不是紅燈。
 *
 * ## 為什麼這一格非量不可
 *
 * 直排的欄軸是這一層最容易憑直覺搞錯的地方，而錯了不會有東西報錯：`column-width`
 * 套在錯的方向上仍然是一個合法的宣告，畫面照樣畫得出來，只是每一頁的內容量不對。
 * spine 踩過的「直排欄寬必須剛好等於一個 viewer 高」講的正是這件事，但那句話只
 * 給了結論沒有給理由，照抄的人不知道換一個 viewport 形狀之後該改哪一個數字。
 *
 * 規格上的推導是：multicol 的欄沿**行內軸**（inline axis）排列並溢出，而
 * `column-width` 量的是單一欄的**行內尺寸**。橫排（`horizontal-tb`）的行內軸是
 * 水平的，所以欄寬是寬度、溢出在水平方向；直排（`vertical-rl`）的行內軸是垂直的
 * （字由上而下），所以**欄寬是高度、溢出在垂直方向**。這支測試把那個推導變成三家
 * 的實測。
 */

/** 容器尺寸。長寬刻意不相等——相等的話兩條軸的數字會分不出誰是誰。 */
const PANE_WIDTH = 400;
const PANE_HEIGHT = 300;

/** 欄距。取 0 讓「總長 = 欄數 × 欄寬」這條算式沒有餘數要解釋。 */
const COLUMN_GAP = 0;

type WritingMode = "horizontal-tb" | "vertical-rl";

interface PaneGeometry {
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  /** 把捲動位置推到負無限大再讀回來——負值慣例下讀得到負數。 */
  readonly minScrollLeft: number;
  readonly minScrollTop: number;
  /** 推到正無限大再讀回來，也就是捲到底。 */
  readonly maxScrollLeft: number;
  readonly maxScrollTop: number;
}

test.describe("multicol 的欄軸與捲動慣例", () => {
  test("橫排：欄寬是寬度，欄沿水平溢出", async ({ page }) => {
    const geometry = await measurePane(page, "horizontal-tb");

    // 行內軸是水平的：溢出在 x，y 不溢出。
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
    expect(geometry.scrollHeight).toBe(geometry.clientHeight);

    // 欄寬取容器寬度，所以總長是寬度的整數倍——這就是「一屏一頁」。
    expect(geometry.scrollWidth % PANE_WIDTH).toBe(0);
  });

  test("直排：欄寬是高度，欄沿垂直溢出", async ({ page }) => {
    const geometry = await measurePane(page, "vertical-rl");

    // 直排的行內軸是垂直的（字由上而下），所以溢出換到 y。
    //
    // 這一條是整層的地基。它若翻過來，`geometry.ts` 每一條把 viewport 高度
    // 當成直排欄寬的公式都是錯的，而錯的症狀是一屏疊出好幾頁——不是紅燈。
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.scrollWidth).toBe(geometry.clientWidth);

    expect(geometry.scrollHeight % PANE_HEIGHT).toBe(0);
  });

  test.describe("捲動座標的正負慣例", () => {
    // 分頁沿行內軸推進，而這兩種書寫方向的行內軸都是「正向」的（橫排由左而右、
    // 直排由上而下），所以捲動座標從 0 起算、往正數走。
    //
    // 量它是因為**負值慣例確實存在**：`direction: rtl` 的行內軸由右而左，
    // CSSOM View 規定那種情況的 scrollLeft 由負值表示。frond v1 的兩種書寫
    // 方向都不落在那一格，但 `geometry.ts` 仍然在執行期探測一次而不是寫死——
    // 這兩條測試釘住的正是「探測到的答案應該是 0 起算」。

    test("橫排的分頁軸由 0 起算", async ({ page }) => {
      const geometry = await measurePane(page, "horizontal-tb");

      expect(geometry.minScrollLeft).toBe(0);
      expect(geometry.maxScrollLeft).toBe(
        geometry.scrollWidth - geometry.clientWidth,
      );
    });

    test("直排的分頁軸由 0 起算", async ({ page }) => {
      const geometry = await measurePane(page, "vertical-rl");

      expect(geometry.minScrollTop).toBe(0);
      expect(geometry.maxScrollTop).toBe(
        geometry.scrollHeight - geometry.clientHeight,
      );
    });
  });

  test("直排的欄寬換一個 viewport 形狀就跟著換，跟寬度無關", async ({ page }) => {
    // 「欄寬等於 viewer 高」不是一個常數，是一條與容器高度連動的公式。把高度
    // 換掉、寬度不動，總長必須跟著換——若它跟著寬度走，上面那兩條在正方形容器
    // 上會一起變綠而這一條會紅。
    const tall = await measurePane(page, "vertical-rl", { height: 600 });

    expect(tall.scrollHeight % 600).toBe(0);
    expect(tall.scrollWidth).toBe(tall.clientWidth);
  });
});

/**
 * 造一個定尺寸的分欄容器，量它的捲動幾何。
 *
 * `column-fill: auto` 是必要的：預設的 `balance` 會把內容平均分到各欄，於是
 * 「一欄等於一頁」不再成立。`overflow: auto` 讓溢出的欄變成可捲動的範圍而不是
 * 畫到容器外面。
 */
async function measurePane(
  page: Page,
  writingMode: WritingMode,
  size: { width?: number; height?: number } = {},
): Promise<PaneGeometry> {
  const width = size.width ?? PANE_WIDTH;
  const height = size.height ?? PANE_HEIGHT;
  // 欄寬取行內軸上的容器尺寸：橫排是寬度，直排是高度。
  const columnWidth = writingMode === "vertical-rl" ? height : width;

  await page.setContent(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <style>
      html, body { margin: 0; padding: 0; }
      #pane {
        writing-mode: ${writingMode};
        width: ${width}px;
        height: ${height}px;
        column-width: ${columnWidth}px;
        column-gap: ${COLUMN_GAP}px;
        column-fill: auto;
        overflow: auto;
        font-family: "Noto Serif CJK JP";
        font-size: 16px;
        line-height: 1.8;
      }
      #pane p { margin: 0 0 1em; }
    </style>
  </head>
  <body><div id="pane">${paragraphs(40)}</div></body>
</html>`);
  await page.evaluate(() => document.fonts.ready);

  return page.evaluate(() => {
    const pane = document.getElementById("pane");
    if (pane === null) throw new Error("找不到分欄容器");

    // 先推到負無限大再推到正無限大。瀏覽器會把值夾到合法範圍，讀回來的就是
    // 兩端——不必知道慣例是什麼就量得出慣例。
    pane.scrollTo({ left: -1_000_000, top: -1_000_000, behavior: "instant" });
    const minScrollLeft = pane.scrollLeft;
    const minScrollTop = pane.scrollTop;

    pane.scrollTo({ left: 1_000_000, top: 1_000_000, behavior: "instant" });
    const maxScrollLeft = pane.scrollLeft;
    const maxScrollTop = pane.scrollTop;

    pane.scrollTo({ left: 0, top: 0, behavior: "instant" });

    return {
      clientWidth: pane.clientWidth,
      clientHeight: pane.clientHeight,
      scrollWidth: pane.scrollWidth,
      scrollHeight: pane.scrollHeight,
      minScrollLeft,
      minScrollTop,
      maxScrollLeft,
      maxScrollTop,
    };
  });
}

/** 足夠溢出好幾欄的內容。文字是合成的（ADR-0007），數量固定不取亂數。 */
function paragraphs(count: number): string {
  const sentence = "窓の外に、静かな朝の光が差しこんでいた。";
  return Array.from({ length: count }, () => `<p>${sentence}</p>`).join("");
}
