import { expect, test, type Page } from "@playwright/test";
import { mountFixture, openHarness, type EventRecord } from "../support/harness.js";

/**
 * iframe 裡的指標與按鍵事件的出口。
 *
 * ## 為什麼這一格非有不可
 *
 * 一節渲染在一個 iframe 裡（ADR-0006），而 iframe 的邊界擋住事件冒泡——消費端在
 * 容器上掛 listener 是收不到任何東西的。少了這個出口，滑動翻頁、點兩側翻頁、
 * 焦點在內文時的方向鍵**全部沒有反應**，而且不會有任何錯誤訊息。
 *
 * ## 為什麼 frond 只送這些
 *
 * 送的是事實：某一刻、容器座標的某一點、指標按下了，而且當下這兩個 DOM 條件成立。
 * 「往左滑等於下一頁」「點右側三分之一等於翻頁」是政策，屬於消費端（ADR-0002）。
 * 所以這裡沒有任何一條斷言長成「滑動之後翻到了下一頁」——那不是 frond 的行為。
 *
 * 用的是 Playwright 的真實滑鼠與鍵盤，不是合成事件：座標換算與焦點路由正是這一
 * 格最容易錯的兩件事，而合成事件會把兩者都繞過去。
 */

/** 外殼頁面的容器貼在 (0, 0)，所以頁面座標就是容器座標。 */
const CONTAINER = { width: 800, height: 600 };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("指標事件", () => {
  test("按下與放開各送一次，帶容器座標", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.move(300, 200);
    await page.mouse.down();
    await page.mouse.up();

    const down = await waitForEvent(page, "pointerdown");
    const up = await waitForEvent(page, "pointerup");

    // 事件的 clientX/clientY 是相對於 iframe 的可視區域，而 iframe 被邊界推移過。
    // 加回那一段之後就落回容器座標——也就是滑鼠實際點的地方。
    expect(down.x).toBeCloseTo(300, 0);
    expect(down.y).toBeCloseTo(200, 0);
    expect(up.x).toBeCloseTo(300, 0);
    expect(up.y).toBeCloseTo(200, 0);
  });

  test("帶容器尺寸——點擊分區要拿它算比例", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);
    const event = await waitForEvent(page, "pointerup");

    expect(event.width).toBe(CONTAINER.width);
    expect(event.height).toBe(CONTAINER.height);
  });

  /**
   * 座標與 `rectsFor()` 必須同一個參考系。
   *
   * 消費端把浮動工具列畫在容器上，位置同時來自這兩個地方（選取的矩形決定貼哪，
   * 指標的位置決定要不要收起來）。兩者用不同的原點的話，症狀是工具列偏移一個
   * 邊界的距離——而那個距離剛好等於讀者設定的 margin，所以調大邊界會讓偏移變大。
   */
  test("座標與 rectsFor 同一個原點：邊界加大時兩者一起位移", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: { margin: 80 } });

    const frame = await page.evaluate(() => window.frond.frameBox());
    expect(frame.x).toBe(80);
    expect(frame.y).toBe(80);

    // 點在 iframe 內容區的左上角。容器座標應該就是邊界本身。
    await page.mouse.click(frame.x + 1, frame.y + 1);
    const event = await waitForEvent(page, "pointerup");

    expect(event.x).toBeCloseTo(frame.x + 1, 0);
    expect(event.y).toBeCloseTo(frame.y + 1, 0);
  });

  test("點在內文上時 isLink 是 false", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);
    expect((await waitForEvent(page, "pointerup")).isLink).toBe(false);
  });

  /**
   * 連結那一格，以及 `pointerup` 與 `linkactivate` 的順序。
   *
   * 消費端要讓「點連結」贏過「點右側翻頁」，就必須在 `pointerup` 的當下判斷得
   * 出來——`isLink` 就是為了這一格存在的。順序反過來的話這個欄位沒有用途，所以
   * 兩件事一起釘。
   */
  test("點在連結上：isLink 是 true，且 pointerup 排在 linkactivate 前面", async ({
    page,
  }) => {
    await mountFixture(page, "nested-toc");
    const at = await prependLink(page);

    await page.mouse.click(at.x, at.y);

    expect((await waitForEvent(page, "pointerup")).isLink).toBe(true);

    const names = (await events(page)).map((record) => record.name);
    const up = names.lastIndexOf("pointerup");
    const activate = names.lastIndexOf("linkactivate");

    expect(activate).toBeGreaterThan(-1);
    expect(up).toBeLessThan(activate);
  });

  test("有選取時 hasSelection 是 true——選字中不翻頁靠它", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));

    await page.mouse.move(300, 200);
    await page.mouse.down();

    expect((await waitForEvent(page, "pointerdown")).hasSelection).toBe(true);
  });
});

