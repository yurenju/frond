import { expect, test } from "@playwright/test";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * Isolation: nothing in the book can run, and the book's CSS cannot pollute the consumer
 * (ADR-0006, user stories 52 and 53).
 *
 * > Because of WebKit bug 218086, an iframe has to carry `allow-scripts` to emit events at
 * > all, and once it does, the sandbox loses most of its isolation value. frond therefore
 * > **does not support** EPUB scripted content … this is a **security decision, not a
 * > feature trade-off**.
 *
 * "Does not support" has exactly one meaning in implementation: **remove anything that can
 * run from the document**. The sandbox is no help (`allow-scripts` was forced open by
 * WebKit) and neither is the origin (`blob:` carries the consumer app's own origin). So
 * this spec is that defence's only guard.
 *
 * The content is hand-written through `mountInline` rather than made a committed fixture:
 * ADR-0007's discipline is one file per **layout ailment**, and "the book contains a
 * script" is a security property, not a layout ailment.
 */

/** The trace a script leaves when it runs. It only counts if it lands on the **outer page**. */
const MARKER = "__frond_script_ran__";

function sectionWith(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head><title>t</title></head>
  <body><p>本文がここにあります。</p>${body}</body>
</html>`;
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await page.evaluate((marker) => {
    (window as unknown as Record<string, unknown>)[marker] = false;
  }, MARKER);
});

test.describe("scripts inside the book", () => {
  test("a <script> never enters the document, and never runs", async ({ page }) => {
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [sectionWith(`<script>window.top["${MARKER}"] = true;</script>`)] as const,
    );

    expect(await page.evaluate(() => window.frond.html())).not.toContain("<script");
    expect(
      await page.evaluate(
        (marker) => (window as unknown as Record<string, unknown>)[marker],
        MARKER,
      ),
    ).toBe(false);
  });

  test("a <script> inside SVG is stripped too — it is in another namespace", async ({ page }) => {
    // `getElementsByTagName("script")` matches on qualified name in an XML document, so a
    // prefixed spelling slips through. This pins the choice of "query the NS version".
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [
        sectionWith(
          `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">` +
            `<script>window.top["${MARKER}"] = true;</script></svg>`,
        ),
      ] as const,
    );

    expect(await page.evaluate(() => window.frond.html())).not.toContain("<script");
    expect(
      await page.evaluate(
        (marker) => (window as unknown as Record<string, unknown>)[marker],
        MARKER,
      ),
    ).toBe(false);
  });

  test("on* event attributes are stripped", async ({ page }) => {
    // Stripping only <script> would leave this route open.
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [sectionWith(`<p onclick="window.top['${MARKER}'] = true;">押す</p>`)] as const,
    );

    expect(await page.evaluate(() => window.frond.html())).not.toContain("onclick");
  });
});

