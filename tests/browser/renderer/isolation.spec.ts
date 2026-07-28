import { expect, test } from "@playwright/test";
import { openHarness } from "../support/harness.js";

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
