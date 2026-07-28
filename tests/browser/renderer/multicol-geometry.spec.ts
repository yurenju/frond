import { expect, test, type Page } from "@playwright/test";

/**
 * Pagination's foundation: under vertical and horizontal writing modes, which axis the
 * columns overflow along, which direction `column-width` measures, and what the sign
 * convention for scroll coordinates is.
 *
 * **No frond code takes part in this spec** ("who laid this number out" in
 * `docs/browser-quirks.md`): `page.setContent` feeds hand-written HTML/CSS, and what is
 * measured is the browser's own behaviour, which still holds with a different renderer. It
 * pins the premises every formula in `src/renderer/geometry.ts` depends on — built on the
 * wrong axis, those formulas produce "several pages stacked on one screen" rather than a
 * red test.
 *
 * ## Why this has to be measured
 *
 * A vertical layout's column axis is where intuition most easily goes wrong at this layer,
 * and going wrong raises nothing: `column-width` applied in the wrong direction is still a
 * legal declaration, the page still draws, and only the amount of content per page is
 * wrong. spine's hard-won "a vertical column's width must equal exactly one viewer height"
 * is about precisely this, but it gives the conclusion without the reason, so whoever
 * copies it does not know which number to change for a different viewport shape.
 *
 * The derivation from the spec: multicol's columns are laid out along and overflow the
 * **inline axis**, and `column-width` measures a single column's **inline size**.
 * Horizontal (`horizontal-tb`) has a horizontal inline axis, so the column width is the
 * width and the overflow is horizontal; vertical (`vertical-rl`) has a vertical inline
 * axis (characters run top to bottom), so **the column width is the height and the
 * overflow is vertical**. This spec turns that derivation into a measurement on all three
 * engines.
 */

/** The container's size. The two dimensions are deliberately unequal — equal, the two axes' numbers would be indistinguishable. */
const PANE_WIDTH = 400;
const PANE_HEIGHT = 300;

/** The column gap. 0, so that "total = column count × column width" leaves no remainder to explain. */
const COLUMN_GAP = 0;

type WritingMode = "horizontal-tb" | "vertical-rl";

interface PaneGeometry {
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  /** The scroll position pushed to negative infinity and read back — under a negative convention this reads negative. */
  readonly minScrollLeft: number;
  readonly minScrollTop: number;
  /** Pushed to positive infinity and read back, that is, scrolled to the end. */
  readonly maxScrollLeft: number;
  readonly maxScrollTop: number;
}

test.describe("multicol's column axis and scroll conventions", () => {
  test("horizontal: the column width is the width, and the columns overflow horizontally", async ({ page }) => {
    const geometry = await measurePane(page, "horizontal-tb");

    // The inline axis is horizontal: overflow on x, none on y.
    expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
    expect(geometry.scrollHeight).toBe(geometry.clientHeight);

    // The column width is the container's width, so the total is an integer multiple of the
    // width — which is what "one screen, one page" means.
    expect(geometry.scrollWidth % PANE_WIDTH).toBe(0);
  });

  test("vertical: the column width is the height, and the columns overflow vertically", async ({ page }) => {
    const geometry = await measurePane(page, "vertical-rl");

    // A vertical layout's inline axis is vertical (characters run top to bottom), so the
    // overflow moves to y.
    //
    // This case is the whole layer's foundation. Flipped, every formula in `geometry.ts`
    // that takes the viewport's height as a vertical column width is wrong, and the symptom
    // of being wrong is several pages stacked on one screen — not a red test.
    expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    expect(geometry.scrollWidth).toBe(geometry.clientWidth);

    expect(geometry.scrollHeight % PANE_HEIGHT).toBe(0);
  });

  test.describe("the sign convention for scroll coordinates", () => {
    // Pagination advances along the inline axis, and both writing modes' inline axes run
    // "positively" (horizontal left to right, vertical top to bottom), so the scroll
    // coordinate starts at 0 and grows positive.
    //
    // It is measured because **the negative convention really does exist**:
    // `direction: rtl` has a right-to-left inline axis, and CSSOM View specifies that
    // scrollLeft is expressed negatively in that case. Neither of frond v1's writing modes
    // lands in that slot, but `geometry.ts` still probes once at runtime rather than
    // hard-coding — and what these two tests pin is that "the probed answer should start at
    // 0".

    test("the horizontal pagination axis starts at 0", async ({ page }) => {
      const geometry = await measurePane(page, "horizontal-tb");

      expect(geometry.minScrollLeft).toBe(0);
      expect(geometry.maxScrollLeft).toBe(
        geometry.scrollWidth - geometry.clientWidth,
      );
    });

    test("the vertical pagination axis starts at 0", async ({ page }) => {
      const geometry = await measurePane(page, "vertical-rl");

      expect(geometry.minScrollTop).toBe(0);
      expect(geometry.maxScrollTop).toBe(
        geometry.scrollHeight - geometry.clientHeight,
      );
    });
  });

  test("a vertical column's width follows a different viewport shape, independently of the width", async ({ page }) => {
    // "The column width equals the viewer height" is not a constant but a formula tied to
    // the container's height. Change the height and leave the width alone and the total has
    // to change with it — were it following the width, the two cases above would go green
    // together on a square container while this one goes red.
    const tall = await measurePane(page, "vertical-rl", { height: 600 });

    expect(tall.scrollHeight % 600).toBe(0);
    expect(tall.scrollWidth).toBe(tall.clientWidth);
  });
});

