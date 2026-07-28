import { expect, test } from "@playwright/test";
import { mountFixture, openHarness, type EventRecord } from "../support/harness.js";

/**
 * Turning pages, continuing across Sections, page counts, and typed events.
 *
 * Not one case here compares a page count against another browser. ADR-0004's #7 revision
 * ruled that out: **page counts and break positions when vertical are excluded from
 * cross-browser comparison**, because the three engines' multicol fragmentation does not
 * agree by construction (on one named-face fixture, one viewport, with the size raised,
 * Chromium lays out 4 pages while Firefox and WebKit lay out 3 each). What is guarded here
 * is **self-consistency within one browser** — every case holds in each engine on its own
 * terms, without the three having to produce the same number.
 */

/** A font size large enough for a section to lay out over several pages. #7's foliate spike used this value too. */
const LARGE = { fontSize: 64 };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("turning pages within one section", () => {
  test("one page forward adds one to the page number", async ({ page }) => {
    const start = await mountFixture(page, "vertical-japanese", { settings: LARGE });
    expect(start.pageCount).toBeGreaterThan(1);

    const next = await page.evaluate(() => window.frond.next());

    expect(next.sectionIndex).toBe(0);
    expect(next.page).toBe(1);
  });

  test("turning back returns to the page it came from", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });

    await page.evaluate(() => window.frond.next());
    const back = await page.evaluate(() => window.frond.previous());

    expect(back.page).toBe(0);
    expect(back.sectionIndex).toBe(0);
  });

  test("the page count is this section's, not the whole book's", async ({ page }) => {
    // A whole-book page count is not a stable quantity (it changes with viewport and font
    // size), so frond does not report one. A consumer wanting whole-book progress looks at
    // fraction.
    const location = await mountFixture(page, "vertical-japanese", { settings: LARGE });

    expect(location.pageCount).toBeGreaterThan(1);
    expect(location.pageCount).toBeLessThan(50);
  });
});

