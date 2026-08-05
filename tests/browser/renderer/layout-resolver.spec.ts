import { expect, test, type Page } from "@playwright/test";
import {
  mountFixture,
  openHarness,
  type EventRecord,
  type LayoutCall,
  type MountOptions,
  type Rect,
} from "../support/harness.js";

/**
 * `resolveLayout` — the layout settings answered from the facts of the layout itself.
 *
 * ## The gap it closes
 *
 * The writing mode is declared in the book's stylesheet and settled by the browser, so
 * frond has no answer for it until the document is displayed (`writing-mode.ts`). A
 * consumer whose margin depends on it — a line-length ceiling falls on the **inline** axis,
 * which is horizontal in one mode and vertical in the other — therefore had nowhere to
 * compute that margin:
 *
 * | When | What is known | What is wrong with deciding here |
 * | --- | --- | --- |
 * | before `attach()` | nothing about this book's layout | the fact does not exist yet |
 * | the first `load` | the writing mode | the position has already been restored, so correcting the margin lays out a second time — and the reader lands somewhere else in the section |
 *
 * The consumer that walked into this (spine) answered it with a `localStorage` cache of
 * what the book laid out as last time. That is a guess dressed as a fact: right most of the
 * time, wrong on the first open of every vertical book, and one more piece of device state
 * to delete along with the book.
 *
 * So the fact is handed over **at the moment frond has it and before it lays anything
 * out**, and the consumer answers with policy (ADR-0002). What this spec measures is that
 * the answer is in force for the **first** layout — the whole point — and that it is asked
 * again on every later one, since neither fact is a property of the book.
 */

/** The container these tests measure against. */
const CONTAINER = { width: 800, height: 600 };

/**
 * One answer per writing mode, and **deliberately different numbers**.
 *
 * A table answering both modes alike would pass whichever way round the two are landed on
 * the four physical edges — which is the mistake this feature exists to make impossible.
 */
const BY_WRITING_MODE: MountOptions["resolveLayout"] = {
  "vertical-rl": { margin: { block: 10, inline: 60 } },
  "horizontal-tb": { margin: { block: 4, inline: 24 } },
};

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("the first layout already has the answer", () => {
  test("a vertical book is laid out to the vertical margin, in one layout", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", {
      viewport: CONTAINER,
      resolveLayout: BY_WRITING_MODE,
    });

    // Vertical: `inline` is the vertical axis, so it lands on top and bottom.
    expect(await frameBox(page)).toMatchObject({ x: 10, y: 60, width: 780, height: 480 });

    // **The count is the assertion.** A margin corrected after the first `load` reaches the
    // same box in the end; what it costs is a second layout, and a second layout under a
    // restored position is the defect this exists to avoid.
    expect(await countOf(page, "layout")).toBe(1);
  });

  test("a horizontal book is laid out to the horizontal margin, in one layout", async ({
    page,
  }) => {
    await mountFixture(page, "huge-single-section", {
      viewport: CONTAINER,
      resolveLayout: BY_WRITING_MODE,
    });

    expect(await frameBox(page)).toMatchObject({ x: 24, y: 4, width: 752, height: 592 });
    expect(await countOf(page, "layout")).toBe(1);
  });

  test("the facts are the writing mode and the container, before the margin comes off", async ({
    page,
  }) => {
    await mountFixture(page, "vertical-japanese", {
      viewport: CONTAINER,
      resolveLayout: BY_WRITING_MODE,
    });

    // The container rather than the iframe: the consumer is deciding how to divide that
    // space up, so handing it the space already divided would be circular.
    expect(await layoutCalls(page)).toEqual([
      { writingMode: "vertical-rl", viewport: CONTAINER },
    ]);
  });

  test("a mode the resolver has no answer for leaves the reader's settings standing", async ({
    page,
  }) => {
    await mountFixture(page, "huge-single-section", {
      viewport: CONTAINER,
      settings: { margin: 30 },
      resolveLayout: { "vertical-rl": { margin: { block: 10, inline: 60 } } },
    });

    expect(await frameBox(page)).toMatchObject({ x: 30, y: 30, width: 740, height: 540 });
  });

  test("the column count can be answered too", async ({ page }) => {
    // The other half of `LayoutSettings`. It is in there for the same reason as the margin:
    // "how long may a line be" and "is there room for two of them" are one question, and
    // both answers need the writing mode.
    await mountFixture(page, "huge-single-section", {
      viewport: CONTAINER,
      settings: { columns: 1 },
      resolveLayout: { "horizontal-tb": { columns: 2 } },
    });

    expect(await computed(page, "html", "column-count")).toBe("2");
  });
});

