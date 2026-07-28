import { expect, test } from "@playwright/test";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * Reader settings, and their fight with the book's cascade.
 *
 * ADR-0003 sets the order of authority as `reader settings > frond's corrections > the
 * book's declarations`, and names the fact that this **is not free**:
 *
 * > A book may write `font-size: 12px !important`, and an external stylesheet cannot beat
 * > an inline `!important`. frond therefore needs a serious cascade-fighting mechanism
 * > internally, not just an injected block of CSS — this is one of the things frond
 * > genuinely has to build beyond what foliate does.
 *
 * Every case in this spec measures that mechanism's result. And **the reverse matters just
 * as much**: for anything the reader has not set, the book's declarations must not change
 * by one character (user story 45). Those cases are the gatekeepers stopping the
 * intervention list from growing quietly.
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("with no reader setting, the book decides", () => {
  test("a size the book pins with !important still takes effect", async ({ page }) => {
    // ADR-0003's threshold: with no reader setting, nothing is being blocked, and so there
    // is no reason to intervene.
    await mountFixture(page, "font-size-important");

    expect(await computed(page, "p", "font-size")).toBe("12px");
  });

  test("colours the book pins still take effect", async ({ page }) => {
    await mountFixture(page, "hardcoded-colors");

    expect(await computed(page, "body", "color")).toBe("rgb(0, 0, 0)");
    expect(await computed(page, "body", "background-color")).toBe("rgb(255, 255, 255)");
  });

  test("the injected reader stylesheet is empty", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const html = await page.evaluate(() => window.frond.html());
    expect(html).toMatch(/<style[^>]*id="frond-reader"[^>]*>\s*<\/style>/);
  });
});

test.describe("font size", () => {
  test("with no opinion from the book, the reader's size is the size", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: { fontSize: 24 } });

    expect(await computed(page, "p", "font-size")).toBe("24px");
  });

  test("an !important pinned by the book does not stop the reader", async ({ page }) => {
    // user story 42. The book says 12px (0.75 of the 16px default), the reader sets the
    // basis to 24px, so the body text is 18px — **the book's own ratio is kept and the
    // absolute value goes to the reader**.
    await mountFixture(page, "font-size-important", { settings: { fontSize: 24 } });

    expect(await computed(page, "p", "font-size")).toBe("18px");
  });

  test("adjusting again moves the ratio with it", async ({ page }) => {
    // This is what proves the size is really "adjustable" rather than swapped for another
    // fixed value.
    await mountFixture(page, "font-size-important", { settings: { fontSize: 24 } });
    await page.evaluate(() => window.frond.applySettings({ fontSize: 32 }));

    expect(await computed(page, "p", "font-size")).toBe("24px");
  });

  test("the book's own size hierarchy is kept — headings are still larger than body text", async ({ page }) => {
    await mountFixture(page, "font-size-important", { settings: { fontSize: 24 } });

    const heading = parseFloat(await computed(page, "h1", "font-size"));
    const paragraph = parseFloat(await computed(page, "p", "font-size"));

    expect(heading).toBeGreaterThan(paragraph);
  });
});

test.describe("font family and line height", () => {
  test("a face the reader names overrides the book's declaration", async ({ page }) => {
    // A named face rather than a generic family: the three engines do not resolve generics
    // to CJK faces consistently (#4), and reader settings are the one layer in the order of
    // authority that may legitimately name a face (ADR-0004).
    await mountFixture(page, "vertical-japanese", {
      settings: { fontFamily: '"Noto Sans CJK JP"' },
    });

    expect(await computed(page, "p", "font-family")).toContain("Noto Sans CJK JP");
  });

  test("line height takes effect", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", {
      settings: { fontSize: 20, lineHeight: 2 },
    });

    expect(await computed(page, "p", "line-height")).toBe("40px");
  });
});

test.describe("themes", () => {
  test("with black on white pinned by the book, the reader's dark mode still takes effect", async ({ page }) => {
    // user story 43.
    await mountFixture(page, "hardcoded-colors", {
      settings: { theme: { foreground: "#eeeeee", background: "#111111" } },
    });

    expect(await computed(page, "body", "color")).toBe("rgb(238, 238, 238)");
    // The white background the book set on body becomes transparent and the reader's shows
    // through from the root element — setting the reader's background everywhere would
    // erase the quote blocks a book distinguishes by background colour.
    expect(await computed(page, "body", "background-color")).toBe("rgba(0, 0, 0, 0)");
    expect(await computed(page, "html", "background-color")).toBe("rgb(17, 17, 17)");
  });

  test("the background is painted on the container too, leaving no white ring at the margin", async ({ page }) => {
    // The margin is outside the iframe, so it is not in the book's document — painting only
    // the document leaves a ring of the consumer page's white around the text in dark mode.
    // This case was added for a defect read off the screenshots in `docs/evidence/32/`.
    await mountFixture(page, "hardcoded-colors", {
      settings: { theme: { foreground: "#eeeeee", background: "#111111" } },
    });

    const background = await page.evaluate(() => {
      const container = document.getElementById("viewport");
      return container === null
        ? ""
        : window.getComputedStyle(container).backgroundColor;
    });

    expect(background).toBe("rgb(17, 17, 17)");
  });

  test("with no theme, the container's background is left alone", async ({ page }) => {
    // At that point the consumer's own background is the right answer.
    await mountFixture(page, "hardcoded-colors");

    const inline = await page.evaluate(
      () => document.getElementById("viewport")?.style.backgroundColor ?? "",
    );

    expect(inline).toBe("");
  });
});

