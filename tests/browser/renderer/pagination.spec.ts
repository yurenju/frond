import { expect, test } from "@playwright/test";
import { mountFixture, openHarness, type EventRecord } from "../support/harness.js";

/**
 * 翻頁、跨 Section 接續、頁數與 typed events。
 *
 * 這支裡沒有任何一條把頁數拿去跟另一家瀏覽器比。ADR-0004 的 #7 修訂把那件事收掉
 * 了：**直排下頁數與斷頁位置不列入跨瀏覽器互比**，因為三家的分欄 fragmentation
 * 本來就不一致（同一本指名字面的 fixture、同一 viewport、字級放大之後，Chromium
 * 排 4 頁而 Firefox 與 WebKit 各排 3 頁）。這裡守的是**同一家瀏覽器內的自我一致
 * 性**——每一條在各家各自成立，不需要三家給出同一個數字。
 */

/** 讓一節排得出好幾頁的字級。#7 的 foliate spike 用的也是這個值。 */
const LARGE = { fontSize: 64 };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("在同一節裡翻頁", () => {
  test("往後翻一頁，頁碼加一", async ({ page }) => {
    const start = await mountFixture(page, "vertical-japanese", { settings: LARGE });
    expect(start.pageCount).toBeGreaterThan(1);

    const next = await page.evaluate(() => window.frond.next());

    expect(next.sectionIndex).toBe(0);
    expect(next.page).toBe(1);
  });

  test("翻回來就回到原本那一頁", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });

    await page.evaluate(() => window.frond.next());
    const back = await page.evaluate(() => window.frond.previous());

    expect(back.page).toBe(0);
    expect(back.sectionIndex).toBe(0);
  });

  test("頁數是這一節的頁數，不是全書的", async ({ page }) => {
    // 全書頁數不是一個穩定的量（它隨 viewport 與字級變），所以 frond 不報它。
    // 消費端要全書進度時看的是 fraction。
    const location = await mountFixture(page, "vertical-japanese", { settings: LARGE });

    expect(location.pageCount).toBeGreaterThan(1);
    expect(location.pageCount).toBeLessThan(50);
  });
});

test.describe("跨 Section 接續", () => {
  test("翻到這一節的結尾，自動接到下一節的第一頁", async ({ page }) => {
    // user story 28：不必自己換節。
    await mountFixture(page, "vertical-japanese", { settings: LARGE });

    const location = await turnUntilSectionChanges(page);

    expect(location.sectionIndex).toBe(1);
    expect(location.page).toBe(0);
  });

  test("往前翻過這一節的開頭，接到上一節的最後一頁", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.goToSection(1));

    const back = await page.evaluate(() => window.frond.previous());

    expect(back.sectionIndex).toBe(0);
    // 「上一節的最後一頁」而不是第一頁——往前翻應該接在剛才看到的那一頁前面。
    expect(back.page).toBe(back.pageCount - 1);
  });

  test("非線性的項目也在閱讀順序上，不會被跳過", async ({ page }) => {
    // 濾掉 linear="no" 是政策不是事實（ADR-0002）。
    const location = await mountFixture(page, "empty-and-image-only-sections");
    const sections = new Set<number>([location.sectionIndex]);

    for (let step = 0; step < 40; step += 1) {
      const next = await page.evaluate(() => window.frond.next());
      sections.add(next.sectionIndex);
      if (next.atEnd) break;
    }

    expect([...sections].sort()).toEqual([0, 1, 2]);
  });
});

test.describe("書的兩端", () => {
  test("在書的開頭往前翻，什麼也不會發生", async ({ page }) => {
    const start = await mountFixture(page, "vertical-japanese");
    expect(start.atStart).toBe(true);

    const back = await page.evaluate(() => window.frond.previous());

    // 不丟錯，也不繞回最後一頁——`atStart` 才是消費端該看的事實。
    expect(back.sectionIndex).toBe(0);
    expect(back.page).toBe(0);
    expect(back.atStart).toBe(true);
  });

  test("翻到書末之後 atEnd 成立，再翻也不動", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const end = await turnToEnd(page);
    expect(end.atEnd).toBe(true);

    const again = await page.evaluate(() => window.frond.next());
    expect(again.sectionIndex).toBe(end.sectionIndex);
    expect(again.page).toBe(end.page);
  });
});