test.describe("按鍵事件", () => {
  /**
   * 焦點在 iframe 裡的時候，外層 document 的 keyup 收不到任何東西——這正是接上
   * frond 之後方向鍵翻頁會失效的原因。所以這條測試先點一下內文把焦點送進去，
   * 再按鍵：焦點在外層時能收到不代表這個出口有用。
   */
  test("焦點在 iframe 裡時，方向鍵仍然送得出來", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);
    await page.keyboard.press("ArrowLeft");

    const down = await waitForKeyEvent(page, "keydown");
    const up = await waitForKeyEvent(page, "keyup");

    expect(down.key).toBe("ArrowLeft");
    expect(up.key).toBe("ArrowLeft");
    expect(up.code).toBe("ArrowLeft");
  });

  test("帶修飾鍵的狀態", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.mouse.click(400, 300);
    await page.keyboard.press("Shift+ArrowRight");

    const event = await waitForKeyEvent(page, "keydown");
    expect(event.key).toBe("ArrowRight");
    expect(event.shiftKey).toBe(true);
    expect(event.ctrlKey).toBe(false);
  });
});

test.describe("frond 不對輸入做任何決定", () => {
  /**
   * 這一條守的是 ADR-0002 的界線本身：轉發事件**不等於**開始吃手勢。
   *
   * 往左滑一段距離之後位置一格都不能動——「這是一次滑動，所以翻頁」是消費端的
   * 決定。這條測試紅掉的時候，代表有人在 frond 裡加了一段手勢處理。
   */
  test("在內文上滑動不會翻頁", async ({ page }) => {
    const before = await mountFixture(page, "vertical-japanese");

    await page.mouse.move(600, 300);
    await page.mouse.down();
    await page.mouse.move(200, 300, { steps: 10 });
    await page.mouse.up();

    const after = await page.evaluate(() => window.frond.snapshot());
    expect(after.page).toBe(before.page);
    expect(after.sectionIndex).toBe(before.sectionIndex);
  });

  test("方向鍵不會翻頁", async ({ page }) => {
    const before = await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");

    const after = await page.evaluate(() => window.frond.snapshot());
    expect(after.page).toBe(before.page);
    expect(after.sectionIndex).toBe(before.sectionIndex);
  });
});

interface PointerPayload {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly hasSelection: boolean;
  readonly isLink: boolean;
}

interface KeyPayload {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

function events(page: Page): Promise<readonly EventRecord[]> {
  return page.evaluate(() => window.frond.events());
}

/**
 * 在這一節的開頭插一個連結，回傳它在頁面座標系裡的位置。
 *
 * fixture 的內容文件本身沒有 `<a>`（`pagination.spec.ts` 的 linkactivate 那條也
 * 是自己插一個），而插在**開頭**是因為要點得到——插在結尾的話它會落在後面某一頁，
 * 不在畫面上。
 *
 * `createElementNS` 而不是 `createElement`：內容文件是 XML，`createElement` 造出
 * 來的元素沒有命名空間，於是它不是一個 XHTML 的 `<a>`，瀏覽器不把它當連結。
 */
async function prependLink(page: Page): Promise<{ x: number; y: number }> {
  const at = await page.evaluate(() => {
    const frame = document.querySelector("#viewport iframe") as HTMLIFrameElement | null;
    const contents = frame?.contentDocument;
    if (frame === null || contents == null || contents.body === null) return null;

    const anchor = contents.createElementNS("http://www.w3.org/1999/xhtml", "a");
    anchor.setAttribute("href", "section-2.xhtml#part-2-1");
    anchor.textContent = "次へ";
    contents.body.prepend(anchor);

    const rect = anchor.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return {
      x: frameRect.left + rect.left + rect.width / 2,
      y: frameRect.top + rect.top + rect.height / 2,
    };
  });

  expect(at).not.toBeNull();
  return at!;
}

async function waitForEvent(page: Page, name: string): Promise<PointerPayload> {
  await expect
    .poll(async () => (await events(page)).some((record) => record.name === name))
    .toBe(true);

  const all = await events(page);
  const last = [...all].reverse().find((record) => record.name === name)!;
  return last.payload as PointerPayload;
}

async function waitForKeyEvent(page: Page, name: string): Promise<KeyPayload> {
  await expect
    .poll(async () => (await events(page)).some((record) => record.name === name))
    .toBe(true);

  const all = await events(page);
  const last = [...all].reverse().find((record) => record.name === name)!;
  return last.payload as KeyPayload;
}