test.describe("nested browsing contexts", () => {
  /**
   * This group guards the slot most easily missed and worst in consequence.
   *
   * `<iframe>` and `<object>` open **nested browsing contexts**, and a nested context
   * **inherits** its parent's sandbox flags — including the `allow-scripts` WebKit forced
   * open. The document it loads never passed through `stripScriptedContent` (that step only
   * cleans the outermost one), and `blob:` carries the consumer app's origin.
   *
   * Stack those three and the result is: put a script-carrying XHTML in the book, point an
   * `<iframe>` at it, and that script runs with the app's origin — entirely regardless of
   * whether `<script>` was stripped.
   */
  for (const [name, markup] of [
    ["iframe", `<iframe src="inline-2.xhtml"></iframe>`],
    ["object", `<object data="inline-2.xhtml" type="application/xhtml+xml"></object>`],
    ["embed", `<embed src="inline-2.xhtml" type="application/xhtml+xml"/>`],
  ] as const) {
    test(`<${name}> is removed entirely, and the document it points at is never loaded`, async ({ page }) => {
      const hostile = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head>
<body><script>window.top["${MARKER}"] = true;</script><p>埋め込み</p></body></html>`;

      await page.evaluate(
        ([outer, inner]) =>
          window.frond.mountInline([outer as string, inner as string], {}),
        [sectionWith(markup), hostile] as const,
      );

      const html = await page.evaluate(() => window.frond.html());
      expect(html).not.toContain(`<${name}`);

      // The outer page was not written to — that is the real criterion for "ran with the
      // app's origin".
      expect(
        await page.evaluate(
          (marker) => (window as unknown as Record<string, unknown>)[marker],
          MARKER,
        ),
      ).toBe(false);

      // And the book itself is still readable: what was removed is the vehicle, not the
      // content.
      expect(html).toContain("本文がここにあります");
    });
  }
});

/**
 * What removing an element costs: **the CFI index of every following sibling shifts.**
 *
 * `stripScriptedContent`'s `element.remove()` is the only place frond changes the node
 * count — every other intervention preserves it (`link.replaceWith(style)` is 1:1, frond's
 * own two `<style>` elements only append to `<head>`). A CFI numbers an element by its
 * position among its siblings, so one removal moves everything after it by two, and the
 * symptom is a reader's highlight silently landing on different text.
 *
 * ## Measured, this has never once happened
 *
 * 34 books in circulation, 1638 sections: `<script>` in `<body>` is **0**, and so are
 * `<iframe>` / `<object>` / `<embed>` / `<frame>` and `on*` attributes. The 1456 scripts that
 * do exist are all in `<head>` — and removing something there shifts nothing an annotation
 * could point at, because `<head>` is `/2` and `<body>` is `/4` regardless of what is inside
 * `<head>`. So the `scripted-content-in-body` fixture is synthetic; no real book has this
 * shape (ADR-0007).
 */
test.describe("removing an element shifts the CFIs after it", () => {
  /**
   * The **status quo**, not the ideal behaviour.
   *
   * `/4/6` is the paragraph's index **after** the `<script>` and `<iframe>` between it and
   * the paragraph above have been removed; in the file on disk it is `/4/10`. Nothing here
   * argues that this is right — a placeholder element preserving the node count would be a
   * defensible choice too, and the measurement above is the reason not to make it now.
   *
   * What this test buys is that **making that change has to go through changing this test**,
   * the same shape as `INTERVENTIONS` being guarded by set equality. The rule the numbers
   * below imply — a removal-shaped intervention is a CFI-level breaking change — is written
   * down in ADR-0008.
   */
  test("the paragraph after the removed nodes answers to its shifted CFI", async ({
    page,
  }) => {
    await mountFixture(page, "scripted-content-in-body");

    // `/6/2` is the first itemref, `!/4` the body, `/6` the body's third element child:
    // <h1>, <p>, <p> — with the <script> and <iframe> gone.
    const shifted = await page.evaluate(() =>
      window.frond.textAt("epubcfi(/6/2!/4/6/1:0)", 5),
    );
    expect(shifted).toBe("机の上には");

    // And the index that paragraph has in the file on disk now walks into nothing: the body
    // has four element children, not five. **This is the failure mode in the abstract**: a
    // CFI written against the untouched document does not resolve to the text it named.
    expect(
      await page.evaluate(() => window.frond.textAt("epubcfi(/6/2!/4/10/1:0)", 5)),
    ).toBeNull();
  });

  test("the removal is what shifted it — the same paragraph is /4/10 in the file itself", async ({
    page,
  }) => {
    // Without this half, the case above only says "that CFI points at that text" and would
    // stay green even if `stripScriptedContent` stopped removing anything. It parses the
    // section's own bytes, so what it measures is the document **before** frond touched it.
    // Mounted only to learn where this section lives inside the archive; what is measured
    // below is the file's own bytes, fetched from the harness's route.
    const location = await mountFixture(page, "scripted-content-in-body");

    const before = await page.evaluate(async (path) => {
      const source = await (
        await fetch(
          `/book/scripted-content-in-body/bytes?path=${encodeURIComponent(path as string)}`,
        )
      ).text();
      const parsed = new DOMParser().parseFromString(source, "application/xhtml+xml");
      const children = [...(parsed.body?.children ?? [])];
      return {
        names: children.map((child) => child.localName),
        // The CFI step is twice the 1-based position among element children.
        step: (children.findIndex((child) => child.textContent?.startsWith("机の上には")) + 1) * 2,
      };
    }, location.sectionPath);

    expect(before.names).toEqual(["h1", "p", "script", "iframe", "p", "p"]);
    expect(before.step).toBe(10);
  });
});

test.describe("style isolation", () => {
  test("the book's global selectors cannot pollute the consumer's page (user story 52)", async ({ page }) => {
    // Why an iframe rather than Shadow DOM (ADR-0006): EPUB stylesheets make heavy use of
    // global selectors like `body` and `*`, and Shadow DOM does not stop pollution at that
    // level.
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [
        sectionWith(
          `<style>* { color: rgb(255, 0, 0) !important; }` +
            `body { background: rgb(0, 255, 0) !important; }</style>`,
        ),
      ] as const,
    );

    const outer = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body);
      return { color: style.color, background: style.backgroundColor };
    });

    expect(outer.color).not.toBe("rgb(255, 0, 0)");
    expect(outer.background).not.toBe("rgb(0, 255, 0)");
  });
});