test.describe("藏起來的內容不影響頁數", () => {
  /**
   * 實書量到的形狀：註腳放在正文**後面**、用 `display: none` 藏起來（讀者點上標
   * 才看到），或者整份 `nav.xhtml` 被藏起來。於是**文件順序的最後一個文字節點
   * 畫不出來**，而它的矩形是全零。
   *
   * 拿那個全零的矩形當「內容延伸到哪裡」的答案，整節的頁數會被算成 1
   * ——讀者只讀得到一章的第一頁，其餘翻不過去，而且不會有任何錯誤：頁數看起來
   * 是一個正常的數字。樣本裡最嚴重的一節有 8778 個畫得出來的字元，只報得出 1 頁。
   *
   * 病長在**最後一節**上，前兩節保持健康（`ailments.ts`）。
   */
  const AFFLICTED_SECTION = 2;

  test("正文後面跟著藏起來的註腳，頁數照正文算", async ({ page }) => {
    await mountFixture(page, "hidden-trailing-notes");

    const afflicted = await page.evaluate(
      (index) => window.frond.goToSection(index),
      AFFLICTED_SECTION,
    );

    // 這一條的牙齒全在這個數字上：病在的時候它是 1。
    expect(afflicted.sectionIndex).toBe(AFFLICTED_SECTION);
    expect(afflicted.pageCount).toBeGreaterThan(1);
  });

  test("翻得到正文的最後一頁", async ({ page }) => {
    // 頁數對了還不夠——真正的要求是那些頁翻得過去、而且上面有字。
    await mountFixture(page, "hidden-trailing-notes");
    const start = await page.evaluate(
      (index) => window.frond.goToSection(index),
      AFFLICTED_SECTION,
    );

    // 頁數先斷言一次。少了這一行，病在的時候 `pageCount` 是 1、底下那個迴圈一次
    // 都不跑，於是這條測試會停在第 0 頁然後綠燈通過——一條沒有牙齒的測試。
    expect(start.pageCount).toBeGreaterThan(1);

    let current = start;
    for (let step = 0; step < start.pageCount - 1; step += 1) {
      current = await page.evaluate(() => window.frond.next());
    }

    expect(current.sectionIndex).toBe(AFFLICTED_SECTION);
    expect(current.page).toBe(start.pageCount - 1);

    // 最後一頁不是空的。空白頁是封閉缺陷清單裡的一項，而「頁數多算了」與
    // 「頁數少算了」都會在這一條上現形。
    const visibleParagraphs = await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      if (!(frame instanceof HTMLIFrameElement)) return 0;
      const inner = frame.contentDocument;
      if (inner === null) return 0;

      const size = window.frond.containerSize();
      let visible = 0;
      for (const element of inner.querySelectorAll("p")) {
        for (const rect of element.getClientRects()) {
          if (rect.right > 0 && rect.left < size.width && rect.bottom > 0) {
            visible += 1;
          }
        }
      }
      return visible;
    });

    expect(visibleParagraphs).toBeGreaterThan(0);
  });

  test("藏起來的註腳一個字都沒有畫出來", async ({ page }) => {
    // 對照組：頁數變多不是因為 frond 把註腳顯示出來了。書要求藏起來就是藏起來
    // ——那是書的宣告，frond 沒有介入的理由（ADR-0003）。
    await mountFixture(page, "hidden-trailing-notes");
    await page.evaluate(
      (index) => window.frond.goToSection(index),
      AFFLICTED_SECTION,
    );

    const noteRects = await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      if (!(frame instanceof HTMLIFrameElement)) return -1;
      const inner = frame.contentDocument;
      if (inner === null) return -1;

      let rects = 0;
      for (const note of inner.querySelectorAll(".note")) {
        rects += note.getClientRects().length;
      }
      return rects;
    });

    expect(noteRects).toBe(0);
  });
});