test.describe("it is asked again on every layout", () => {
  test("a section that lays out the other way round gets its own answer", async ({ page }) => {
    // **Sections of one book need not agree** — a full-page image divider that links no
    // stylesheet lays out horizontally in the middle of a vertical book. A resolver asked
    // once per book would give that section the other mode's margin, on the wrong two edges.
    await page.evaluate(
      ([sections, options]) =>
        window.frond.mountInline(sections as readonly string[], options as MountOptions),
      [
        [section({ vertical: false }), section({ vertical: true })],
        { viewport: CONTAINER, resolveLayout: BY_WRITING_MODE },
      ] as const,
    );

    expect(await frameBox(page)).toMatchObject({ x: 24, y: 4 });

    await page.evaluate(() => window.frond.goToSection(1));

    expect(await frameBox(page)).toMatchObject({ x: 10, y: 60 });
    expect((await layoutCalls(page)).map((call) => call.writingMode)).toEqual([
      "horizontal-tb",
      "vertical-rl",
    ]);
  });

  test("a container that changed size asks again, with the size it changed to", async ({
    page,
  }) => {
    // The viewport is a fact for the same reason the writing mode is: a line-length ceiling
    // is a function of it, so the answer at 800px wide is not the answer at 400px. Caching
    // the mount's answer would hold the first one for as long as the section stays mounted.
    await mountFixture(page, "vertical-japanese", {
      viewport: CONTAINER,
      resolveLayout: BY_WRITING_MODE,
    });

    await page.evaluate(() => window.frond.resize(400, 600));
    const calls = await layoutCalls(page);

    // The first and the last, not the count: frond's own `ResizeObserver` sees the container
    // change too, so how many times a resize lays out is the browser's business. What has to
    // hold is that the resolver was asked with the size the container ended up at.
    expect(calls.at(0)).toEqual({ writingMode: "vertical-rl", viewport: CONTAINER });
    expect(calls.at(-1)).toEqual({
      writingMode: "vertical-rl",
      viewport: { width: 400, height: 600 },
    });
  });

  test("relayout() asks again without the container having moved at all", async ({ page }) => {
    // The route with no other signal: the settings the resolver answers never pass through
    // `applySettings`, so when what changed is one of **its** inputs — the reader dragged a
    // margin slider the consumer turns into a margin itself — frond cannot see that anything
    // happened. This is how the consumer says so, and it costs no document rebuild.
    await mountFixture(page, "vertical-japanese", {
      viewport: CONTAINER,
      resolveLayout: BY_WRITING_MODE,
    });

    const loadsBefore = await countOf(page, "load");
    await page.evaluate(() => window.frond.relayout());

    expect(await layoutCalls(page)).toHaveLength(2);
    expect(await countOf(page, "load")).toBe(loadsBefore);
  });
});

/** A section that declares its writing mode itself, so that one book can carry both. */
function section({ vertical }: { vertical: boolean }): string {
  const style = vertical ? "<style>html { writing-mode: vertical-rl; }</style>" : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head><title>t</title>${style}</head>
  <body><p>本文がここにあります。</p></body>
</html>`;
}

async function frameBox(page: Page): Promise<Rect> {
  return page.evaluate(() => window.frond.frameBox());
}

async function layoutCalls(page: Page): Promise<readonly LayoutCall[]> {
  return page.evaluate(() => window.frond.layoutCalls());
}

async function countOf(page: Page, name: string): Promise<number> {
  const records: readonly EventRecord[] = await page.evaluate(() => window.frond.events());
  return records.filter((record) => record.name === name).length;
}

async function computed(page: Page, selector: string, property: string): Promise<string> {
  return page.evaluate(
    ([target, name]) => window.frond.computed(target as string, name as string),
    [selector, property] as const,
  );
}