/**
 * Builds a fixed-size multicol container and measures its scroll geometry.
 *
 * `column-fill: auto` is necessary: the default `balance` distributes the content evenly
 * across columns, and "one column is one page" stops holding. `overflow: auto` turns the
 * overflowing columns into a scrollable range rather than drawing them outside the
 * container.
 */
async function measurePane(
  page: Page,
  writingMode: WritingMode,
  size: { width?: number; height?: number } = {},
): Promise<PaneGeometry> {
  const width = size.width ?? PANE_WIDTH;
  const height = size.height ?? PANE_HEIGHT;
  // The column width is the container's size along the inline axis: the width when
  // horizontal, the height when vertical.
  const columnWidth = writingMode === "vertical-rl" ? height : width;

  await page.setContent(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <style>
      html, body { margin: 0; padding: 0; }
      #pane {
        writing-mode: ${writingMode};
        width: ${width}px;
        height: ${height}px;
        column-width: ${columnWidth}px;
        column-gap: ${COLUMN_GAP}px;
        column-fill: auto;
        overflow: auto;
        font-family: "Noto Serif CJK JP";
        font-size: 16px;
        line-height: 1.8;
      }
      #pane p { margin: 0 0 1em; }
    </style>
  </head>
  <body><div id="pane">${paragraphs(40)}</div></body>
</html>`);
  await page.evaluate(() => document.fonts.ready);

  return page.evaluate(() => {
    const pane = document.getElementById("pane");
    if (pane === null) throw new Error("multicol container not found");

    // Push to negative infinity first, then to positive infinity. The browser clamps to the
    // legal range, so what reads back are the two ends — the convention can be measured
    // without knowing what it is.
    pane.scrollTo({ left: -1_000_000, top: -1_000_000, behavior: "instant" });
    const minScrollLeft = pane.scrollLeft;
    const minScrollTop = pane.scrollTop;

    pane.scrollTo({ left: 1_000_000, top: 1_000_000, behavior: "instant" });
    const maxScrollLeft = pane.scrollLeft;
    const maxScrollTop = pane.scrollTop;

    pane.scrollTo({ left: 0, top: 0, behavior: "instant" });

    return {
      clientWidth: pane.clientWidth,
      clientHeight: pane.clientHeight,
      scrollWidth: pane.scrollWidth,
      scrollHeight: pane.scrollHeight,
      minScrollLeft,
      minScrollTop,
      maxScrollLeft,
      maxScrollTop,
    };
  });
}

/** Enough content to overflow several columns. The text is synthetic (ADR-0007), and the count is fixed rather than random. */
function paragraphs(count: number): string {
  const sentence = "窓の外に、静かな朝の光が差しこんでいた。";
  return Array.from({ length: count }, () => `<p>${sentence}</p>`).join("");
}
