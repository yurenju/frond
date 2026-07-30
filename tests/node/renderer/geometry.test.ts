import { describe, expect, test } from "vitest";
import {
  blockExtentOf,
  inlineExtentOf,
  marginInsets,
  pageAt,
  pageAxisFor,
  pageCountFor,
  pageMetrics,
  pageOffsetFor,
  resolveColumns,
  type PageMetrics,
} from "../../../src/renderer/geometry.ts";

/**
 * Unit tests for the pagination arithmetic. This layer is pure functions, so it sits at
 * the bottom of the test pyramid (ADR-0009) — a boundary condition can be answered
 * without opening three browsers.
 *
 * The premise that "columns overflow along the inline axis" is not verified here; that
 * is browser behaviour, and `tests/browser/renderer/multicol-geometry.spec.ts` pins it
 * once per engine. What is verified here is **the arithmetic that follows from
 * accepting that premise**.
 */

const VIEWPORT = { width: 800, height: 600 };

describe("the pagination axis", () => {
  test("horizontal pages advance along x, vertical ones along y", () => {
    expect(pageAxisFor("horizontal-tb")).toBe("x");
    expect(pageAxisFor("vertical-rl")).toBe("y");
  });

  test("extent along the inline axis: width when horizontal, height when vertical", () => {
    expect(inlineExtentOf("horizontal-tb", VIEWPORT)).toBe(800);
    expect(inlineExtentOf("vertical-rl", VIEWPORT)).toBe(600);
  });

  test("the block axis is the inline axis's complement", () => {
    expect(blockExtentOf("horizontal-tb", VIEWPORT)).toBe(600);
    expect(blockExtentOf("vertical-rl", VIEWPORT)).toBe(800);
  });
});

describe("margins landing on physical edges", () => {
  test("a scalar means all four edges alike, regardless of writing mode", () => {
    const expected = { top: 24, right: 24, bottom: 24, left: 24 };
    expect(marginInsets(24, "horizontal-tb")).toEqual(expected);
    expect(marginInsets(24, "vertical-rl")).toEqual(expected);
  });

  test("horizontal: the inline axis is left and right, the block axis top and bottom", () => {
    expect(marginInsets({ block: 16, inline: 48 }, "horizontal-tb")).toEqual({
      top: 16,
      right: 48,
      bottom: 16,
      left: 48,
    });
  });

  /**
   * When vertical, the inline axis **is the vertical one** (characters run top to bottom),
   * so `inline` gives top and bottom.
   *
   * Getting this slot backwards raises no error: the margins still shrink, it is just that
   * what the reader is adjusting becomes the invisible gutter between pages while the line
   * length does not move at all. Which reads as "the slider does nothing".
   */
  test("vertical: the inline axis is top and bottom, the block axis left and right — the opposite of horizontal", () => {
    expect(marginInsets({ block: 16, inline: 48 }, "vertical-rl")).toEqual({
      top: 48,
      right: 16,
      bottom: 48,
      left: 16,
    });
  });

  test("one axis-relative setting takes up the same total margin in both modes, just on swapped axes", () => {
    const horizontal = marginInsets({ block: 16, inline: 48 }, "horizontal-tb");
    const vertical = marginInsets({ block: 16, inline: 48 }, "vertical-rl");

    expect(horizontal.left + horizontal.right).toBe(vertical.top + vertical.bottom);
    expect(horizontal.top + horizontal.bottom).toBe(vertical.left + vertical.right);
  });
});

describe("column count", () => {
  test("vertical is always one column, even when the reader asks for two", () => {
    // ADR-0003's deliberate simplification. The reader's preference is not an error, it
    // just does not apply right now — so nothing is thrown.
    expect(resolveColumns("vertical-rl", 2, VIEWPORT)).toBe(1);
    expect(resolveColumns("vertical-rl", "auto", VIEWPORT)).toBe(1);
  });

  test("horizontal follows what the reader specified", () => {
    expect(resolveColumns("horizontal-tb", 1, VIEWPORT)).toBe(1);
    expect(resolveColumns("horizontal-tb", 2, VIEWPORT)).toBe(2);
  });

  test("auto decides on the available width, giving one column when narrow", () => {
    expect(resolveColumns("horizontal-tb", "auto", { width: 1200, height: 600 })).toBe(2);
    expect(resolveColumns("horizontal-tb", "auto", { width: 480, height: 600 })).toBe(1);
  });

  test("auto looks at the inline axis rather than width itself — vertical's inline axis is height", () => {
    // The vertical case is caught by the one-column rule first, so what this asks is that
    // "auto did not use height as width". A vertical viewport 1200 tall and 480 wide would
    // give one column on a width criterion and two on a height criterion. Neither is right
    // — vertical's answer is always 1.
    expect(resolveColumns("vertical-rl", "auto", { width: 480, height: 1200 })).toBe(1);
  });
});

