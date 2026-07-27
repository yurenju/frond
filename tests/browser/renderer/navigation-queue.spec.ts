import { expect, test, type Page } from "@playwright/test";
import { openHarness, type EventRecord, type SettingsPatch } from "../support/harness.js";

/**
 * 連續操作的語意：翻頁累積，換設定取代。
 *
 * ## 為什麼需要這一層
 *
 * 跨節的操作中間有 await（掛 iframe、等字型），而**消費端不會等**。frond 原本
 * 靠一個 generation 計數器認出過期的載入，那守住了「不會有殘留的 iframe」，但守
 * 不住「按了幾次就前進幾次」：節尾連按兩次時，第二次讀到的 view 還是舊的，於是
 * 兩次輸入只前進一節。
 *
 * 這一格在只有按鍵的時候看不太出來，接上滑動翻頁之後是常態。
 *
 * ## 兩種語意，不是一種
 *
 * 一律排隊是錯的：讀者拖邊界滑桿時 `input` 一格發一次 `applySettings`，串行跑完
 * 每一格會讓滑桿卡死。那一側要的是「只有最後一次算數」。所以下面兩個 describe
 * 驗的是**相反的**行為，而它們都是對的。
 */

/** 一節一段，每一節都排得下一頁——於是「翻一頁」等於「換一節」，數起來沒有歧義。 */
function shortSections(count: number): string[] {
  return Array.from(
    { length: count },
    (_unused, index) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head><title>t</title></head>
  <body><p>第${index}節</p></body>
</html>`,
  );
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("翻頁累積", () => {
  /**
   * 這是這張票的核心不變量。
   *
   * **必須不逐次 await 才測得到**——逐次等的話佇列裡永遠只有一個人，回歸發生時
   * 這條測試照樣是綠的。
   */
  test("節界連按 N 次「下一頁」前進 N 節", async ({ page }) => {
    await page.evaluate(
      ([sections]) => window.frond.mountInline(sections as string[], {}),
      [shortSections(6)] as const,
    );

    const after = await page.evaluate(() => window.frond.rapidNext(4));
    expect(after.sectionIndex).toBe(4);
  });

  test("按到書末就停住，不繞回去也不丟錯", async ({ page }) => {
    await page.evaluate(
      ([sections]) => window.frond.mountInline(sections as string[], {}),
      [shortSections(3)] as const,
    );

    const after = await page.evaluate(() => window.frond.rapidNext(8));
    expect(after.sectionIndex).toBe(2);
    expect(after.atEnd).toBe(true);
  });

  /**
   * 排隊中的翻頁**不能**送出屬於舊節的 relocate。
   *
   * 沒有佇列時，第二次 `next()` 會在舊 view 上動一頁並送一次 relocate，然後才被
   * 落地的新節覆寫。消費端把 relocate 存成閱讀進度，於是那一筆會是一個已經不成立
   * 的位置——而它排在正確的那一筆前面，所以看起來只是「多存了一次」。
   */
  test("每一次 relocate 的節與頁都往前，不會倒退", async ({ page }) => {
    await page.evaluate(
      ([sections]) => window.frond.mountInline(sections as string[], {}),
      [shortSections(5)] as const,
    );
    await page.evaluate(() => window.frond.rapidNext(4));

    const seen = (await events(page))
      .filter((record) => record.name === "relocate")
      .map((record) => (record.payload as { sectionIndex: number }).sectionIndex);

    expect(seen.length).toBeGreaterThan(0);
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]!).toBeGreaterThanOrEqual(seen[index - 1]!);
    }
  });
});

test.describe("換設定取代", () => {
  /**
   * 拖滑桿的形狀：連續 N 次 `applySettings`，只有最後一次該真的排版。
   *
   * 判準是 `load` 事件的次數而不是最後停在哪——「最後一次生效」在純排隊的實作下
   * 也成立，差別只在中間白做了 N-1 次完整掛載，而那正是滑桿卡死的原因。所以這條
   * 測試量的是**做了幾次**。
   */
  test("連續 N 次換設定不會排版 N 次", async ({ page }) => {
    await page.evaluate(
      ([sections]) => window.frond.mountInline(sections as string[], {}),
      [shortSections(3)] as const,
    );

    const before = await loadCount(page);
    const patches: SettingsPatch[] = [16, 20, 24, 28, 32, 36, 40, 44].map((margin) => ({
      margin,
    }));
    await page.evaluate(
      ([list]) => window.frond.rapidApplySettings(list as SettingsPatch[]),
      [patches] as const,
    );

    // 落地的次數遠少於發出的次數。取一半當門檻而不是寫死 2：第一次可能已經開始
    // 跑了才收到第二次，那一次不該被算成回歸。
    expect((await loadCount(page)) - before).toBeLessThan(patches.length / 2);
  });

  /**
   * **設定本身要累積，被取代的只有排版。**
   *
   * 這是把兩種語意搞混時最貴的一格：如果整個 `applySettings` 都延後到佇列裡，
   * 被後來者取代的那幾次連 patch 都沒套上，於是「先調字級再調邊界」會靜默地把
   * 字級丟掉。症狀是滑桿拖得快的時候設定會漏，慢慢拖就正常。
   */
  test("被合併掉的那幾次，設定仍然套用", async ({ page }) => {
    await page.evaluate(
      ([sections]) => window.frond.mountInline(sections as string[], {}),
      [shortSections(3)] as const,
    );

    await page.evaluate(() =>
      window.frond.rapidApplySettings([
        { fontSize: 40 },
        { lineHeight: 2.5 },
        { margin: 60 },
      ]),
    );

    // 三項都要在最後的畫面上，不是只有最後一項。
    expect(await page.evaluate(() => window.frond.frameBox())).toMatchObject({
      x: 60,
      y: 60,
    });
    expect(await page.evaluate(() => window.frond.computed(":root", "font-size"))).toBe(
      "40px",
    );
    expect(await page.evaluate(() => window.frond.computed("p", "line-height"))).toBe(
      "100px",
    );
  });
});

function events(page: Page): Promise<readonly EventRecord[]> {
  return page.evaluate(() => window.frond.events());
}

async function loadCount(page: Page): Promise<number> {
  return (await events(page)).filter((record) => record.name === "load").length;
}
