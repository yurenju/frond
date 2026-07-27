import { expect, test } from "@playwright/test";
import { compareCfi, parseCfi, serializeCfi } from "../../../src/epub/cfi.ts";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * 位置：CFI、fraction、以及版面變動之後的回位。
 *
 * 這三件事共用同一個問題——**版面會變，位置不能跟著變**。viewport 換了、字級調了、
 * 欄數改了，頁碼一定不一樣，但讀者正在讀的那段文字必須還在眼前。所以下面幾條斷言
 * 幾乎都長成「量到的文字」而不是「量到的頁碼」。
 */

const LARGE = { fontSize: 64 };

/** 比對回位時取的字數。夠長到能分辨是哪一段，短到不會跨太多節點。 */
const SAMPLE = 12;

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("目前位置的 CFI", () => {
  test("指向這一頁最前面那段文字", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");

    const text = await page.evaluate(
      ([cfi, length]) => window.frond.textAt(cfi as string, length as number),
      [location.cfi, SAMPLE] as const,
    );

    // fixture 的第一節從標題「朝の光」開始。
    expect(text).toContain("朝の光");
  });

  test("CFI 帶著這一節在 readingOrder 上的序號", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    const location = await page.evaluate(() => window.frond.goToSection(1));

    const cfi = parseCfi(location.cfi);
    // `/6/4` ——spine 是封裝文件的第三個元素（`/6`），第二個 itemref 是 `/4`。
    expect(serializeCfi(cfi)).toMatch(/^epubcfi\(\/6\/4/);
  });

  test("換頁就換一個 CFI，而且是往後的", async ({ page }) => {
    const first = await mountFixture(page, "vertical-japanese", { settings: LARGE });
    const second = await page.evaluate(() => window.frond.next());

    expect(second.cfi).not.toBe(first.cfi);
    // 相鄰兩頁的位置在書中的先後必須成立。這一條是 ADR-0004 列的自我一致性
    // 不變量之一，而它**不需要三家給出同一個數字**——每一家各自成立就好。
    expect(comparison(first.cfi, second.cfi)).toBe("before");
  });
});

test.describe("由 CFI 回到位置", () => {
  test("CFI → 跳過去 → CFI 是 identity", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });

    await page.evaluate(() => window.frond.next());
    const marked = await page.evaluate(() => window.frond.snapshot());

    await page.evaluate(() => window.frond.goToSection(2));
    const restored = await page.evaluate(
      (cfi) => window.frond.goToCfi(cfi as string),
      marked.cfi,
    );

    expect(restored.sectionIndex).toBe(marked.sectionIndex);
    expect(restored.page).toBe(marked.page);
    expect(restored.cfi).toBe(marked.cfi);
  });

  test("認不出來的 CFI 什麼也不做，不丟錯", async ({ page }) => {
    // 書換了一版、CFI 來自別的閱讀器——兩種都會走到這裡，而它們的處置不是把
    // 閱讀流程打斷。
    const before = await mountFixture(page, "vertical-japanese");
    const after = await page.evaluate(() =>
      window.frond.goToCfi("epubcfi(/6/999!/4/2/1:0)"),
    );

    expect(after.sectionIndex).toBe(before.sectionIndex);
    expect(after.page).toBe(before.page);
  });

  test("壞掉的 CFI 字串一樣不丟錯", async ({ page }) => {
    const before = await mountFixture(page, "vertical-japanese");
    const after = await page.evaluate(() => window.frond.goToCfi("這不是一個 CFI"));

    expect(after.cfi).toBe(before.cfi);
  });

  test("跳到 TOC 指的那一節與錨點", async ({ page }) => {
    // user story 26。收的是**壓縮檔內的路徑**（`TocItem.target.path` 的形狀），
    // 不是原樣的 href——`%2c` 與 `../` 的正規化已經在 `EpubBook` 那一層做完了
    // （ADR-0002：同一種正規化只實作一次）。
    await mountFixture(page, "nested-toc");

    // 路徑從書自己拿，不在測試裡抄一份字面值：內容目錄的名字是產生器的細節，
    // 抄下來的話它一改，這裡會紅在一個與本題無關的地方。
    const second = await page.evaluate(() => window.frond.goToSection(1));
    await page.evaluate(() => window.frond.goToSection(0));

    const location = await page.evaluate(
      (path) => window.frond.goTo(path as string, "part-2-1"),
      second.sectionPath,
    );

    expect(location.sectionIndex).toBe(1);
  });
});