test.describe("a book with a fixed width", () => {
  test("width: 800px is not clipped in a smaller layout", async ({ page }) => {
    // ADR-0003's "the content is unreadable" slot. Container 800, margin 24, one column, so
    // a column is 752 wide.
    await mountFixture(page, "fixed-width-800", {
      settings: { margin: 24, columns: 1 },
    });

    expect(await computed(page, "body", "width")).toBe("752px");
  });

  test("the intervention is a no-op when it fits", async ({ page }) => {
    // This blocks the over-intervention of "always shrink body to the layout width": when
    // the book asks for 800px and a column has 900px, the book should get the 800px it
    // asked for.
    await mountFixture(page, "fixed-width-800", {
      settings: { margin: 24, columns: 1 },
      viewport: { width: 948, height: 600 },
    });

    expect(await computed(page, "body", "width")).toBe("800px");
  });

  test("with two columns the cap is one column's width, not the whole layout", async ({ page }) => {
    // A percentage inside a multicol container is **relative to one column**, not to the
    // container — so `max-inline-size: 100%` means exactly "the content has to fit in one
    // column". That is precisely what this intervention means, but it is a property of CSS
    // rather than a rule frond wrote, so it is pinned here: the day the percentage's basis
    // changes, this case goes red and no other one does.
    //
    // Layout 752 with a 40 gap, so two columns of 356 each.
    await mountFixture(page, "fixed-width-800", {
      settings: { margin: 24, columns: 2 },
    });

    expect(await computed(page, "body", "width")).toBe("356px");
  });
});

test.describe("column count", () => {
  test("horizontal can ask for two columns", async ({ page }) => {
    await mountFixture(page, "huge-single-section", { settings: { columns: 2 } });

    expect(await computed(page, "html", "column-count")).toBe("2");
  });

  test("vertical is always one column, even when two are set", async ({ page }) => {
    // A deliberate simplification ADR-0003 lists explicitly. Not an error, just a preference
    // that does not apply right now.
    await mountFixture(page, "vertical-japanese", { settings: { columns: 2 } });

    expect(await computed(page, "html", "column-count")).toBe("1");
  });
});

test.describe("margins", () => {
  test("the margin comes from insetting the iframe, not from injecting padding into the book", async ({ page }) => {
    // Injecting padding into a multicol container gives the first column a different origin
    // from the rest, and "one page turn = one stride" stops holding. So the book's body gets
    // no padding at all.
    await mountFixture(page, "huge-single-section", { settings: { margin: 50 } });

    expect(await computed(page, "html", "width")).toBe("700px");
    expect(await computed(page, "body", "padding-top")).toBe("0px");
  });

  test("changing the margin changes the layout with it", async ({ page }) => {
    await mountFixture(page, "huge-single-section", { settings: { margin: 50 } });
    await page.evaluate(() => window.frond.applySettings({ margin: 10 }));

    expect(await computed(page, "html", "width")).toBe("780px");
  });

  /**
   * Axis-relative margins: what the reader adjusts is **line length**.
   *
   * Horizontal adjusts left and right and vertical adjusts top and bottom, which look like
   * two things and are both the inline axis. Expressed with physical edges, the same
   * preference would need a different field filled in on a vertical book, and every consumer
   * would have to do that conversion themselves.
   *
   * The point of these two tests is that they are **opposites**: one `{ block, inline }`
   * has to land on different physical edges when horizontal and when vertical. Getting it
   * backwards raises no error — the margins still shrink, it is just that the line length
   * does not move at all while the reader drags the slider.
   */
  test("horizontal: inline lands on left and right, block on top and bottom", async ({ page }) => {
    await mountFixture(page, "huge-single-section", {
      settings: { margin: { block: 10, inline: 60 } },
    });

    const box = await page.evaluate(() => window.frond.frameBox());
    expect(box).toMatchObject({ x: 60, y: 10, width: 680, height: 580 });
  });

  test("vertical: inline lands on top and bottom, block on left and right — the opposite of horizontal", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", {
      settings: { margin: { block: 10, inline: 60 } },
    });

    const box = await page.evaluate(() => window.frond.frameBox());
    expect(box).toMatchObject({ x: 10, y: 60, width: 780, height: 480 });
  });

  test("a scalar is still all four edges alike", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: { margin: 30 } });

    const box = await page.evaluate(() => window.frond.frameBox());
    expect(box).toMatchObject({ x: 30, y: 30, width: 740, height: 540 });
  });

  /**
   * `rectsFor()`'s origin and the iframe's position have to agree.
   *
   * A consumer takes the rectangles and draws a highlight on the container. When the two
   * use different frames of reference, the symptom is the whole highlight offset by one
   * margin — and with axis-relative margins the four edges differ, so the offset differs
   * between the two directions as well.
   */
  test("under axis-relative margins, the rectangles still land in the right place in the container", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", {
      settings: { margin: { block: 10, inline: 60 } },
    });
    await page.evaluate(() => window.frond.selectText("p"));

    const [box, rects] = await Promise.all([
      page.evaluate(() => window.frond.frameBox()),
      page.evaluate(() => {
        const location = window.frond.snapshot();
        return window.frond.rectsFor(location.cfi);
      }),
    ]);

    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(box.x);
      expect(rect.y).toBeGreaterThanOrEqual(box.y);
      expect(rect.x).toBeLessThanOrEqual(box.x + box.width);
      expect(rect.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });
});

async function computed(
  page: Parameters<typeof mountFixture>[0],
  selector: string,
  property: string,
): Promise<string> {
  return page.evaluate(
    ([element, name]) => window.frond.computed(element as string, name as string),
    [selector, property] as const,
  );
}
