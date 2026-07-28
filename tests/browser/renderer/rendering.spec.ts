import { expect, test } from "@playwright/test";
import { mountFixture, openHarness, VIEWPORT_ID } from "../support/harness.js";

/**
 * Rendering a book into a container, and recognizing its writing mode.
 *
 * Writing mode is this spec's centre of gravity, because it is **only answerable inside a
 * browser**: the criterion is the CSSOM, and string matching misses the forms books
 * actually use (ADR-0010, `docs/browser-quirks.md`). Each of the three declaration forms
 * has its own fixture, and they act as each other's controls.
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("rendering into the container", () => {
  test("mounting lays out the first page", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");

    expect(location.sectionIndex).toBe(0);
    expect(location.page).toBe(0);
    expect(location.pageCount).toBeGreaterThanOrEqual(1);
    expect(location.atStart).toBe(true);
    expect(location.cfi).toMatch(/^epubcfi\(/);
  });

  test("the content really is on screen — the iframe holds a loaded document", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const html = await page.evaluate(() => window.frond.html());

    expect(html).toContain("朝の光");
    // Both of frond's own stylesheets are attached.
    expect(html).toContain('id="frond-layout"');
    expect(html).toContain('id="frond-reader"');
  });

  test("scripts in the book never enter the document (ADR-0006)", async ({ page }) => {
    // `manifest-href-parent-prefix` carries a js resource. Scripts in the book are always
    // stripped — the iframe has to carry allow-scripts for the parent to receive events, so
    // this step is the only thing standing between the book's code and execution.
    await mountFixture(page, "manifest-href-parent-prefix");

    const html = await page.evaluate(() => window.frond.html());

    expect(html).not.toContain("<script");
  });
});

/**
 * There is only ever one iframe in the container — **including while loads are in
 * flight**.
 *
 * Mounting a new section is awaited (attaching the iframe, waiting for fonts), and a
 * consumer does not wait: dragging a margin slider fires `input` at every notch, and every
 * notch is an `applySettings`, which is a rebuild. The version that once got this wrong
 * decided which one to tear down **before** the await, so nothing tore down the ones in
 * between — the iframes are absolutely positioned with transparent backgrounds, so the
 * leftovers peek out from the edges of the current one, and on screen that reads as "other
 * parts of the book stacked underneath while dragging the margin".
 *
 * The assertion is on the **number** of iframes rather than on the screen: the surplus ones
 * only show a few pixels at the edge, which screenshot comparison cannot measure, and the
 * count is the cause of the thing.
 */
test.describe("with loads in flight, the container still holds one document", () => {
  test("changing settings repeatedly without waiting for the previous one", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const frames = await page.evaluate(async (id) => {
      await Promise.all(
        [10, 20, 30, 40, 50, 60].map((margin) =>
          window.frond.applySettings({ margin }),
        ),
      );
      return document.getElementById(id)!.querySelectorAll("iframe").length;
    }, VIEWPORT_ID);

    expect(frames).toBe(1);
  });

  test("changing sections repeatedly without waiting for the previous one", async ({ page }) => {
    // Rapid page-turn taps go down the same route, and guard one thing more: **the winner
    // has to be the last one issued, not the first one to finish**. The three sections
    // differ greatly in length (empty, image-only, text), so "who finished first" and "who
    // was issued last" really do diverge here.
    await mountFixture(page, "empty-and-image-only-sections");

    const result = await page.evaluate(async (id) => {
      await Promise.all([0, 1, 2, 1, 0].map((index) => window.frond.goToSection(index)));
      return {
        frames: document.getElementById(id)!.querySelectorAll("iframe").length,
        sectionIndex: window.frond.snapshot().sectionIndex,
      };
    }, VIEWPORT_ID);

    expect(result).toEqual({ frames: 1, sectionIndex: 0 });
  });
});

