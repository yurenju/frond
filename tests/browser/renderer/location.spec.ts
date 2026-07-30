import { expect, test } from "@playwright/test";
import { compareCfi, parseCfi, serializeCfi } from "../../../src/epub/cfi.ts";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * Position: CFIs, fractions, and getting back after the layout changes.
 *
 * All three share one problem — **the layout changes and the position must not**. Change
 * the viewport, adjust the font size, change the column count and the page number is
 * certainly different, but the passage the reader was reading has to still be in front of
 * them. So nearly every assertion below is shaped as "the text measured" rather than "the
 * page number measured".
 */

const LARGE = { fontSize: 64 };

/** How many characters to take when comparing a restored position. Long enough to identify the passage, short enough not to span too many nodes. */
const SAMPLE = 12;

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("the current position's CFI", () => {
  test("points at the text at the very start of this page", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");

    const text = await page.evaluate(
      ([cfi, length]) => window.frond.textAt(cfi as string, length as number),
      [location.cfi, SAMPLE] as const,
    );

    // The fixture's first section starts with the title 朝の光.
    expect(text).toContain("朝の光");
  });

  test("the CFI carries this section's index on the readingOrder", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    const location = await page.evaluate(() => window.frond.goToSection(1));

    const cfi = parseCfi(location.cfi);
    // `/6/4` — the spine is the package document's third element (`/6`), and the second
    // itemref is `/4`.
    expect(serializeCfi(cfi)).toMatch(/^epubcfi\(\/6\/4/);
  });

  test("turning a page changes the CFI, and forwards", async ({ page }) => {
    const first = await mountFixture(page, "vertical-japanese", { settings: LARGE });
    const second = await page.evaluate(() => window.frond.next());

    expect(second.cfi).not.toBe(first.cfi);
    // Two adjacent pages' positions have to come in the book's order. This is one of the
    // self-consistency invariants ADR-0004 lists, and it **needs no agreement between the
    // three engines** — each holding on its own terms is enough.
    expect(comparison(first.cfi, second.cfi)).toBe("before");
  });
});