test.describe("全書進度", () => {
  test("整書索引建好之前沒有 fraction", async ({ page }) => {
    // user story 25：定位軸在那之前該停用，而不是拿一個錯的值畫上去。
    const initial = await mountFixture(page, "vertical-japanese");
    expect(initial.fraction).toBeNull();

    const characters = await page.evaluate(() => window.frond.waitForIndex());
    expect(characters).toBeGreaterThan(0);

    const ready = await page.evaluate(() => window.frond.snapshot());
    expect(ready.fraction).not.toBeNull();
  });

  test("第一頁是 0，書末接近 1", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.waitForIndex());

    expect((await page.evaluate(() => window.frond.snapshot())).fraction).toBe(0);

    const last = await page.evaluate(() => window.frond.goToSection(2));
    expect(last.fraction).toBeGreaterThan(0.5);
  });

  test("往後翻，進度不會倒退", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.waitForIndex());

    let previous = -1;
    for (let step = 0; step < 12; step += 1) {
      const location = await page.evaluate(() => window.frond.next());
      const fraction = location.fraction ?? -1;

      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
      if (location.atEnd) break;
    }

    expect(previous).toBeGreaterThan(0);
  });

  test("由進度跳位置", async ({ page }) => {
    // user story 24：拖拉定位軸放開後要真的跳過去。
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.waitForIndex());

    const location = await page.evaluate(() => window.frond.goToFraction(0.5));

    expect(location.fraction).toBeGreaterThan(0.3);
    expect(location.fraction).toBeLessThan(0.7);
  });

  test("一個字都沒有的節不會讓進度變成 NaN", async ({ page }) => {
    // `empty-and-image-only-sections` 的第二節是空的、第三節只有圖片。
    await mountFixture(page, "empty-and-image-only-sections");
    await page.evaluate(() => window.frond.waitForIndex());

    const location = await page.evaluate(() => window.frond.goToSection(1));

    expect(location.fraction).not.toBeNull();
    expect(Number.isNaN(location.fraction)).toBe(false);
  });
});

test.describe("版面變動之後回到原位", () => {
  /**
   * 這一組問的是「**剛才在讀的那段文字還在眼前嗎**」，不是「頁碼有沒有變」。
   *
   * 頁碼一定會變——換了 viewport 或字級之後每頁裝的內容就不一樣了。也不能問「那
   * 段文字還在不在頁首」：字變小之後一頁裝得下更多，原本在第二頁開頭的那一段會
   * 落到第一頁的中段，而那是**正確**的行為。唯一站得住的斷言是它還看得見。
   */
  test("視窗縮放之後，剛才在讀的那段文字還在畫面上", async ({ page }) => {
    // user story 32。
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.next());

    const marked = await page.evaluate(() => window.frond.snapshot());
    await page.evaluate(() => window.frond.resize(600, 500));

    expect(await isOnScreen(page, marked.cfi)).toBe(true);
  });

  test("調字級之後，剛才在讀的那段文字還在畫面上", async ({ page }) => {
    // user story 19：不是被丟回這一節的開頭。
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.next());

    const marked = await page.evaluate(() => window.frond.snapshot());
    const before = await textAtCurrent(page);
    await page.evaluate(() => window.frond.applySettings({ fontSize: 40 }));

    expect(await isOnScreen(page, marked.cfi)).toBe(true);
    // 而且不是被丟回這一節的開頭——那一段文字與這一節的第一段不同。
    expect(before).not.toContain("朝の光");
  });

  test("換欄數之後也回得去", async ({ page }) => {
    await mountFixture(page, "huge-single-section", { settings: { columns: 1 } });
    for (let step = 0; step < 3; step += 1) {
      await page.evaluate(() => window.frond.next());
    }

    const marked = await page.evaluate(() => window.frond.snapshot());
    await page.evaluate(() => window.frond.applySettings({ columns: 2 }));

    expect(await isOnScreen(page, marked.cfi)).toBe(true);
  });
});

test.describe("一段範圍的矩形", () => {
  test("拿得到有面積的矩形，座標相對於容器", async ({ page }) => {
    // user story 49：消費端自己畫 highlight，frond 只給幾何（ADR-0002）。
    const location = await mountFixture(page, "vertical-japanese");

    const rects = await page.evaluate(
      (cfi) => window.frond.rectsFor(cfi as string),
      location.cfi,
    );

    expect(rects.length).toBeGreaterThan(0);
    expect(rects[0]!.width).toBeGreaterThan(0);
    expect(rects[0]!.height).toBeGreaterThan(0);
  });

  test("不在這一節的位置回空陣列", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const rects = await page.evaluate(() =>
      window.frond.rectsFor("epubcfi(/6/6!/4/2/1:0)"),
    );

    expect(rects).toEqual([]);
  });
});

/**
 * 這個位置現在看得見嗎。
 *
 * 判準是它的矩形落在容器的範圍內。不在目前這一頁的內容會被捲出去，座標因此是
 * 負的或超過容器——這比「頁碼相等」穩，因為版面一變頁碼本來就會變。
 */
async function isOnScreen(
  page: Parameters<typeof mountFixture>[0],
  cfi: string,
): Promise<boolean> {
  const [rects, size] = await Promise.all([
    page.evaluate((value) => window.frond.rectsFor(value as string), cfi),
    page.evaluate(() => window.frond.containerSize()),
  ]);

  const first = rects[0];
  if (first === undefined) return false;

  return (
    first.x >= 0 && first.y >= 0 && first.x < size.width && first.y < size.height
  );
}

async function textAtCurrent(page: Parameters<typeof mountFixture>[0]): Promise<string | null> {
  const location = await page.evaluate(() => window.frond.snapshot());
  return page.evaluate(
    ([cfi, length]) => window.frond.textAt(cfi as string, length as number),
    [location.cfi, SAMPLE] as const,
  );
}

/**
 * 兩個 CFI 的先後。
 *
 * 走的是文法層那一支（`src/epub/cfi.ts`），不在這裡重新實作比較——重新實作的話，
 * 這支測試會變成在驗證它自己的那份實作。
 */
function comparison(left: string, right: string): string {
  return compareCfi(parseCfi(left), parseCfi(right));
}
