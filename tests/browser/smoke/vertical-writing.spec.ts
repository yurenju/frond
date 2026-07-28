import { expect, test, type Page } from "@playwright/test";
import { documentWith } from "../support/document.js";
import { screenshotGlyph } from "../support/glyph.js";
import { analyseInk, type InkAnalysis } from "../support/ink.js";

/**
 * Whether this environment can lay out vertically at all.
 *
 * A smoke test's purpose is not to test frond — frond had no code yet — but to prove the
 * premise that "all three browsers can lay out vertically, correctly, inside this
 * container". Without that premise, every invariant and cross-browser diff that follows is
 * built on sand.
 */

/** The Japanese full stop. When vertical, vert / vrt2 should swap it for the glyph at the top right. */
const IDEOGRAPHIC_FULL_STOP = "。";

/**
 * Smoke tests always name a face, never a generic family.
 *
 * The three browsers do not resolve generic families to CJK faces consistently (see #4),
 * so with serif what gets measured here would be "which font the browser picked" rather
 * than "whether this font's vertical glyphs are right". Naming the face leaves one
 * variable.
 *
 * This is a choice about the test environment, not a rule of frond's — frond still
 * respects the book's own declarations (ADR-0003).
 */
const JAPANESE_FACE = '"Noto Serif CJK JP"';

test.describe("vertical rendering", () => {
  test("the advance axis is vertical: the next character sits below the previous one, not to its right", async ({
    page,
  }) => {
    await page.setContent(
      documentWith(`
        <style>
          /* The font name is quoted, so the styles go through <style> rather than a
             style="..." attribute — the inner double quote would truncate the HTML attribute,
             and the whole declaration would disappear along with the dimensions. */
          #text {
            writing-mode: vertical-rl;
            font-family: ${JAPANESE_FACE};
            font-size: 40px;
            line-height: 1;
            width: 400px;
            height: 400px;
          }
        </style>
        <div id="text" lang="ja">あいうえお</div>
      `),
    );
    await page.evaluate(() => document.fonts.ready);

    const rects = await page.evaluate(() => {
      const textNode = document.getElementById("text")?.firstChild;
      if (!textNode) throw new Error("the test's text node was not found");

      const rectOf = (index: number) => {
        const range = document.createRange();
        range.setStart(textNode, index);
        range.setEnd(textNode, index + 1);
        const { top, left, width, height } = range.getBoundingClientRect();
        return { top, left, width, height };
      };

      return { first: rectOf(0), second: rectOf(1) };
    });

    // Geometry rather than computed style, deliberately. The computed style reports
    // vertical-rl honestly while the drawn pixels may still be horizontal — which is exactly
    // what this assertion is here to catch.
    expect(rects.second.top).toBeGreaterThanOrEqual(
      rects.first.top + rects.first.height * 0.5,
    );

    // The two characters are on one line, so their horizontal positions match.
    expect(Math.abs(rects.second.left - rects.first.left)).toBeLessThan(1);
  });

  test("punctuation picks up its vertical glyph: the full stop is at the top right when vertical and the bottom left when horizontal", async ({
    page,
  }) => {
    const horizontal = await inkOfFullStop(page, "horizontal-tb");
    const vertical = await inkOfFullStop(page, "vertical-rl");

    // Horizontal: the full stop sits at the em box's bottom left.
    expect(horizontal.x).toBeLessThan(0.5);
    expect(horizontal.y).toBeGreaterThan(0.5);

    // Vertical: vert / vrt2 moves the full stop to the top right.
    //
    // This is the most important assertion in the whole test environment. What it blocks is
    // the nastiest failure mode: a CJK font without vertical glyphs is installed, so the
    // computed style reports vertical-rl, the content really is split into N pages with
    // nothing lost or duplicated, every geometric invariant passes, and the vertical
    // punctuation on screen is wrong. That defect would otherwise only be caught by sampled
    // visual review — which is to say, it would slip through.
    //
    // Without vertical glyphs the full stop stays at the bottom left and the two assertions
    // below go red.
    expect(vertical.x).toBeGreaterThan(0.5);
    expect(vertical.y).toBeLessThan(0.5);
  });
});

/**
 * The full stop's ink centroid, normalized to [0, 1] within the em box.
 *
 * With no ink it throws outright — that means the character never rendered at all, not
 * that "the centroid is somewhere". Making it an error rather than a fake coordinate stops
 * the downstream quadrant assertions from mistaking blankness for a pass.
 */
async function inkOfFullStop(
  page: Page,
  writingMode: "horizontal-tb" | "vertical-rl",
): Promise<{ x: number; y: number }> {
  const ink: InkAnalysis = analyseInk(
    await screenshotGlyph(page, {
      char: IDEOGRAPHIC_FULL_STOP,
      lang: "ja",
      fontFamily: JAPANESE_FACE,
      writingMode,
      // Request the vertical glyphs explicitly. Chromium and Firefox apply vert
      // automatically under writing-mode: vertical-rl and WebKit does not — measured, it
      // leaves the full stop at the bottom left and only moves it to the top right once
      // forced (see docs/browser-quirks.md).
      //
      // Forcing it does not rob the assertion of meaning: the question is "does this font
      // have vertical glyphs, and can it draw them", which is a property of the environment.
      // With a font lacking vert installed, forcing has no effect at all and the assertions
      // still go red.
      //
      // Whether the browser applies them automatically is the browser's behaviour rather
      // than a property of the environment — a quirk for Renderer to handle, registered in
      // browser-quirks.md.
      fontFeatureSettings: writingMode === "vertical-rl" ? '"vert" 1' : "normal",
    }),
  );

  if (!ink.centroid) {
    throw new Error(
      `the em box has no ink at all under ${writingMode} — the full stop never rendered`,
    );
  }

  return ink.centroid;
}