test.describe("continuing across Sections", () => {
  test("turning past this section's end continues onto the next section's first page", async ({ page }) => {
    // user story 28: no changing sections by hand.
    await mountFixture(page, "vertical-japanese", { settings: LARGE });

    const location = await turnUntilSectionChanges(page);

    expect(location.sectionIndex).toBe(1);
    expect(location.page).toBe(0);
  });

  test("turning back past this section's start continues onto the previous section's last page", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.goToSection(1));

    const back = await page.evaluate(() => window.frond.previous());

    expect(back.sectionIndex).toBe(0);
    // "The previous section's last page" rather than its first — turning back should land
    // immediately before the page just seen.
    expect(back.page).toBe(back.pageCount - 1);
  });

  test("non-linear items are on the reading order too, and are not skipped", async ({ page }) => {
    // Filtering out linear="no" is policy, not fact (ADR-0002).
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

test.describe("the book's two ends", () => {
  test("turning back at the book's start does nothing", async ({ page }) => {
    const start = await mountFixture(page, "vertical-japanese");
    expect(start.atStart).toBe(true);

    const back = await page.evaluate(() => window.frond.previous());

    // No throw and no wrapping round to the last page — `atStart` is the fact the consumer
    // should be looking at.
    expect(back.sectionIndex).toBe(0);
    expect(back.page).toBe(0);
    expect(back.atStart).toBe(true);
  });

  test("atEnd holds once the book's end is reached, and turning again does not move", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const end = await turnToEnd(page);
    expect(end.atEnd).toBe(true);

    const again = await page.evaluate(() => window.frond.next());
    expect(again.sectionIndex).toBe(end.sectionIndex);
    expect(again.page).toBe(end.page);
  });
});

test.describe("hidden content does not affect the page count", () => {
  /**
   * A shape measured on real books: notes placed **after** the body text and hidden with
   * `display: none` (shown when the reader taps the marker), or a whole `nav.xhtml` hidden.
   * So **the last text node in document order does not draw**, and its rectangle is all
   * zeros.
   *
   * Taking that all-zero rectangle as the answer to "how far does the content extend"
   * computes the whole section's page count as 1 — the reader gets only a chapter's first
   * page and cannot turn past it, with no error at all: the page count looks like a
   * perfectly normal number. The worst section in the sample has 8778 drawable characters
   * and reports 1 page.
   *
   * The ailment lives in the **last section**; the first two stay healthy (`ailments.ts`).
   */
  const AFFLICTED_SECTION = 2;

  test("with hidden notes after the body text, the page count follows the body text", async ({ page }) => {
    await mountFixture(page, "hidden-trailing-notes");

    const afflicted = await page.evaluate(
      (index) => window.frond.goToSection(index),
      AFFLICTED_SECTION,
    );

    // This case's teeth are entirely in this number: with the ailment present it is 1.
    expect(afflicted.sectionIndex).toBe(AFFLICTED_SECTION);
    expect(afflicted.pageCount).toBeGreaterThan(1);
  });

  test("the body text's last page can be turned to", async ({ page }) => {
    // A correct page count is not enough — the real requirement is that those pages can be
    // reached and have text on them.
    await mountFixture(page, "hidden-trailing-notes");
    const start = await page.evaluate(
      (index) => window.frond.goToSection(index),
      AFFLICTED_SECTION,
    );

    // Assert the page count first. Without this line, with the ailment present `pageCount`
    // is 1, the loop below never runs, and this test stops at page 0 and passes green — a
    // test with no teeth.
    expect(start.pageCount).toBeGreaterThan(1);

    let current = start;
    for (let step = 0; step < start.pageCount - 1; step += 1) {
      current = await page.evaluate(() => window.frond.next());
    }

    expect(current.sectionIndex).toBe(AFFLICTED_SECTION);
    expect(current.page).toBe(start.pageCount - 1);

    // The last page is not blank. A blank page is an entry on the closed defect list, and
    // both "the page count was too high" and "too low" surface in this case.
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

  test("not one character of the hidden notes is drawn", async ({ page }) => {
    // The control: the page count did not go up because frond made the notes visible. What
    // the book asks to hide stays hidden — that is the book's declaration, and frond has no
    // reason to intervene (ADR-0003).
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
  test("mounting a book emits load and relocate", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const events = await page.evaluate(() => window.frond.events());
    const names = events.map((event) => event.name);

    expect(names).toContain("load");
    expect(names).toContain("relocate");
    // load always comes before relocate: the position is only computable once mounted.
    expect(names.indexOf("load")).toBeLessThan(names.indexOf("relocate"));
  });

  test("load carries the writing mode this section laid out in", async ({ page }) => {
    await mountFixture(page, "writing-mode-on-body");

    const load = (await page.evaluate(() => window.frond.events())).find(
      (event) => event.name === "load",
    );

    expect(load?.payload).toMatchObject({
      sectionIndex: 0,
      writingMode: "vertical-rl",
    });
  });

  test("relocate carries the complete position", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.next());

    const relocate = lastOf(
      await page.evaluate(() => window.frond.events()),
      "relocate",
    );

    expect(relocate).toMatchObject({ sectionIndex: 0, page: 1 });
    expect((relocate as { cfi: string }).cfi).toMatch(/^epubcfi\(/);
  });

  test("relocate is not re-emitted when the position has not changed", async ({ page }) => {
    // Pressing "next page" again at the book's end changes nothing, and a repeated relocate
    // would make the consumer believe the position moved (syncing the same progress to the
    // cloud a second time, say).
    await mountFixture(page, "vertical-japanese");
    await turnToEnd(page);

    const before = countOf(await page.evaluate(() => window.frond.events()), "relocate");
    await page.evaluate(() => window.frond.next());
    const after = countOf(await page.evaluate(() => window.frond.events()), "relocate");

    expect(after).toBe(before);
  });

  test("clicking a link in the content emits linkactivate rather than navigating", async ({ page }) => {
    // frond supplies facts; whether to navigate is policy (ADR-0002). Navigating itself
    // would throw the whole rendering state away.
    await mountFixture(page, "nested-toc");

    const appended = await page.evaluate(() => {
      const document = (
        window.document.querySelector("#viewport iframe") as HTMLIFrameElement
      ).contentDocument;
      if (document === null) return false;
      const body = document.body;
      if (body === null) return false;

      // `createElementNS` rather than `createElement`: the content document is XML, and an
      // element `createElement` builds in an XML document has no namespace, so it is not an
      // XHTML `<a>` — the browser does not treat it as a link, and the test measures no link
      // behaviour at all.
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
    // It did not navigate — the position is unchanged.
    expect(await page.evaluate(() => window.frond.snapshot())).toMatchObject({
      sectionIndex: 0,
    });
  });
});

/** Turns forward until the section changes. */
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

  throw new Error("200 page turns without the section changing");
}

/** Turns forward until the book's end. */
async function turnToEnd(
  page: Parameters<typeof mountFixture>[0],
): ReturnType<typeof mountFixture> {
  for (let step = 0; step < 500; step += 1) {
    const next = await page.evaluate(() => window.frond.next());
    if (next.atEnd) return next;
  }

  throw new Error("500 page turns without reaching the book's end");
}

function lastOf(events: readonly EventRecord[], name: string): unknown {
  const matching = events.filter((event) => event.name === name);
  return matching[matching.length - 1]?.payload;
}

function countOf(events: readonly EventRecord[], name: string): number {
  return events.filter((event) => event.name === name).length;
}
