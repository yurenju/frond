import { expect, test, type Page } from "@playwright/test";
import { parseCfi } from "../../../src/epub/cfi.ts";
import { mountFixture, openHarness, type EventRecord } from "../support/harness.js";

/**
 * Selection and annotation geometry (user stories 47–51).
 *
 * frond supplies only **facts and geometry**: which passage the reader selected (a range
 * CFI), and which rectangles that passage currently occupies. Colours, styles, animations,
 * whether to pop up a toolbar — all of it is the consumer's policy (ADR-0002).
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("selection events", () => {
  test("selecting a passage emits an event carrying a range CFI (user story 48)", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));

    const event = await waitForSelection(page);

    expect(event.text.length).toBeGreaterThan(0);
    expect(event.cfi).not.toBeNull();

    // **A range, not a point.** An annotation marks a passage, and the spec spells points
    // and ranges differently — mixing them leaves the consumer unable to tell which one it
    // is holding.
    expect(parseCfi(event.cfi!).kind).toBe("range");
  });

  test("clearing the selection emits an event too, rather than nothing", async ({ page }) => {
    // The consumer dismisses its floating toolbar from it, and "no event" cannot express
    // that.
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));
    await waitForSelection(page);

    await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      (frame as HTMLIFrameElement).contentDocument?.getSelection()?.removeAllRanges();
    });

    // An `undefined` field disappears entirely across `page.evaluate`'s boundary, so the
    // criterion is "does the last selection event carry a CFI" rather than a null
    // comparison.
    await expect
      .poll(async () => ((await lastSelection(page))?.cfi ?? null) === null)
      .toBe(true);
  });
});

test.describe("the selection event carries its own geometry", () => {
  /**
   * The event's `rects` and `rectsFor(event.cfi)` answer the same question, and the event's
   * are the ones that did not go through a round trip: frond holds the live `Range` at the
   * moment it emits, while the consumer would have to parse back the CFI just serialized and
   * walk the DOM again to recover the same rectangles.
   *
   * A floating toolbar is placed against these, so "the event alone is enough to place it" is
   * the property worth pinning.
   */
  test("the rectangles arrive with the event, matching what rectsFor gives for the same CFI", async ({
    page,
  }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));

    const event = await waitForSelection(page);
    const viaCfi = await page.evaluate(
      (cfi) => window.frond.rectsFor(cfi as string),
      event.cfi!,
    );

    expect(event.rects.length).toBeGreaterThan(0);
    expect(event.rects.length).toBe(viaCfi.length);
    for (const [index, rect] of event.rects.entries()) {
      // Rounded before comparing: the two measurements are taken at different moments, and
      // sub-pixel drift between them is not what this is about.
      expect(Math.round(rect.x)).toBe(Math.round(viaCfi[index]!.x));
      expect(Math.round(rect.y)).toBe(Math.round(viaCfi[index]!.y));
      expect(Math.round(rect.width)).toBe(Math.round(viaCfi[index]!.width));
      expect(Math.round(rect.height)).toBe(Math.round(viaCfi[index]!.height));
    }
  });

  test("clearing the selection carries an empty list, not the previous rectangles", async ({
    page,
  }) => {
    // A consumer dismissing its toolbar reads the same event; stale rectangles here would
    // draw it one more time at the old position.
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));
    await waitForSelection(page);

    await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      (frame as HTMLIFrameElement).contentDocument?.getSelection()?.removeAllRanges();
    });

    await expect
      .poll(async () => (await lastSelection(page))?.rects?.length ?? -1)
      .toBe(0);
  });
});

test.describe("annotation geometry", () => {
  test("the selected passage yields rectangles (user story 49)", async ({ page }) => {
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

  test("rectangles land in the right place on a vertical book too (user story 51)", async ({ page }) => {
    // A passage in a vertical layout is **tall**: greater in height than in width.
    // Horizontal is the reverse. This case separates "the rectangles were computed for the
    // writing mode" from "the rectangles were computed horizontally and happen to have
    // values".
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));
    const vertical = await firstRect(page);

    await mountFixture(page, "huge-single-section");
    await page.evaluate(() => window.frond.selectText("p"));
    const horizontal = await firstRect(page);

    expect(vertical.height).toBeGreaterThan(vertical.width);
    expect(horizontal.width).toBeGreaterThan(horizontal.height);
  });

  test("the rectangles update with a page turn (user story 50)", async ({ page }) => {
    // A highlight must not linger in the wrong place. The criterion is that one CFI's
    // rectangles fall outside the container when "it is not on this page" and inside when
    // "it is on this page".
    await mountFixture(page, "vertical-japanese", { settings: { fontSize: 64 } });

    const second = await page.evaluate(() => window.frond.next());
    expect(second.page).toBe(1);
    const onSecondPage = await firstRectOf(page, second.cfi);

    const back = await page.evaluate(() => window.frond.previous());
    expect(back.page).toBe(0);
    const fromFirstPage = await firstRectOf(page, second.cfi);

    const size = await page.evaluate(() => window.frond.containerSize());

    // Sitting on page 2 it is on screen; back on page 1, the same CFI's rectangle is pushed
    // off screen.
    expect(onSecondPage.y).toBeGreaterThanOrEqual(0);
    expect(onSecondPage.y).toBeLessThan(size.height);
    expect(fromFirstPage.y).toBeGreaterThanOrEqual(size.height);
  });
});

interface SelectionPayload {
  readonly cfi: string | null;
  readonly text: string;
  /**
   * A `DOMRect` does not survive `page.evaluate`'s boundary as a `DOMRect` — what arrives is
   * a plain object with the same fields, which is all this side reads.
   */
  readonly rects: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
}

/** Waits for a selection event carrying a CFI. `selectionchange` is asynchronous. */
async function waitForSelection(page: Page): Promise<SelectionPayload> {
  await expect
    .poll(async () => ((await lastSelection(page))?.cfi ?? null) !== null)
    .toBe(true);

  const payload = await lastSelection(page);
  if (payload === undefined) throw new Error("no selection event arrived");
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
  if (first === undefined) throw new Error(`${cfi} has no rectangles at all`);
  return first;
}
