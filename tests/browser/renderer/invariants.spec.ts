import { expect, test } from "@playwright/test";
import { compareCfi, parseCfi } from "../../../src/epub/cfi.ts";
import { mountFixture, openHarness, type Snapshot } from "../support/harness.js";

/**
 * Self-consistency invariants within one browser — the slot ADR-0004's #7 revision names.
 *
 * > When vertical, page counts, break positions and anything derived from them (page
 * > numbers, characters per page) are excluded from cross-browser comparison. That slot is
 * > instead guarded by **self-consistency invariants within one browser**: turning to the
 * > end and back leaves the position unchanged, adjacent pages' boundary characters are
 * > contiguous in document order, CFI → page → CFI is the identity, and a CFI returns to
 * > the same passage after a font-size change.
 *
 * Those four follow. **Each holds in each engine on its own terms, with no need for the
 * three to produce the same number** — the three engines' multicol fragmentation does not
 * agree by construction (Chromium lays out 4 pages while Firefox and WebKit lay out 3
 * each, on one fixture, one viewport and one set of settings).
 *
 * It is also why this spec contains not one hard-coded page count.
 */

const LARGE = { fontSize: 64 };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test("turning to the book's end and back returns to the same position at every step", async ({ page }) => {
  await mountFixture(page, "vertical-japanese", { settings: LARGE });

  const forward: Snapshot[] = [await page.evaluate(() => window.frond.snapshot())];
  while (!forward[forward.length - 1]!.atEnd && forward.length < 200) {
    forward.push(await page.evaluate(() => window.frond.next()));
  }

  expect(forward.length).toBeGreaterThan(3);
  expect(forward[forward.length - 1]!.atEnd).toBe(true);

  // The return trip. Every step has to land on the outbound trip's same position — right
  // down to an identical CFI.
  for (let step = forward.length - 2; step >= 0; step -= 1) {
    const back = await page.evaluate(() => window.frond.previous());

    expect(back.sectionIndex, `section at step ${step}`).toBe(forward[step]!.sectionIndex);
    expect(back.page, `page at step ${step}`).toBe(forward[step]!.page);
    expect(back.cfi, `CFI at step ${step}`).toBe(forward[step]!.cfi);
  }
});

test("adjacent pages' positions are strictly increasing in the book", async ({ page }) => {
  // The assertable form of "adjacent pages' boundary characters are contiguous in document
  // order": the next page's start has to come after this page's. Going backwards means
  // pagination reordered the content; being equal means a page did not advance, which means
  // content was skipped or duplicated.
  await mountFixture(page, "huge-single-section", { settings: { columns: 1 } });

  let previous = await page.evaluate(() => window.frond.snapshot());

  for (let step = 0; step < 20; step += 1) {
    const current = await page.evaluate(() => window.frond.next());
    if (current.sectionIndex !== previous.sectionIndex) break;

    expect(
      compareCfi(parseCfi(previous.cfi), parseCfi(current.cfi)),
      `page ${previous.page} to page ${current.page}`,
    ).toBe("before");

    previous = current;
    if (current.atEnd) break;
  }

  expect(previous.page).toBeGreaterThan(3);
});

test("CFI → go there → CFI is the identity, on every page", async ({ page }) => {
  await mountFixture(page, "vertical-japanese", { settings: LARGE });

  const marks: Snapshot[] = [];
  let current = await page.evaluate(() => window.frond.snapshot());
  while (!current.atEnd && marks.length < 30) {
    marks.push(current);
    current = await page.evaluate(() => window.frond.next());
  }
  marks.push(current);

  for (const mark of marks) {
    // Go somewhere else first, so this is not "it was already sitting there".
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

test("after a font-size change, a CFI returns to the same passage", async ({ page }) => {
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

  // The same CFI still points at the same passage after relayout — **a CFI is not a
  // function of the layout**.
  expect(after).toBe(before);
  expect(after).not.toBeNull();
});

test("a section's page count matches the pages that can actually be turned to", async ({ page }) => {
  // The page count is not for comparing across browsers, but within one it has to tell the
  // truth: reporting N pages means page N−1 is exactly reachable, and the section changes
  // after page N−1.
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
