import { expect, test, type Page } from "@playwright/test";
import { documentWith } from "../support/document.js";

/**
 * **Which spelling** a book declares vertical writing with, and whether the three engines
 * accept it.
 *
 * How this group divides work with `vertical-writing.spec.ts`: that one asks "can this
 * environment lay out vertically" (a property of the environment), this one asks "when the
 * book declares it like this, does the browser accept it" (browser behaviour). The latter
 * is a quirk, registered in `docs/browser-quirks.md`.
 *
 * The trigger was a real book. One of ADR-0007's triggers, 《入境大廳》 (produced by Adobe
 * InDesign 17.0.1, EPUB 3, Traditional Chinese vertical), declares `-epub-writing-mode` and
 * `-webkit-writing-mode` on `<body>` — with **the unprefixed `writing-mode` never
 * appearing once**. Measured, Firefox recognizes neither prefix, so that book lays out
 * horizontally throughout in Firefox.
 *
 * **This group is not saying "Firefox's vertical writing is broken".** Firefox's vertical
 * support is complete, and the most correct of the three (WebKit is the one that does not
 * apply `vert` when vertical). What it does not recognize is two vendor-prefixed property
 * names — and the first test is the control: the same Firefox behaves as soon as the
 * property name is the standard `writing-mode`. Strictly, Firefox is right here; no
 * specification requires it to implement another vendor's prefix. What is broken is the
 * book that writes only prefixes and not the standard property.
 *
 * This passage is here because the claim "foliate's vertical writing is broken in Firefox"
 * was once taken as fact and written into #1's work ordering, and was finally withdrawn by
 * #7's measurements (see docs/browser-quirks.md). Do not let it grow back out of these
 * tests' names.
 *
 * This group deliberately **pins the divergence rather than expecting the three to agree**,
 * for the same reason as `regional-faces.spec.ts`: the divergence is a property of the
 * browsers and frond decides whether to intervene from it, so somebody has to know when it
 * changes.
 *
 * ## Why this does not read `writing-mode-prefixed-only.epub`
 *
 * The same shape now has a synthetic fixture too (#24). This group still feeds style
 * fragments through `page.setContent`, because what it asks is **the browser's behaviour**
 * — "does this engine accept this CSS" — and that has nothing to do with whether the
 * declaration is wrapped in an EPUB; padding an extra layer of packaging in between only
 * adds explanations for a red test that have nothing to do with the question. Loading a
 * whole book into the browser had to wait for `Renderer` to exist (after #8), and by then
 * the question to ask is a different one: has frond normalized the prefixes away.
 *
 * On the browser side that fixture is currently covered by `fixture-parsing.spec.ts` — its
 * filename list is taken from the generator, so a new fixture is covered automatically with
 * no copy needed here.
 */

/** A named face, for the same reason as in vertical-writing.spec.ts: the three engines resolve generic families differently (#4). */
const JAPANESE_FACE = '"Noto Serif CJK JP"';

/** Firefox does not recognize the `-epub-` and `-webkit-` writing-mode prefixes (measured in this file). */
const IGNORES_PREFIXED_WRITING_MODE = ["firefox"];

interface Layout {
  /** `<html>`'s computed `writing-mode`. */
  readonly html: string;
  /** `<body>`'s computed `writing-mode`. */
  readonly body: string;
  /** Did it geometrically lay out vertically — do the characters advance downwards rather than to the right. */
  readonly vertical: boolean;
}