describe("column setup", () => {
  test("horizontal, one column: the column width equals the available width, and the stride adds one gap", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: VIEWPORT,
      columns: 1,
      gap: 40,
    });

    expect(metrics.axis).toBe("x");
    expect(metrics.inlineSize).toBe(800);
    expect(metrics.blockSize).toBe(600);
    expect(metrics.columnWidth).toBe(800);
    expect(metrics.columnCount).toBe(1);
    // The next page's first column sits one page plus one gap away — that gutter falls
    // between two pages, where the reader never sees it.
    expect(metrics.stride).toBe(840);
  });

  test("vertical, one column: the column width is taken from the height", () => {
    const metrics = pageMetrics({
      writingMode: "vertical-rl",
      viewport: VIEWPORT,
      columns: 1,
      gap: 40,
    });

    expect(metrics.axis).toBe("y");
    // This is the machine-readable form of spine's "a vertical column's width must equal
    // exactly one viewer height". If the column width followed the width, this would be
    // 800, and the screen would stack several pages into one.
    expect(metrics.inlineSize).toBe(600);
    expect(metrics.columnWidth).toBe(600);
    expect(metrics.blockSize).toBe(800);
    expect(metrics.stride).toBe(640);
  });

  test("horizontal, two columns: the two columns plus the gutter between fill the available width exactly", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 1000, height: 600 },
      columns: 2,
      gap: 40,
    });

    expect(metrics.columnWidth).toBe(480);
    expect(metrics.columnCount).toBe(2);
    expect(metrics.columnWidth * 2 + metrics.columnGap).toBe(metrics.inlineSize);
    // The stride is the same formula as for one column: with two, the in-page gutter makes
    // up exactly the difference.
    expect(metrics.stride).toBe(1040);
  });

  test("fractional sizes are always floored — a stride cannot be fractional at fractional DPI", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 800.4, height: 600.6 },
      columns: 1,
      gap: 0,
    });

    expect(metrics.inlineSize).toBe(800);
    expect(metrics.blockSize).toBe(600);
    expect(metrics.columnWidth).toBe(800);
    expect(Number.isInteger(metrics.stride)).toBe(true);
  });

  test("an extremely narrow viewport still yields a usable setup, never 0 or negative", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 10, height: 10 },
      columns: 2,
      gap: 40,
    });

    expect(metrics.inlineSize).toBeGreaterThan(0);
    expect(metrics.columnWidth).toBeGreaterThan(0);
  });
});

describe("page count and page position", () => {
  const metrics: PageMetrics = pageMetrics({
    writingMode: "horizontal-tb",
    viewport: VIEWPORT,
    columns: 1,
    gap: 40,
  });

  test("content filling exactly one screen is one page", () => {
    expect(pageCountFor(metrics, metrics.inlineSize)).toBe(1);
  });

  test("an empty document is still one page, not zero", () => {
    // No consumer can handle zero pages — the page number becomes 1/0, and every
    // page-turn boundary check flips.
    expect(pageCountFor(metrics, 0)).toBe(1);
  });

  test("the total extent of three pages converts back to three pages", () => {
    // Three columns have two gutters between them, so the total is three strides less one
    // gap.
    const extent = metrics.stride * 3 - metrics.columnGap;
    expect(pageCountFor(metrics, extent)).toBe(3);
  });

  test("a fraction of a pixel over does not conjure an extra page", () => {
    // The most common slot at fractional DPI. Rounding up unconditionally would report a
    // blank fourth page.
    expect(pageCountFor(metrics, metrics.inlineSize + 0.4)).toBe(1);
    expect(pageCountFor(metrics, metrics.stride * 3 - metrics.columnGap + 0.4)).toBe(3);
  });

  test("a page's position is an integer multiple of the stride", () => {
    expect(pageOffsetFor(metrics, 0)).toBe(0);
    expect(pageOffsetFor(metrics, 1)).toBe(840);
    expect(pageOffsetFor(metrics, 3)).toBe(2520);
  });

  test("a scroll position converts back to the nearest page number", () => {
    expect(pageAt(metrics, 0)).toBe(0);
    expect(pageAt(metrics, 840)).toBe(1);
    // The browser nudges the scroll position by a fraction of a pixel — the reported page
    // number must not fall back a page because of it.
    expect(pageAt(metrics, 839.6)).toBe(1);
    expect(pageAt(metrics, 840.4)).toBe(1);
  });

  test("page number and page position are inverses of each other", () => {
    for (let page = 0; page < 20; page += 1) {
      expect(pageAt(metrics, pageOffsetFor(metrics, page))).toBe(page);
    }
  });
});
