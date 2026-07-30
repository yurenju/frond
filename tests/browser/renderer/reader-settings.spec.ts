import { expect, test, type Page } from "@playwright/test";
import { mountFixture, openHarness, type SettingsPatch } from "../support/harness.js";

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

/**
 * The theme's link colour.
 *
 * `foreground` is applied to every element, `a` included — so with a theme set and nothing
 * else, a link comes out the same colour as the text around it and the reader cannot see
 * what is tappable. Excluding `a` from the colour rule instead would leave the book's own
 * dark blue on a dark background, and "the content cannot be read" is the one reason
 * ADR-0003 recognises for intervening: that would trade one ailment for another.
 *
 * The content is hand-written through `mountInline` rather than made a committed fixture:
 * a link is not an ailment, and ADR-0007's discipline is one file per ailment.
 */
test.describe("link colour", () => {
  /** The book fights for its own link colour on both routes that can beat a stylesheet. */
  const LINKED_SECTION = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head>
    <title>t</title>
    <style>
      a#declared { color: #003399 !important; }
    </style>
  </head>
  <body>
    <p id="prose">本文がここにあります。</p>
    <p><a id="declared" href="#prose">宣言された色のリンク</a></p>
    <p><a id="inline" href="#prose" style="color: #003399 !important">属性に書かれた色のリンク</a></p>
  </body>
</html>`;

  const DARK = { foreground: "#eeeeee", background: "#111111" } as const;

  async function mountLinked(page: Page, theme: SettingsPatch["theme"]): Promise<void> {
    await page.evaluate(
      ([source, chosen]) =>
        window.frond.mountInline([source as string], {
          settings: { theme: chosen as SettingsPatch["theme"] },
        }),
      [LINKED_SECTION, theme] as const,
    );
  }

  test("the reader's link colour beats the book's, in a stylesheet and in a style attribute", async ({
    page,
  }) => {
    await mountLinked(page, { ...DARK, link: "#8ab4f8" });

    // `a#declared` is (1,0,1) and the reader's `:root a` is only (0,1,1) — what makes the
    // reader win is that the book's !important is demoted first (`overriddenProperties`
    // puts `color` in scope as soon as a theme is set). The style attribute is the harder
    // half: no position in the cascade beats an !important written there.
    expect(await computed(page, "a#declared", "color")).toBe("rgb(138, 180, 248)");
    expect(await computed(page, "a#inline", "color")).toBe("rgb(138, 180, 248)");

    // And the point of the whole field: the link is not the colour of the text around it.
    expect(await computed(page, "#prose", "color")).toBe("rgb(238, 238, 238)");
  });

  test("with no link colour set, links take the body text's colour — unchanged", async ({
    page,
  }) => {
    // The status quo, held here so that adding `Theme.link` cannot have quietly changed
    // what every existing consumer renders. frond picks no default of its own: a link
    // colour it chose would be exactly the presentational opinion it declines to hold.
    await mountLinked(page, DARK);

    expect(await computed(page, "a#declared", "color")).toBe("rgb(238, 238, 238)");
    expect(await computed(page, "a#inline", "color")).toBe("rgb(238, 238, 238)");
    expect(await computed(page, "#prose", "color")).toBe("rgb(238, 238, 238)");
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

/**
 * The generic families the book delegated to the platform (`settings.genericFamilies`).
 *
 * ADR-0003's table used to answer this case with "the book wins", and that verdict still
 * holds for frond acting on its own — which is what the first case here measures. The rest
 * measure the reader's route: a bare `serif` names no face, and for CJK the three engines
 * resolve that delegation to different ones (#4).
 *
 * The content is hand-written through `mountInline` rather than made a committed fixture:
 * ADR-0007's discipline is one file per layout **ailment**, and "the book delegates its face
 * to the platform" is not an ailment — it is the norm.
 */
test.describe("generic families", () => {
  const SECTION = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head><title>t</title><style>
    p { font-family: serif }
    .named { font-family: "Noto Sans CJK JP" }
  </style></head>
  <body><p>朝の光が差す。</p><p class="named">朝の光が差す。</p></body>
</html>`;

  const mount = async (
    page: Parameters<typeof mountFixture>[0],
    settings: SettingsPatch,
  ): Promise<void> => {
    await page.evaluate(
      ([source, patch]) =>
        window.frond.mountInline([source as string], {
          settings: patch as SettingsPatch,
        }),
      [SECTION, settings] as const,
    );
  };

  test("with no preference from the reader, the book's serif stands", async ({ page }) => {
    // user story 45, and the half of ADR-0003 this setting does not touch: unset, frond
    // substitutes nothing and the platform decides, exactly as before.
    await mount(page, {});

    expect(await computed(page, "p", "font-family")).toBe("serif");
  });

  test("the reader's stack fills in the delegation, with the keyword still last", async ({
    page,
  }) => {
    await mount(page, { genericFamilies: { serif: '"Noto Serif CJK JP"' } });

    // `toContain` rather than an equality: how the three engines serialize a font-family
    // list back out (which names they quote) is their own business, and pinning it here
    // would measure that instead of the substitution.
    const family = await computed(page, "p", "font-family");
    expect(family).toContain("Noto Serif CJK JP");
    // The keyword survives as the last resort — a stack whose faces are not installed would
    // otherwise leave this stretch with no fallback at all.
    expect(family).toContain("serif");
  });

  test("a face the book actually named is left alone", async ({ page }) => {
    // **The whole difference from `fontFamily`.** This setting reaches only the stretches
    // the book declined to decide; a reader who wants the publisher's typography has
    // nowhere else to go.
    await mount(page, { genericFamilies: { serif: '"Noto Serif CJK JP"' } });

    const family = await computed(page, ".named", "font-family");
    expect(family).toContain("Noto Sans CJK JP");
    expect(family).not.toContain("Noto Serif CJK JP");
  });

  test("the keyword the reader said nothing about is untouched", async ({ page }) => {
    await mount(page, { genericFamilies: { sansSerif: '"Noto Sans CJK JP"' } });

    expect(await computed(page, "p", "font-family")).toBe("serif");
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

/**
 * Every rewrite is applied to a book's stylesheet **once**.
 *
 * This is not a style preference. `inlineStylesheets` turns a `<link rel="stylesheet">` into a
 * `<style>`, and `rewriteInlineStyles` walks every `<style>` — so in the wrong order a linked
 * stylesheet goes through the whole pipeline twice.
 *
 * Twice was survivable while every rewrite was idempotent, and it still duplicated the
 * `writing-mode` declaration that the prefix rule adds. It stopped being survivable with
 * `resolveGenericFamilies`: that one deliberately leaves the generic keyword in place as the last
 * resort, so a second pass substitutes the whole stack again in front of it — and the reader's
 * faces end up listed twice with `serif` stranded in the middle, where nothing after it is
 * reachable. Measured on a real book, the result was vertical text drawn with collapsed metrics.
 */
test.describe("a linked stylesheet is transformed exactly once", () => {
  const LINKED_SECTION = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head><title>t</title><link rel="stylesheet" href="book.css"/></head>
  <body><p>朝の光が差す。</p></body>
</html>`;

  const BOOK_CSS = `html { -epub-writing-mode: vertical-rl }
p { font-family: "Yu Mincho", serif }`;

  test("the reader's stack is substituted once, and the keyword stays last", async ({ page }) => {
    await page.evaluate(
      ([section, css]) =>
        window.frond.mountInline([section as string], {
          settings: { genericFamilies: { serif: '"Noto Serif CJK JP"' } },
          resources: { "book.css": css as string },
        }),
      [LINKED_SECTION, BOOK_CSS] as const,
    );

    const html = await page.evaluate(() => window.frond.html());
    const substitutions = html.split("Noto Serif CJK JP").length - 1;
    expect(substitutions, "the stack appears once per declaration").toBe(1);
    // And the keyword is where it belongs: at the end of the list, not stranded mid-way.
    expect(html).toContain('"Noto Serif CJK JP", serif');
  });

  test("the prefix rule adds the unprefixed writing-mode once", async ({ page }) => {
    // The same double pass, in the form it took before anything depended on it.
    await page.evaluate(
      ([section, css]) =>
        window.frond.mountInline([section as string], {
          resources: { "book.css": css as string },
        }),
      [LINKED_SECTION, BOOK_CSS] as const,
    );

    // Counted **inside the book's own style block**, not over the whole document: frond appends
    // its layout stylesheet to the same `<head>`, and that one legitimately declares
    // `writing-mode` too.
    const bookCss = await page.evaluate(() => window.frond.bookStylesheets().join("\n"));
    const added = bookCss.split("writing-mode: vertical-rl").length - 1;
    // One inside the prefixed declaration the book wrote (it contains the unprefixed spelling as
    // a substring), one for the declaration frond adds beside it.
    expect(added).toBe(2);
  });
})