test.describe("returning to a position from a CFI", () => {
  test("CFI → go there → CFI is the identity", async ({ page }) => {
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

  test("an unrecognizable CFI does nothing and throws nothing", async ({ page }) => {
    // A new edition of the book, or a CFI from another reader — both arrive here, and the
    // response to neither is interrupting the reading.
    const before = await mountFixture(page, "vertical-japanese");
    const after = await page.evaluate(() =>
      window.frond.goToCfi("epubcfi(/6/999!/4/2/1:0)"),
    );

    expect(after.sectionIndex).toBe(before.sectionIndex);
    expect(after.page).toBe(before.page);
  });

  test("a broken CFI string likewise throws nothing", async ({ page }) => {
    const before = await mountFixture(page, "vertical-japanese");
    const after = await page.evaluate(() => window.frond.goToCfi("this is not a CFI"));

    expect(after.cfi).toBe(before.cfi);
  });

  test("goes to the section and anchor a TOC entry points at", async ({ page }) => {
    // user story 26. What it takes is **a path inside the archive** (`TocItem.target.path`'s
    // shape) rather than a verbatim href — the `%2c` and `../` normalization was already
    // done at the `EpubBook` layer (ADR-0002: one normalization implemented once).
    await mountFixture(page, "nested-toc");

    // The path is taken from the book rather than copied out as a literal in the test: the
    // content directory's name is a generator detail, and copying it would make this go red
    // somewhere unrelated to the question the moment it changes.
    const second = await page.evaluate(() => window.frond.goToSection(1));
    await page.evaluate(() => window.frond.goToSection(0));

    const location = await page.evaluate(
      (path) => window.frond.goTo(path as string, "part-2-1"),
      second.sectionPath,
    );

    expect(location.sectionIndex).toBe(1);
  });
});

test.describe("whole-book progress", () => {
  test("there is no fraction before the whole-book index is built", async ({ page }) => {
    // user story 25: the scrubber should be disabled until then, rather than drawn at a
    // wrong value.
    const initial = await mountFixture(page, "vertical-japanese");
    expect(initial.fraction).toBeNull();

    const characters = await page.evaluate(() => window.frond.waitForIndex());
    expect(characters).toBeGreaterThan(0);

    const ready = await page.evaluate(() => window.frond.snapshot());
    expect(ready.fraction).not.toBeNull();
  });

  test("the first page is 0 and the book's end approaches 1", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.waitForIndex());

    expect((await page.evaluate(() => window.frond.snapshot())).fraction).toBe(0);

    const last = await page.evaluate(() => window.frond.goToSection(2));
    expect(last.fraction).toBeGreaterThan(0.5);
  });

  test("turning forward never moves the progress backwards", async ({ page }) => {
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

  test("going to a position from a progress value", async ({ page }) => {
    // user story 24: releasing the scrubber really has to go there.
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.waitForIndex());

    const location = await page.evaluate(() => window.frond.goToFraction(0.5));

    expect(location.fraction).toBeGreaterThan(0.3);
    expect(location.fraction).toBeLessThan(0.7);
  });

  /**
   * A read-only query (user story 23).
   *
   * While the scrubber is being dragged, the chapter title at the landing point has to be
   * shown, and the reader has not let go yet — the view must not move. Without this,
   * `goToFraction()` is the consumer's only option, and every notch of the drag really
   * jumps.
   */
  test("querying which section a progress falls in does not move the view", async ({ page }) => {
    const before = await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.waitForIndex());

    const at = await page.evaluate(() => window.frond.locate(0.9));

    expect(at).not.toBeNull();
    expect(at!.sectionIndex).toBeGreaterThan(0);
    // A consumer maps the TOC back to sections by path, so that slot has to line up.
    expect(at!.sectionPath).not.toBe("");
    expect(at!.charactersIntoSection).toBeGreaterThanOrEqual(0);

    const after = await page.evaluate(() => window.frond.snapshot());
    expect(after.sectionIndex).toBe(before.sectionIndex);
    expect(after.page).toBe(before.page);
  });

  /**
   * Whether `locate()` is usable and whether `location.fraction` has a value happen at
   * **the same moment**.
   *
   * The scrubber needs both: `fraction` decides where the thumb is drawn, `locate()`
   * decides which chapter is shown during the drag. With one available and the other not,
   * the scrubber sits in an intermediate state nobody designed.
   *
   * The criterion is written as "the two agree" rather than "`locate()` is null right after
   * mounting": how fast the index builds depends on how many sections the book has and how
   * fast the machine is, and pinning "not ready yet" would make this test flaky on small
   * books. Both values are taken **within one evaluate**, so no index completion can slip in
   * between.
   */
  test("locate and fraction become usable together", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const before = await page.evaluate(() => ({
      fraction: window.frond.snapshot().fraction,
      at: window.frond.locate(0.5),
    }));
    expect(before.at === null).toBe(before.fraction === null);

    await page.evaluate(() => window.frond.waitForIndex());

    const after = await page.evaluate(() => ({
      fraction: window.frond.snapshot().fraction,
      at: window.frond.locate(0.5),
    }));
    expect(after.fraction).not.toBeNull();
    expect(after.at).not.toBeNull();
  });

  test("the section queried matches the section landed on", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.waitForIndex());

    const at = await page.evaluate(() => window.frond.locate(0.6));
    const landed = await page.evaluate(() => window.frond.goToFraction(0.6));

    expect(landed.sectionIndex).toBe(at!.sectionIndex);
    expect(landed.sectionPath).toBe(at!.sectionPath);
  });

  test("a section with no characters at all does not turn the progress into NaN", async ({ page }) => {
    // `empty-and-image-only-sections`'s second section is empty and its third holds only an
    // image.
    await mountFixture(page, "empty-and-image-only-sections");
    await page.evaluate(() => window.frond.waitForIndex());

    const location = await page.evaluate(() => window.frond.goToSection(1));

    expect(location.fraction).not.toBeNull();
    expect(Number.isNaN(location.fraction)).toBe(false);
  });
});

test.describe("opening a book lands where reading left off", () => {
  /**
   * Calling `goToCfi()` after `attach()` also lands in the right place — the difference is
   * that it **laid out twice**.
   *
   * So this group's criterion is the mount count (the `load` event) rather than where it
   * ends up. Verifying only the position would stay green with `start` implemented as
   * "render section 0 first, then jump", and that route is exactly what this field exists
   * to eliminate.
   */
  test("starting from a CFI mounts only once", async ({ page }) => {
    const first = await mountFixture(page, "vertical-japanese");
    const target = await page.evaluate(() => window.frond.goToSection(2));

    const reopened = await mountFixture(page, "vertical-japanese", {
      start: { cfi: target.cfi },
    });

    expect(reopened.sectionIndex).toBe(2);
    expect(reopened.sectionIndex).not.toBe(first.sectionIndex);

    const loads = (await page.evaluate(() => window.frond.events())).filter(
      (record) => record.name === "load",
    );
    expect(loads).toHaveLength(1);
  });

  test("starting from a section index", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese", {
      start: { sectionIndex: 1 },
    });

    expect(location.sectionIndex).toBe(1);
    expect(location.page).toBe(0);
  });

  /**
   * A new edition of the book, or progress from another reader — both arrive here, and the
   * response is not to interrupt the opening.
   */
  test("an unrecognizable CFI falls back to section 0 page 1 without throwing", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese", {
      start: { cfi: "epubcfi(/6/999!/4/2/1:0)" },
    });

    expect(location.sectionIndex).toBe(0);
    expect(location.page).toBe(0);
  });

  test("an out-of-range section index also falls back to the start", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese", {
      start: { sectionIndex: 99 },
    });

    expect(location.sectionIndex).toBe(0);
  });
});