test.describe("typed events", () => {
  test("掛書時送出 load 與 relocate", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const events = await page.evaluate(() => window.frond.events());
    const names = events.map((event) => event.name);

    expect(names).toContain("load");
    expect(names).toContain("relocate");
    // load 一定在 relocate 之前：位置是掛好之後才算得出來的。
    expect(names.indexOf("load")).toBeLessThan(names.indexOf("relocate"));
  });

  test("load 帶著這一節排出來的書寫方向", async ({ page }) => {
    await mountFixture(page, "writing-mode-on-body");

    const load = (await page.evaluate(() => window.frond.events())).find(
      (event) => event.name === "load",
    );

    expect(load?.payload).toMatchObject({
      sectionIndex: 0,
      writingMode: "vertical-rl",
    });
  });

  test("relocate 帶著完整的位置", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.next());

    const relocate = lastOf(
      await page.evaluate(() => window.frond.events()),
      "relocate",
    );

    expect(relocate).toMatchObject({ sectionIndex: 0, page: 1 });
    expect((relocate as { cfi: string }).cfi).toMatch(/^epubcfi\(/);
  });

  test("位置沒變就不重複送 relocate", async ({ page }) => {
    // 翻到書末再按一次「下一頁」什麼都沒變，而重複的 relocate 會讓消費端誤以為
    // 位置動了（例如把同一個進度再同步一次到雲端）。
    await mountFixture(page, "vertical-japanese");
    await turnToEnd(page);

    const before = countOf(await page.evaluate(() => window.frond.events()), "relocate");
    await page.evaluate(() => window.frond.next());
    const after = countOf(await page.evaluate(() => window.frond.events()), "relocate");

    expect(after).toBe(before);
  });

  test("點內容裡的連結送出 linkactivate，而不是自己跳過去", async ({ page }) => {
    // frond 給事實，跳不跳是政策（ADR-0002）。自己跳過去會把整個渲染狀態丟掉。
    await mountFixture(page, "nested-toc");

    const appended = await page.evaluate(() => {
      const document = (
        window.document.querySelector("#viewport iframe") as HTMLIFrameElement
      ).contentDocument;
      if (document === null) return false;
      const body = document.body;
      if (body === null) return false;

      // `createElementNS` 而不是 `createElement`：內容文件是 XML，而
      // `createElement` 在 XML 文件裡造出來的元素沒有命名空間，於是它不是一個
      // XHTML 的 `<a>`——瀏覽器不會把它當連結，測試也就測不到連結的行為。
      const anchor = document.createElementNS("http://www.w3.org/1999/xhtml", "a");
      anchor.setAttribute("href", "section-2.xhtml#part-2-1");
      anchor.textContent = "次へ";
      body.append(anchor);
      return true;
    });
    expect(appended).toBe(true);

    await page.evaluate(() => window.frond.clickLink("a[href]"));

    const link = lastOf(await page.evaluate(() => window.frond.events()), "linkactivate");

    expect(link).toMatchObject({
      href: "section-2.xhtml#part-2-1",
      sectionIndex: 1,
      fragment: "part-2-1",
    });
    // 沒有跳過去——位置還在原地。
    expect(await page.evaluate(() => window.frond.snapshot())).toMatchObject({
      sectionIndex: 0,
    });
  });
});

/** 一直往後翻到節換了為止。 */
async function turnUntilSectionChanges(
  page: Parameters<typeof mountFixture>[0],
): ReturnType<typeof mountFixture> {
  let location = await page.evaluate(() => window.frond.snapshot());

  for (let step = 0; step < 200; step += 1) {
    const next = await page.evaluate(() => window.frond.next());
    if (next.sectionIndex !== location.sectionIndex) return next;
    if (next.atEnd) return next;
    location = next;
  }

  throw new Error("翻了 200 頁都沒有換節");
}

/** 一直往後翻到書末。 */
async function turnToEnd(
  page: Parameters<typeof mountFixture>[0],
): ReturnType<typeof mountFixture> {
  for (let step = 0; step < 500; step += 1) {
    const next = await page.evaluate(() => window.frond.next());
    if (next.atEnd) return next;
  }

  throw new Error("翻了 500 頁都沒有到書末");
}

function lastOf(events: readonly EventRecord[], name: string): unknown {
  const matching = events.filter((event) => event.name === name);
  return matching[matching.length - 1]?.payload;
}

function countOf(events: readonly EventRecord[], name: string): number {
  return events.filter((event) => event.name === name).length;
}
