import { expect, test } from "@playwright/test";
// The prose that generates the fixture is taken directly, rather than going through
// `test-fixtures/index.ts`'s public surface: what is wanted here is **the generator's
// input**, and that is where an independent oracle comes from. The public surface gives
// the output bytes, and deriving a character count back from those amounts to
// reimplementing the renderer's traversal.
import { PROSE } from "../../../src/test-fixtures/prose.ts";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * Cross-browser self-diffing — **comparing only quantities unrelated to pagination**.
 *
 * ADR-0004 has been narrowed twice by measurement, so first, plainly, what this compares
 * and what it does not:
 *
 * | | Compared | Basis |
 * | --- | --- | --- |
 * | Writing mode | **yes** | Independent of layout; the result of the book's declaration plus the CSSOM |
 * | Each section's first-page CFI | **yes** | That is the section's first text node, unrelated to page breaks |
 * | The book's character count and each section's starting fraction | **yes** | A character count is a property of the book, not of the layout |
 * | Column width and inline size | **yes** | Computed from the viewport and the settings, not measured |
 * | Page counts, break positions, page numbers | **no** | ADR-0004's #7 revision: the three engines' multicol fragmentation does not agree by construction |
 *
 * ## How the three are "compared"
 *
 * Playwright runs the three as three independent projects, and none can see the others'
 * results. So the diff is written as **each engine asserting against the same expected
 * values**: any engine deviating goes red on its own. The effect is the same as comparing
 * them pairwise, with one bonus — the expected values are written in the test, so whoever
 * reads the diff can see what the number is.
 *
 * The expected values are always **computed independently** rather than copied from some
 * run: the character count sums `PROSE` directly, and the CFIs are derived from the spec's
 * addressing rules. Copied from a run, this spec could only prove "the behaviour has not
 * changed", never "the behaviour is right".
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("writing mode: the three engines have to agree", () => {
  const EXPECTED = [
    { fixture: "vertical-japanese", writingMode: "vertical-rl" },
    { fixture: "writing-mode-on-body", writingMode: "vertical-rl" },
    // **This slot is this spec's toothiest case.** That book writes only the `-epub-` and
    // `-webkit-` prefixes and Firefox recognizes neither — without normalization it lays
    // out `horizontal-tb` while the other two are `vertical-rl`. The three agreeing is
    // itself the deliverable.
    { fixture: "writing-mode-prefixed-only", writingMode: "vertical-rl" },
    { fixture: "ppd-rtl-vertical", writingMode: "vertical-rl" },
    { fixture: "huge-single-section", writingMode: "horizontal-tb" },
    { fixture: "nested-toc", writingMode: "horizontal-tb" },
  ] as const;

  for (const { fixture, writingMode } of EXPECTED) {
    test(`${fixture} lays out ${writingMode}`, async ({ page }) => {
      const location = await mountFixture(page, fixture, {});
      expect(location.writingMode).toBe(writingMode);
    });
  }
});

