import { expect, test, type Page } from "@playwright/test";
import { parseCfi } from "../../../packages/frond/src/epub/cfi.ts";
import { mountFixture, openHarness, type EventRecord } from "../support/harness.js";

/**
 * 選字與 annotation 的幾何（user story 47–51）。
 *
 * frond 只給**事實與幾何**：讀者選了哪一段（一個範圍 CFI）、那一段現在佔據哪些
 * 矩形。顏色、樣式、動畫、要不要跳出工具列，全部是消費端的政策（ADR-0002）。
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("選取事件", () => {
  test("選一段文字，送出帶範圍 CFI 的事件（user story 48）", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));

    const event = await waitForSelection(page);

    expect(event.text.length).toBeGreaterThan(0);
    expect(event.cfi).not.toBeNull();

    // **是範圍不是點。** annotation 要標的是一段，而規格裡點與範圍是兩種不同的
    // 寫法——混用會讓消費端分不出手上這一個是哪一種。
    expect(parseCfi(event.cfi!).kind).toBe("range");
  });

  test("取消選取也送事件，而不是不送", async ({ page }) => {
    // 消費端要據此把浮動工具列收起來，「沒有事件」表達不了那件事。
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));
    await waitForSelection(page);

    await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      (frame as HTMLIFrameElement).contentDocument?.getSelection()?.removeAllRanges();
    });

    // `undefined` 跨過 `page.evaluate` 的邊界時整個欄位會消失，所以判準寫成
    // 「最後一個選取事件有沒有帶 CFI」而不是比對 null。
    await expect
      .poll(async () => ((await lastSelection(page))?.cfi ?? null) === null)
      .toBe(true);
  });
});

test.describe("annotation 的幾何", () => {
  test("選取的那一段拿得到矩形（user story 49）", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));

    const event = await waitForSelection(page);
    const rects = await page.evaluate(
      (cfi) => window.frond.rectsFor(cfi as string),
      event.cfi!,
    );

    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  test("直排書上的矩形也標在對的位置（user story 51）", async ({ page }) => {
    // 直排的一段文字是**縱長**的：高比寬大。橫排剛好相反。這一條分得出「矩形
    // 是照書寫方向算的」與「矩形是照橫排算的、只是剛好有值」。
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));
    const vertical = await firstRect(page);

    await mountFixture(page, "huge-single-section");
    await page.evaluate(() => window.frond.selectText("p"));
    const horizontal = await firstRect(page);

    expect(vertical.height).toBeGreaterThan(vertical.width);
    expect(horizontal.width).toBeGreaterThan(horizontal.height);
  });

  test("翻頁之後矩形跟著更新（user story 50）", async ({ page }) => {
    // highlight 不能殘留在錯的位置。判準是同一個 CFI 在「它不在這一頁」與
    // 「它在這一頁」兩種狀態下，矩形落在容器範圍外／內。
    await mountFixture(page, "vertical-japanese", { settings: { fontSize: 64 } });

    const second = await page.evaluate(() => window.frond.next());
    expect(second.page).toBe(1);
    const onSecondPage = await firstRectOf(page, second.cfi);

    const back = await page.evaluate(() => window.frond.previous());
    expect(back.page).toBe(0);
    const fromFirstPage = await firstRectOf(page, second.cfi);

    const size = await page.evaluate(() => window.frond.containerSize());

    // 停在第 2 頁時它在畫面內；退回第 1 頁之後，同一個 CFI 的矩形被推到畫面外。
    expect(onSecondPage.y).toBeGreaterThanOrEqual(0);
    expect(onSecondPage.y).toBeLessThan(size.height);
    expect(fromFirstPage.y).toBeGreaterThanOrEqual(size.height);
  });
});

interface SelectionPayload {
  readonly cfi: string | null;
  readonly text: string;
}

/** 等到一個帶 CFI 的選取事件。`selectionchange` 是非同步的。 */
async function waitForSelection(page: Page): Promise<SelectionPayload> {
  await expect
    .poll(async () => ((await lastSelection(page))?.cfi ?? null) !== null)
    .toBe(true);

  const payload = await lastSelection(page);
  if (payload === undefined) throw new Error("等不到選取事件");
  return payload;
}

async function lastSelection(page: Page): Promise<SelectionPayload | undefined> {
  const events: readonly EventRecord[] = await page.evaluate(() =>
    window.frond.events(),
  );
  const selections = events.filter((event) => event.name === "selection");
  return selections[selections.length - 1]?.payload as SelectionPayload | undefined;
}

async function firstRect(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const event = await waitForSelection(page);
  return firstRectOf(page, event.cfi!);
}

async function firstRectOf(
  page: Page,
  cfi: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const rects = await page.evaluate((value) => window.frond.rectsFor(value as string), cfi);
  const first = rects[0];
  if (first === undefined) throw new Error(`${cfi} 沒有任何矩形`);
  return first;
}
