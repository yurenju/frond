import { expect, test } from "@playwright/test";
import { compareCfi, parseCfi } from "../../../packages/frond/src/epub/cfi.ts";
import { mountFixture, openHarness, type Snapshot } from "../support/harness.js";

/**
 * 單一瀏覽器內的自我一致性不變量——ADR-0004 的 #7 修訂指名的那一格。
 *
 * > 直排下，頁數、斷頁位置、以及任何由它們導出的量（頁碼、每頁字數）不列入跨
 * > 瀏覽器互比。這一格改由**單一瀏覽器內的自我一致性不變量**守：翻到底再翻回
 * > 位置不變、相鄰頁邊界字元在文件順序上相連、CFI → page → CFI 為 identity、
 * > 字級變動後用 CFI 回到同一段文字。
 *
 * 下面就是那四條。**每一條在各家各自成立，不需要三家給出同一個數字**——三家的
 * 分欄 fragmentation 本來就不一致（Chromium 排 4 頁、Firefox 與 WebKit 各排 3 頁，
 * 同一本 fixture、同一 viewport、同一組設定）。
 *
 * 這也是為什麼這支 spec 一條硬編的頁數都沒有。
 */

const LARGE = { fontSize: 64 };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test("翻到書末再翻回來，每一步都回到原本的位置", async ({ page }) => {
  await mountFixture(page, "vertical-japanese", { settings: LARGE });

  const forward: Snapshot[] = [await page.evaluate(() => window.frond.snapshot())];
  while (!forward[forward.length - 1]!.atEnd && forward.length < 200) {
    forward.push(await page.evaluate(() => window.frond.next()));
  }

  expect(forward.length).toBeGreaterThan(3);
  expect(forward[forward.length - 1]!.atEnd).toBe(true);

  // 回程。每一步都要落回去程的同一個位置——連 CFI 都要一模一樣。
  for (let step = forward.length - 2; step >= 0; step -= 1) {
    const back = await page.evaluate(() => window.frond.previous());

    expect(back.sectionIndex, `第 ${step} 步的節`).toBe(forward[step]!.sectionIndex);
    expect(back.page, `第 ${step} 步的頁`).toBe(forward[step]!.page);
    expect(back.cfi, `第 ${step} 步的 CFI`).toBe(forward[step]!.cfi);
  }
});

test("相鄰兩頁的位置在書中嚴格遞增", async ({ page }) => {
  // 「相鄰頁邊界字元在文件順序上相連」的可斷言版本：下一頁的起點必須排在這一頁
  // 的起點之後。倒退表示分頁把內容重排過；相等表示有一頁沒有推進，也就是有內容
  // 被跳過或重複。
  await mountFixture(page, "huge-single-section", { settings: { columns: 1 } });

  let previous = await page.evaluate(() => window.frond.snapshot());

  for (let step = 0; step < 20; step += 1) {
    const current = await page.evaluate(() => window.frond.next());
    if (current.sectionIndex !== previous.sectionIndex) break;

    expect(
      compareCfi(parseCfi(previous.cfi), parseCfi(current.cfi)),
      `第 ${previous.page} 頁到第 ${current.page} 頁`,
    ).toBe("before");

    previous = current;
    if (current.atEnd) break;
  }

  expect(previous.page).toBeGreaterThan(3);
});

test("CFI → 跳過去 → CFI 是 identity，每一頁都是", async ({ page }) => {
  await mountFixture(page, "vertical-japanese", { settings: LARGE });

  const marks: Snapshot[] = [];
  let current = await page.evaluate(() => window.frond.snapshot());
  while (!current.atEnd && marks.length < 30) {
    marks.push(current);
    current = await page.evaluate(() => window.frond.next());
  }
  marks.push(current);

  for (const mark of marks) {
    // 先跳到別的地方，確保不是「本來就停在那裡」。
    await page.evaluate(() => window.frond.goToSection(0));
    const restored = await page.evaluate(
      (cfi) => window.frond.goToCfi(cfi as string),
      mark.cfi,
    );

    expect(restored.sectionIndex, mark.cfi).toBe(mark.sectionIndex);
    expect(restored.page, mark.cfi).toBe(mark.page);
    expect(restored.cfi, mark.cfi).toBe(mark.cfi);
  }
});

test("字級變動之後，用 CFI 回得到同一段文字", async ({ page }) => {
  await mountFixture(page, "vertical-japanese", { settings: LARGE });
  await page.evaluate(() => window.frond.next());

  const mark = await page.evaluate(() => window.frond.snapshot());
  const before = await page.evaluate(
    (cfi) => window.frond.textAt(cfi as string, 16),
    mark.cfi,
  );

  await page.evaluate(() => window.frond.applySettings({ fontSize: 28 }));
  const after = await page.evaluate(
    (cfi) => window.frond.textAt(cfi as string, 16),
    mark.cfi,
  );

  // 同一個 CFI 在重排之後仍然指到同一段文字——**CFI 不是版面的函數**。
  expect(after).toBe(before);
  expect(after).not.toBeNull();
});

test("一節的頁數與實際翻得到的頁數相符", async ({ page }) => {
  // 頁數不是拿來跨瀏覽器比的，但它在同一家裡必須說實話：回報 N 頁就要剛好翻得到
  // 第 N−1 頁，而且第 N−1 頁之後就換節。
  const start = await mountFixture(page, "huge-single-section", {
    settings: { columns: 1 },
  });

  expect(start.pageCount).toBeGreaterThan(5);

  let current = start;
  for (let step = 0; step < start.pageCount - 1; step += 1) {
    current = await page.evaluate(() => window.frond.next());
    expect(current.sectionIndex).toBe(0);
  }

  expect(current.page).toBe(start.pageCount - 1);
  expect(current.atEnd).toBe(true);
});