test.describe("position: the three engines have to agree", () => {
  test("each section's first-page CFI is identical character for character", async ({ page }) => {
    // The expected values are derived from the spec's addressing rules rather than copied
    // from a run:
    //
    // - `/6` — `<package>`'s content model prescribes metadata, manifest, spine, so the
    //   spine is always the third element, index 2 × 3
    // - `/2`, `/4`, `/6` — the 1st, 2nd and 3rd `<itemref>`
    // - after the `!`, counting from the content document's root element: `<head>` is `/2`
    //   and `<body>` is `/4`
    // - `<body>`'s first element is the `<h1>`, index `/2`
    // - the `<h1>` holds a single run of text, index `/1`; `:0` is its first character
    const expected = [
      "epubcfi(/6/2!/4/2/1:0)",
      "epubcfi(/6/4!/4/2/1:0)",
      "epubcfi(/6/6!/4/2/1:0)",
    ];

    await mountFixture(page, "vertical-japanese", {});

    for (const [index, cfi] of expected.entries()) {
      const location = await page.evaluate(
        (target) => window.frond.goToSection(target as number),
        index,
      );
      expect(location.cfi, `section ${index}`).toBe(cfi);
    }
  });

  test("the book's character count agrees across the three, and equals the fixture's prose length", async ({ page }) => {
    // An independent oracle: computed straight from the prose that generates the fixture
    // rather than derived back from the rendered result.
    const expected = PROSE.reduce(
      (total, prose) =>
        total +
        prose.title.length +
        prose.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0),
      0,
    );

    await mountFixture(page, "vertical-japanese", {});
    const characters = await page.evaluate(() => window.frond.waitForIndex());

    expect(characters).toBe(expected);
  });

  test("each section's starting fraction agrees across the three", async ({ page }) => {
    const lengths = PROSE.map(
      (prose) =>
        prose.title.length +
        prose.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0),
    );
    const total = lengths.reduce((sum, length) => sum + length, 0);

    await mountFixture(page, "vertical-japanese", {});
    await page.evaluate(() => window.frond.waitForIndex());

    let before = 0;
    for (const [index, length] of lengths.entries()) {
      const location = await page.evaluate(
        (target) => window.frond.goToSection(target as number),
        index,
      );

      expect(location.fraction, `section ${index}`).toBeCloseTo(before / total, 10);
      before += length;
    }
  });
});

test.describe("layout parameters: the three engines have to agree", () => {
  test("a vertical layout's column width and inline size", async ({ page }) => {
    // These are **computed** rather than measured, which is why they can be compared —
    // while a page count is measured and cannot. Container 800×600 with a 24 margin: layout
    // 752×552, and vertical's inline axis is the height.
    await mountFixture(page, "vertical-japanese", { settings: { margin: 24 } });

    expect(await computed(page, "column-width")).toBe("552px");
    expect(await computed(page, "column-count")).toBe("1");
    expect(await computed(page, "height")).toBe("552px");
    expect(await computed(page, "width")).toBe("752px");
  });

  test("a horizontal two-column layout's column width", async ({ page }) => {
    await mountFixture(page, "huge-single-section", {
      settings: { margin: 24, columns: 2 },
    });

    // (752 − 40) / 2 = 356。
    expect(await computed(page, "column-width")).toBe("356px");
    expect(await computed(page, "column-count")).toBe("2");
  });
});

/**
 * There is **no** page-count comparison here.
 *
 * ADR-0004's #7 revision measured: on one vertical fixture naming `Noto Serif CJK JP`, one
 * 800×600 viewport and a 64px reader font size, Chromium lays out 4 pages while Firefox
 * and WebKit lay out 3 each, with the three engines' total ink differing by only 0.01% —
 * no content lost and none duplicated; what diverges is purely where the breaks fall.
 *
 * Keeping a "the three page counts should agree" assertion would produce a permanently red
 * diff test nobody reads, with the real bugs hiding behind it. The page-count slot is
 * guarded by `invariants.spec.ts` through self-consistency within one browser.
 *
 * The test below makes that **observable** rather than merely written in a comment: it
 * records how many pages each engine actually lays out, always passes, and puts the number
 * in the test output.
 */
test("page count when vertical with a raised font size (recorded, not compared)", async ({ page }, testInfo) => {
  const location = await mountFixture(page, "vertical-japanese", {
    settings: { fontSize: 64 },
  });

  testInfo.annotations.push({
    type: "pageCount",
    description: `${testInfo.project.name}: the first section lays out in ${location.pageCount} pages at 64px`,
  });

  // The only assertion is "it lays out pages at all". The count itself is not compared.
  expect(location.pageCount).toBeGreaterThan(0);
});

async function computed(
  page: Parameters<typeof mountFixture>[0],
  property: string,
): Promise<string> {
  return page.evaluate(
    (name) => window.frond.computed("html", name as string),
    property,
  );
}