test.describe("detecting the writing mode", () => {
  test("declared on <html>: vertical", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("declared on <body>: still recognized as vertical", async ({ page }) => {
    // Books produced by InDesign have this shape. A library reading only documentElement
    // judges it horizontal — spine wrote its own detectVerticalBook for exactly this
    // (ADR-0002).
    const location = await mountFixture(page, "writing-mode-on-body");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("only -epub- and -webkit- prefixes: all three lay out vertically", async ({ page }) => {
    // **This case only has teeth in Firefox.** That book has no unprefixed declaration and
    // Firefox recognizes neither prefix, so without normalization it lays the whole book
    // out horizontally (《入境大廳》's shape, docs/browser-quirks.md). The other two
    // recognize the prefixes already, so what they prove here is "adding an unprefixed
    // declaration did not break them".
    const location = await mountFixture(page, "writing-mode-prefixed-only");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("declared in an @imported stylesheet: still recognized as vertical", async ({ page }) => {
    // A shape measured on real books (4 of the 34 in the sample, all from the same
    // Kadokawa/BookCreator toolchain): the content document only `<link>`s an aggregate
    // file, and that file holds nothing but `@import "…"` strings. Without expanding the
    // @import, the whole stylesheet **disappears** — not one missing declaration but the
    // whole book laid out the wrong way, and with no error message at all.
    const location = await mountFixture(page, "writing-mode-behind-import");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("an @imported declaration is inlined in the document, not an address waiting to load", async ({ page }) => {
    // Expanded rather than swapped for a blob: address, because `@import`'s loading is
    // **asynchronous**: frond measures the content's total extent to compute the page count
    // right after the iframe's load event, and if the styles have not arrived the count is
    // wrong — and only wrong when loading happens to be slow (`document-source.ts`'s header
    // comment).
    await mountFixture(page, "writing-mode-behind-import");

    const html = await page.evaluate(() => window.frond.html());

    expect(html).toContain("writing-mode: vertical-rl");
    expect(html).not.toContain("@import");
  });

  test("a book with no vertical declaration is horizontal", async ({ page }) => {
    const location = await mountFixture(page, "huge-single-section");
    expect(location.writingMode).toBe("horizontal-tb");
  });

  test("vertical pages advance along y, horizontal ones along x", async ({ page }) => {
    // The reader font size is raised to 64px so the section lays out over more than one page
    // — `vertical-japanese` has only three paragraphs per section, which fit one screen at
    // the book's own size, and then `next()` steps straight into the following section and
    // the measured scroll position is always 0. #7's foliate spike used this size too.
    const vertical = await mountFixture(page, "vertical-japanese", {
      settings: { fontSize: 64 },
    });
    expect(vertical.pageCount).toBeGreaterThan(1);

    await page.evaluate(() => window.frond.next());
    const verticalOffset = await page.evaluate(() => window.frond.scrollOffset());

    const horizontal = await mountFixture(page, "huge-single-section");
    expect(horizontal.pageCount).toBeGreaterThan(1);

    await page.evaluate(() => window.frond.next());
    const horizontalOffset = await page.evaluate(() => window.frond.scrollOffset());

    // `scrollOffset()` reads scrollTop or scrollLeft by writing mode, so both being greater
    // than zero means each one's own axis really moved. That also proves an
    // `overflow: hidden` multicol container is still scrollable — the reader cannot scroll
    // it, frond can.
    expect(verticalOffset).toBeGreaterThan(0);
    expect(horizontalOffset).toBeGreaterThan(0);
  });
});

test.describe("the pagination geometry", () => {
  test("a vertical column's width equals one viewer height", async ({ page }) => {
    // The machine-readable form of spine's "a vertical column's width must equal exactly one
    // viewer height". The container is 800×600 with a 24 margin, so the iframe is 752×552,
    // and vertical takes the height, 552.
    await mountFixture(page, "vertical-japanese", { settings: { margin: 24 } });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toBe("552px");
  });

  test("a horizontal column's width equals one viewer width", async ({ page }) => {
    await mountFixture(page, "huge-single-section", {
      settings: { margin: 24, columns: 1 },
    });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toBe("752px");
  });

  test("the vertical-punctuation feature setting is injected when vertical and not when horizontal", async ({ page }) => {
    // WebKit does not apply `vert` automatically when vertical, leaving the Japanese full
    // stop at the bottom left (browser-quirks.md's first entry). One rule shared by all
    // three with no branching — measured, forcing it leaves Chromium's and Firefox's output
    // byte-identical.
    //
    // What `vertical-writing.spec.ts` verifies is "this font has vertical glyphs and can
    // draw them", because it injects `"vert" 1` itself. What this verifies is **that
    // Renderer does it**.
    await mountFixture(page, "vertical-japanese");
    expect(
      await page.evaluate(() => window.frond.computed("html", "font-feature-settings")),
    ).toContain("vert");

    await mountFixture(page, "huge-single-section");
    expect(
      await page.evaluate(() => window.frond.computed("html", "font-feature-settings")),
    ).not.toContain("vert");
  });

  test("the column width is an integer number of pixels", async ({ page }) => {
    // A fractional column width accumulates stride error, and after a few dozen page turns
    // one screen stacks two half pages.
    await mountFixture(page, "vertical-japanese", { settings: { margin: 25 } });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toMatch(/^\d+px$/);
  });
});

/**
 * Overflowing content gets clipped — the `cap-overflowing-boxes` slot on ADR-0003's
 * intervention list.
 *
 * `fixed-width-800` plays the **inline axis** side (the book pins `width: 800px`); this
 * group plays the **block axis**: a plate taller than a column. The two sides' mechanisms
 * are asymmetric, and that asymmetry is exactly the ailment measured on real books —
 * `max-block-size: 100%` needs a definite containing-block size to resolve, and the
 * `height: auto` div wrapping the plate silently turns it into `none`
 * (`src/renderer/layout.ts`).
 *
 * The symptom is entirely invisible to DOM assertions: the image is in the document, the
 * `<img>`'s attributes are all right, and the page count is a perfectly normal number. Only
 * the geometry shows it — so this group measures rectangles.
 */
test.describe("a plate taller than a column", () => {
  /** The plate is in the last section (`ailments.ts`). */
  const PLATE_SECTION = 2;

  test("the image is scaled to fit a column rather than clipped", async ({ page }) => {
    await mountFixture(page, "plate-taller-than-page", { settings: { margin: 24 } });
    await page.evaluate(
      (index) => window.frond.goToSection(index),
      PLATE_SECTION,
    );

    const plate = await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      if (!(frame instanceof HTMLIFrameElement)) return null;
      const inner = frame.contentDocument;
      const image = inner === null ? null : inner.querySelector(".plate img");
      if (inner === null || image === null) return null;

      const rect = image.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        // A column's extent along the block axis. Horizontal's block axis is y.
        blockExtent: inner.documentElement.clientHeight,
      };
    });

    expect(plate).not.toBeNull();
    // Container 800×600 with a 24 margin → a column's block extent is 552. The image is
    // originally 720 tall.
    expect(plate!.blockExtent).toBe(552);
    expect(plate!.height).toBeLessThanOrEqual(plate!.blockExtent);

    // **Scaled proportionally, not squashed.** The original is 64×720, so at 552 tall it
    // should be about 49 wide; if the width does not scale with it, the reader sees a
    // distorted image, and that is as much a presentation error as being clipped.
    const aspect = plate!.width / plate!.height;
    expect(aspect).toBeCloseTo(64 / 720, 1);
  });

  test("the whole plate is on screen — no part of it falls outside the container", async ({ page }) => {
    await mountFixture(page, "plate-taller-than-page", { settings: { margin: 24 } });
    await page.evaluate(
      (index) => window.frond.goToSection(index),
      PLATE_SECTION,
    );

    const overflow = await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      if (!(frame instanceof HTMLIFrameElement)) return -1;
      const inner = frame.contentDocument;
      const image = inner === null ? null : inner.querySelector(".plate img");
      if (inner === null || image === null) return -1;

      const rect = image.getBoundingClientRect();
      return rect.bottom - inner.documentElement.clientHeight;
    });

    // With the ailment present this number is in the hundreds: the image extends past the
    // container and is clipped by `overflow: hidden`, and since pagination advances along
    // the inline axis, the clipped part **cannot be reached by turning pages either**.
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * A table taller than a column — **the three engines disagree, frond cannot fix it, and so
 * this group pins the status quo**.
 *
 * Written the way `regional-faces.spec.ts` handles #4: rather than expecting the three to
 * agree, each engine's measured behaviour goes into a table and the assertion is that they
 * are still that way. The divergence is a property of the browsers and frond decides
 * whether to intervene from it, so somebody has to know when it changes.
 *
 * ## Why `cap-overflowing-boxes` does nothing for tables
 *
 * `:root table { max-block-size: <one column>px }` is a no-op on a table: CSS specifies
 * that `height` / `max-height` are a **minimum** rather than a maximum on
 * `display: table` elements, and a table always grows to its content. The plate case
 * (`plate-taller-than-page`) is fixable precisely because replaced elements have no such
 * exception — which is why the two fixtures cannot be merged.
 *
 * ## Why it is not fixed
 *
 * The route that remains is replacing `display: table` (as block, each row becomes a block
 * and the content flows into the adjacent columns, all of it reachable), at the cost of
 * **losing the table's alignment entirely**. Whether "readable but misaligned" beats
 * "aligned but half invisible" is a trade-off decision rather than a bug fix, so it is
 * registered as a gap (`src/renderer/interventions.ts`) rather than quietly done here.
 *
 * Nine sections across three books in the sample have this shape, the worst of them
 * clipping 2563px.
 */
test.describe("a table taller than a column (the engines disagree; pinning the status quo)", () => {
  /** The table is in the last section (`ailments.ts`). */
  const TABLE_SECTION = 2;

  /**
   * Whether this engine fragments a table taller than a column into adjacent columns.
   *
   * Measured (in `Dockerfile`'s image): **only Firefox does not**. Chromium and WebKit both
   * split the table into three fragments across adjacent columns, with 0 overflow; Firefox
   * splits nothing, laying the table out 1302px tall, extending 751px past the container
   * before `overflow: hidden` clips it.
   *
   * The cost in Firefox is more than those 751px: not fragmenting means the content does not
   * extend along the inline axis, so **the whole section's page count becomes 1** — and
   * everything after the table becomes unreachable to the reader as well.
   *
   * This distribution matches real books: the three books with tables in the sample
   * (《FIRE．致富實踐》, 《幽靈帝國拜占庭》, 《激進市場》) have no overflow in Chromium or
   * WebKit and only in Firefox, the worst section clipping 2563px.
   */
  const FRAGMENTS_TALL_TABLES: Record<string, boolean> = {
    chromium: true,
    webkit: true,
    firefox: false,
  };

  test("whether the table fragments matches this engine's measured behaviour", async ({ page }, info) => {
    const fragments = FRAGMENTS_TALL_TABLES[info.project.name];
    expect(
      fragments,
      `FRAGMENTS_TALL_TABLES is missing ${info.project.name} — a new browser has to be measured first.`,
    ).toBeDefined();

    await mountFixture(page, "table-taller-than-page", { settings: { margin: 24 } });
    await page.evaluate(
      (index) => window.frond.goToSection(index),
      TABLE_SECTION,
    );

    const measured = await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      if (!(frame instanceof HTMLIFrameElement)) return null;
      const inner = frame.contentDocument;
      const table = inner === null ? null : inner.querySelector("table");
      if (inner === null || table === null) return null;

      const root = inner.documentElement;
      const rows = [...inner.querySelectorAll("tr")];
      const lastRow = rows[rows.length - 1];
      return {
        // Horizontal's block axis is y (the table in `geometry.ts`). Overflow means "content
        // falls outside the container".
        blockOverflow: root.scrollHeight - root.clientHeight,
        blockExtent: root.clientHeight,
        rows: rows.length,
        lastRowInsideBlockAxis:
          lastRow !== undefined &&
          lastRow.getBoundingClientRect().bottom <= root.clientHeight,
      };
    });

    expect(measured).not.toBeNull();
    // The premise: this fixture's table really does not fit in one column.
    //
    // **`table.getBoundingClientRect().height` cannot be used to ask this**: the engines
    // that fragment return the union of all fragments, whose height is exactly one column
    // (552), so "taller than a column" never holds for them. What has to be asked is the row
    // count and the content — 30 rows at about 29px each far exceeds 552.
    expect(measured!.rows).toBe(30);

    if (fragments === true) {
      expect(measured!.blockOverflow).toBeLessThanOrEqual(2);
      // For the engines that fragment, the last row really is inside the container — 0
      // overflow could also mean the table never drew at all, and this extra case separates
      // that.
      expect(measured!.lastRowInsideBlockAxis).toBe(true);
    } else {
      // This line is "the status quo" rather than "the expectation": the most likely reason
      // for it going red is that browser gaining support for fragmenting tables across
      // columns — at which point FRAGMENTS_TALL_TABLES gets updated and the gap can come off
      // interventions.ts.
      expect(measured!.blockOverflow).toBeGreaterThan(2);
    }
  });
});