test.describe("returning to the position after a layout change", () => {
  /**
   * What this group asks is "**is the passage just being read still in front of me**",
   * not "did the page number change".
   *
   * The page number certainly changes — a different viewport or font size means a different
   * amount fits on a page. Nor can it ask "is that passage still at the top of the page":
   * with smaller text a page holds more, so a passage that started page two lands in the
   * middle of page one, and that is the **correct** behaviour. The only defensible
   * assertion is that it is still visible.
   */
  test("after resizing, the passage just being read is still on screen", async ({ page }) => {
    // user story 32.
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.next());

    const marked = await page.evaluate(() => window.frond.snapshot());
    await page.evaluate(() => window.frond.resize(600, 500));

    expect(await isOnScreen(page, marked.cfi)).toBe(true);
  });

  test("after changing the font size, the passage just being read is still on screen", async ({ page }) => {
    // user story 19: not thrown back to this section's start.
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    await page.evaluate(() => window.frond.next());

    const marked = await page.evaluate(() => window.frond.snapshot());
    const before = await textAtCurrent(page);
    await page.evaluate(() => window.frond.applySettings({ fontSize: 40 }));

    expect(await isOnScreen(page, marked.cfi)).toBe(true);
    // And it was not thrown back to this section's start — that passage differs from the
    // section's first.
    expect(before).not.toContain("朝の光");
  });

  test("changing the column count also gets back", async ({ page }) => {
    await mountFixture(page, "huge-single-section", { settings: { columns: 1 } });
    for (let step = 0; step < 3; step += 1) {
      await page.evaluate(() => window.frond.next());
    }

    const marked = await page.evaluate(() => window.frond.snapshot());
    await page.evaluate(() => window.frond.applySettings({ columns: 2 }));

    expect(await isOnScreen(page, marked.cfi)).toBe(true);
  });
});

test.describe("a range's rectangles", () => {
  test("rectangles with area come back, in container coordinates", async ({ page }) => {
    // user story 49: the consumer draws the highlight; frond only supplies the geometry
    // (ADR-0002).
    const location = await mountFixture(page, "vertical-japanese");

    const rects = await page.evaluate(
      (cfi) => window.frond.rectsFor(cfi as string),
      location.cfi,
    );

    expect(rects.length).toBeGreaterThan(0);
    expect(rects[0]!.width).toBeGreaterThan(0);
    expect(rects[0]!.height).toBeGreaterThan(0);
  });

  test("a position outside this section returns an empty array", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const rects = await page.evaluate(() =>
      window.frond.rectsFor("epubcfi(/6/6!/4/2/1:0)"),
    );

    expect(rects).toEqual([]);
  });

  /**
   * **This pins the status quo, and it is a shape a consumer has to know about.**
   *
   * "Not in this section" and "in this section but on another page" are two different
   * answers: the first is an empty array, and this one is real rectangles **outside the
   * container**. Pages are made by scrolling one long multi-column layout, so a position on
   * a later page simply has a large coordinate.
   *
   * Reporting the true geometry is the fact frond owns; which rectangles to draw is a
   * clipping policy and belongs to the consumer (ADR-0002). Without this test the
   * distinction lives only in a doc comment, and the symptom of a consumer missing it is a
   * highlight painted outside the page.
   */
  test("a position in this section but on another page comes back outside the container", async ({
    page,
  }) => {
    await mountFixture(page, "vertical-japanese", { settings: LARGE });
    const second = await page.evaluate(() => window.frond.next());
    await page.evaluate(() => window.frond.previous());

    const [rects, size] = await Promise.all([
      page.evaluate((cfi) => window.frond.rectsFor(cfi as string), second.cfi),
      page.evaluate(() => window.frond.containerSize()),
    ]);

    // Not empty — the position is in this section, and it has real geometry.
    expect(rects.length).toBeGreaterThan(0);
    // And that geometry is off the page the reader is on. Both axes are checked because
    // which one pages advance along depends on the writing mode (`geometry.ts`).
    const first = rects[0]!;
    const onScreen =
      first.x >= 0 && first.y >= 0 && first.x < size.width && first.y < size.height;
    expect(onScreen).toBe(false);
  });
});

/**
 * Is this position visible right now.
 *
 * The criterion is its rectangle falling within the container. Content not on the current
 * page is scrolled away, so its coordinates are negative or beyond the container — which
 * is steadier than "the page numbers are equal", because a layout change changes the page
 * number by construction.
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
 * Which of two CFIs comes first.
 *
 * It goes through the grammar layer's implementation (`src/epub/cfi.ts`) rather than
 * reimplementing the comparison here — reimplemented, this test would end up verifying its
 * own implementation.
 */
function comparison(left: string, right: string): string {
  return compareCfi(parseCfi(left), parseCfi(right));
}
