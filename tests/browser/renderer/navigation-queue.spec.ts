import { expect, test, type Page } from "@playwright/test";
import { openHarness, type EventRecord, type SettingsPatch } from "../support/harness.js";

/**
 * The semantics of rapid operations: page turns accumulate, setting changes replace.
 *
 * ## Why this layer is needed
 *
 * A cross-section operation has an await in the middle (attaching the iframe, waiting for
 * fonts), and **the consumer does not wait**. frond originally recognized stale loads with
 * a generation counter, which guarded "no leftover iframes" but not "N presses advance N
 * times": pressing twice at a section boundary, the second read a view that was still the
 * old one, and the two inputs advanced by one section.
 *
 * This slot is barely visible with keys alone, and is the norm once swipe-to-turn is wired
 * up.
 *
 * ## Two semantics, not one
 *
 * Queueing everything is wrong: dragging a margin slider fires one `applySettings` per
 * `input` notch, and running each of them to completion serially freezes the slider. What
 * that side wants is "only the last one counts". So the two describes below verify
 * **opposite** behaviours, and both are right.
 */

/** One paragraph per section, each fitting one page — so "turning a page" equals "changing section", with no ambiguity in the counting. */
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

test.describe("page turns accumulate", () => {
  /**
   * This is the ticket's core invariant.
   *
   * **It is only measurable without awaiting each in turn** — awaiting each leaves the queue
   * with a single occupant, and this test stays green when the regression happens.
   */
  test("N presses of \"next page\" at a section boundary advance N sections", async ({ page }) => {
    await page.evaluate(
      ([sections]) => window.frond.mountInline(sections as string[], {}),
      [shortSections(6)] as const,
    );

    const after = await page.evaluate(() => window.frond.rapidNext(4));
    expect(after.sectionIndex).toBe(4);
  });

  test("pressing on past the book's end stops there, without wrapping round or throwing", async ({ page }) => {
    await page.evaluate(
      ([sections]) => window.frond.mountInline(sections as string[], {}),
      [shortSections(3)] as const,
    );

    const after = await page.evaluate(() => window.frond.rapidNext(8));
    expect(after.sectionIndex).toBe(2);
    expect(after.atEnd).toBe(true);
  });

  /**
   * A queued page turn **must not** emit a relocate belonging to the old section.
   *
   * Without a queue, the second `next()` moves a page on the old view and emits a relocate,
   * only to be overwritten when the new section lands. A consumer saves relocate as reading
   * progress, so that entry is a position that no longer holds — and it comes before the
   * correct one, so it looks like nothing more than "saved one extra time".
   */
  test("every relocate's section and page move forward, never backwards", async ({ page }) => {
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

test.describe("setting changes replace", () => {
  /**
   * The slider-dragging shape: N `applySettings` in a row, of which only the last should
   * actually lay out.
   *
   * The criterion is the number of `load` events rather than where it ends up — "the last
   * one takes effect" also holds under a pure queue, differing only in the N-1 complete
   * mounts done for nothing in between, and those are exactly what freezes the slider. So
   * this test measures **how many times it happened**.
   */
  test("N setting changes in a row do not lay out N times", async ({ page }) => {
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

    // Far fewer land than were issued. The threshold is half rather than a hard-coded 2: the
    // first may already have started running when the second arrived, and that one should not
    // count as a regression.
    expect((await loadCount(page)) - before).toBeLessThan(patches.length / 2);
  });

  /**
   * **The settings themselves accumulate; only the layout is replaced.**
   *
   * This is the most expensive slot when the two semantics get confused: if the whole
   * `applySettings` is deferred into the queue, the ones a later call replaces never even
   * apply their patch, so "adjust the size, then the margin" silently drops the size. The
   * symptom is settings going missing when the slider is dragged fast and behaving when
   * dragged slowly.
   */
  test("the coalesced calls still apply their settings", async ({ page }) => {
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

    // All three have to be on the final screen, not just the last one.
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
