import { expect, test, type Page } from "@playwright/test";
import { mountFixture, openHarness, type EventRecord } from "../support/harness.js";

/**
 * The `layout` event: "the geometry is valid again, recompute".
 *
 * `rectsFor()` answers **which rectangles a range occupies**, and a consumer drawing its own
 * highlight layer needs a second answer alongside it — **when those rectangles stop being
 * true**. Before this event existed, one of the three routes that move every rectangle sent
 * no signal at all:
 *
 * | Route | `load` | `relocate` |
 * | --- | --- | --- |
 * | a section loads | yes | yes |
 * | `applySettings()` | yes (the document is rebuilt) | de-duplicated away on page 0 |
 * | `relayout()` | **no** — it only lays out again | de-duplicated away on page 0 |
 *
 * The resize row is the fatal one, because resizing is what frond's own `ResizeObserver`
 * fires: opening a side panel over a highlight is a container resize, so "the interaction a
 * highlight exists for" landed on the one route with no signal.
 *
 * `relocate`'s de-duplication is **correct** and untouched by this — the reader really did
 * not move. What was missing was a separate fact, and this spec measures it on all three
 * routes.
 */

/** The container both before and after the measurement below. Vertical, so pages advance along y and the rectangles move along x. */
const WIDE = { width: 600, height: 800 };
const NARROW = { width: 400, height: 800 };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("layout is emitted on every route that moves the geometry", () => {
  test("a section finishing its load emits layout, after load and before relocate", async ({
    page,
  }) => {
    const location = await mountFixture(page, "vertical-japanese");

    const names = (await events(page)).map((record) => record.name);
    expect(names).toContain("layout");
    // `load` says a new section is up; `layout` says its geometry is valid. Two questions,
    // and this order is the one a consumer can rely on.
    expect(names.indexOf("load")).toBeLessThan(names.indexOf("layout"));
    expect(names.indexOf("layout")).toBeLessThan(names.indexOf("relocate"));

    expect(lastLayout(await events(page))).toEqual({
      writingMode: "vertical-rl",
      pageCount: location.pageCount,
    });
  });

  test("applySettings emits layout once the rebuild has landed", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");
    await waitForIndex(page);

    const before = await countOf(page, "layout");
    const wide = await rectXFor(page, location.cfi);

    const after = await page.evaluate(() => window.frond.applySettings({ margin: 80 }));

    // The margin moved every rectangle, and the section's page count with it.
    expect(await rectXFor(page, location.cfi)).not.toBe(wide);
    expect(await countOf(page, "layout")).toBeGreaterThan(before);
    expect(lastLayout(await events(page))).toEqual({
      writingMode: "vertical-rl",
      pageCount: after.pageCount,
    });
  });

  /**
   * **The route that used to be silent.**
   *
   * Measured on a `vertical-japanese` at margin 24, narrowing the container from 600 to 400
   * while staying on page 0: the first rectangle's x moves by exactly the 200 the container
   * lost, and before this event the whole event sequence was unchanged — not one signal for
   * a highlight layer to redraw on.
   */
  test("resizing emits layout even though the position did not change", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese", {
      settings: { margin: 24 },
      viewport: WIDE,
    });
    // The index is awaited first: `indexed` emits a relocate of its own (`fraction` gains a
    // value), and letting that race the resize would make the relocate count below mean
    // nothing.
    await waitForIndex(page);

    const wide = await rectXFor(page, location.cfi);
    const layoutsBefore = await countOf(page, "layout");
    const relocatesBefore = await countOf(page, "relocate");

    const after = await page.evaluate(
      ([size]) => window.frond.resize(size!.width, size!.height),
      [NARROW] as const,
    );

    // The geometry really did move: same CFI, same page, a different rectangle.
    expect(after.page).toBe(location.page);
    expect(after.cfi).toBe(location.cfi);
    expect(await rectXFor(page, location.cfi)).not.toBe(wide);

    // And that move is now announced.
    expect(await countOf(page, "layout")).toBeGreaterThan(layoutsBefore);
    expect(lastLayout(await events(page))).toEqual({
      writingMode: "vertical-rl",
      pageCount: after.pageCount,
    });

    // **`relocate` stayed silent, and that is correct.** The reader did not move, and its
    // de-duplication is what stops a consumer from writing the same progress to the cloud
    // twice. Weakening it to carry the geometry would have pushed that de-duplication onto
    // every consumer.
    expect(await countOf(page, "relocate")).toBe(relocatesBefore);
  });

  test("turning a page emits no layout — nothing was laid out again", async ({ page }) => {
    // The counterweight to the three cases above: a `layout` on every page turn would make
    // the event meaningless as an invalidation, and a consumer would recompute its whole
    // highlight layer on each turn for nothing.
    await mountFixture(page, "vertical-japanese", { settings: { fontSize: 64 } });
    await waitForIndex(page);

    const before = await countOf(page, "layout");
    await page.evaluate(() => window.frond.next());

    expect(await countOf(page, "layout")).toBe(before);
  });
});

function events(page: Page): Promise<readonly EventRecord[]> {
  return page.evaluate(() => window.frond.events());
}

async function countOf(page: Page, name: string): Promise<number> {
  return (await events(page)).filter((record) => record.name === name).length;
}

/**
 * The most recent `layout` payload.
 *
 * The **last** one rather than the only one: frond's own `ResizeObserver` fires on a
 * container size change as well, so a resize legitimately produces more than one layout pass
 * (they coalesce, but not always into a single one). What matters is that at least one
 * arrives and that it describes the geometry now on screen.
 */
function lastLayout(records: readonly EventRecord[]): unknown {
  return records.filter((record) => record.name === "layout").at(-1)?.payload;
}

function waitForIndex(page: Page): Promise<number> {
  return page.evaluate(() => window.frond.waitForIndex());
}

/** The x of the first rectangle a CFI occupies, in container coordinates. */
async function rectXFor(page: Page, cfi: string): Promise<number | undefined> {
  const rects = await page.evaluate(
    (value) => window.frond.rectsFor(value as string),
    cfi,
  );
  return rects[0]?.x;
}