test.describe("spellings of a vertical-writing declaration", () => {
  test("the unprefixed writing-mode: all three accept it, on both html and body", async ({
    page,
  }) => {
    const onHtml = await layoutOf(page, `html { writing-mode: vertical-rl; }`);
    const onBody = await layoutOf(page, `body { writing-mode: vertical-rl; }`);

    expect(onHtml.vertical).toBe(true);
    expect(onBody.vertical).toBe(true);

    // Declared on body, `<html>` is still horizontal — which is exactly the pit of "a
    // library reading only documentElement judges an InDesign book horizontal" (ADR-0003's
    // intervention list has a slot for it).
    expect(onHtml.html).toBe("vertical-rl");
    expect(onBody.html).toBe("horizontal-tb");
    expect(onBody.body).toBe("vertical-rl");
  });

  test("the -epub- and -webkit- prefixes: Firefox does not recognize them, the other two do", async ({
    page,
  }, testInfo) => {
    const ignores = IGNORES_PREFIXED_WRITING_MODE.includes(
      testInfo.project.name,
    );

    for (const property of ["-epub-writing-mode", "-webkit-writing-mode"]) {
      const layout = await layoutOf(page, `body { ${property}: vertical-rl; }`);

      // Geometry and computed style flip together here — with the declaration dropped, both
      // are horizontal. Both are asserted because their failure modes differ: the computed
      // style can say "the declaration was not accepted" and the geometry can say "the reader
      // sees horizontal", and what frond needs is the latter.
      expect(layout.vertical, `${property}'s geometry`).toBe(!ignores);
      expect(layout.body, `${property}'s computed value`).toBe(
        ignores ? "horizontal-tb" : "vertical-rl",
      );
    }
  });

  test("the shape found in the wild: prefixes only, no standard property, and Firefox never receives the declaration", async ({
    page,
  }, testInfo) => {
    // The actual shape of that declaration in 《入境大廳》's OEBPS stylesheet.
    const layout = await layoutOf(
      page,
      `body {
         -epub-writing-mode: vertical-rl;
         -webkit-writing-mode: vertical-rl;
       }`,
    );

    const ignores = IGNORES_PREFIXED_WRITING_MODE.includes(
      testInfo.project.name,
    );

    expect(layout.vertical).toBe(!ignores);

    // This assertion records the fact that **a real book lays out wrongly in a real
    // browser**, not a frond bug. What to do about it is in docs/browser-quirks.md: frond
    // normalizes prefixed declarations into unprefixed ones, or a project for which vertical
    // writing is a hard requirement gets one of the three engines laying whole books out
    // horizontally.
    if (ignores) {
      expect(layout.body).toBe("horizontal-tb");
    }
  });

  test("the old tb-rl syntax: all three accept it, and normalize it to vertical-rl", async ({ page }) => {
    // `writing-mode: tb-rl` is the SVG 1.1 / early CSS3 spelling. Two books on this machine
    // (《我的公寓》 and 《給力》) still have it in their stylesheets, alongside the modern
    // syntax.
    for (const selector of ["html", "body"]) {
      const layout = await layoutOf(
        page,
        `${selector} { writing-mode: tb-rl; }`,
      );

      expect(layout.vertical, `tb-rl on ${selector}`).toBe(true);
      // All three normalize it to the modern value, so a detector reading computed style
      // need not recognize the old syntax.
      expect(layout.body, `the computed value of tb-rl on ${selector}`).toBe(
        "vertical-rl",
      );
    }
  });

  test("no space after the colon: all three accept it", async ({ page }) => {
    // 《入境大廳》 writes `-epub-writing-mode:vertical-rl` (no space). All three are fine in
    // this slot, and it is registered to make the point that **detection must not use string
    // matching**: what the CSSOM sees is the normalized value, and matching
    // "writing-mode: vertical-rl" against the source misses this book.
    const layout = await layoutOf(page, `body { writing-mode:vertical-rl; }`);

    expect(layout.vertical).toBe(true);
    expect(layout.body).toBe("vertical-rl");
  });
});

/**
 * Applies a piece of CSS and reports the computed writing mode alongside the **geometric**
 * direction it actually laid out in.
 *
 * The geometry is measured with a range over two adjacent characters (as in
 * vertical-writing.spec.ts): when vertical, the second character sits below the first at
 * the same horizontal position. Reading the computed style alone is not enough — what this
 * group has to answer is "does the reader see vertical or horizontal".
 */
async function layoutOf(page: Page, css: string): Promise<Layout> {
  await page.setContent(
    documentWith(`
      <style>
        #text {
          font-family: ${JAPANESE_FACE};
          font-size: 32px;
          line-height: 1;
          width: 400px;
          height: 400px;
        }
        ${css}
      </style>
      <div id="text" lang="ja">あい</div>
    `),
  );
  await page.evaluate(() => document.fonts.ready);

  return page.evaluate(() => {
    const textNode = document.getElementById("text")?.firstChild;
    if (!textNode) throw new Error("the test's text node was not found");

    const rectOf = (index: number) => {
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      return range.getBoundingClientRect();
    };

    const first = rectOf(0);
    const second = rectOf(1);

    return {
      html: getComputedStyle(document.documentElement).writingMode,
      body: getComputedStyle(document.body).writingMode,
      vertical:
        second.top >= first.top + first.height * 0.5 &&
        Math.abs(second.left - first.left) < 1,
    };
  });
}
