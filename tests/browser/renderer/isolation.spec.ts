import { expect, test, type Page } from "@playwright/test";
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
 * "Does not support" has exactly one meaning in implementation: **nothing that can run may
 * be left in a state where it could**. The sandbox is no help (`allow-scripts` was forced
 * open by WebKit) and neither is the origin (`blob:` carries the consumer app's own origin).
 * So this spec is that defence's only guard.
 *
 * ## Emptied where it stands, not removed
 *
 * Each such element keeps its place in the tree and loses everything else: every attribute,
 * every child. Removing it instead would shift the CFI index of every following sibling by
 * two, and a CFI is what a reader's progress and highlights are stored as (#65). The last
 * group in this file is where that is measured.
 *
 * The cost of emptying rather than removing is that the invariant gets **weaker**: "this
 * element is not in the document" cannot be eroded, whereas "this element carries nothing"
 * can be, by any later pass that sets attributes by tag name. `nothing is left that could
 * act` below is the guard against that erosion.
 *
 * The content is hand-written through `mountInline` rather than made a committed fixture:
 * ADR-0007's discipline is one file per **layout ailment**, and "the book contains a
 * script" is a security property, not a layout ailment.
 */

/** The trace a script leaves when it runs. It only counts if it lands on the **outer page**. */
const MARKER = "__frond_script_ran__";

/** What frond left of an element it emptied. */
interface Remains {
  /** Attribute names, sorted. Everything the book wrote is gone; only frond's own remain. */
  readonly attributes: readonly string[];
  /** Child nodes of any kind — text included, since a `<script>`'s payload is text. */
  readonly children: number;
}

/**
 * What is left of every element named `localName` in the rendered document.
 *
 * Reads the rendered markup back rather than trusting a substring check: "the document does
 * not contain `<iframe`" is the assertion that fits removal, and it is exactly the one that
 * stops being available once the element stays put.
 */
function remainsOf(page: Page, localName: string): Promise<readonly Remains[]> {
  return page.evaluate((name) => {
    const parsed = new DOMParser().parseFromString(window.frond.html(), "text/html");
    return [...parsed.getElementsByTagNameNS("*", name)].map((element) => ({
      attributes: [...element.attributes].map((attribute) => attribute.name).sort(),
      children: element.childNodes.length,
    }));
  }, localName);
}

/** Whether a script anywhere managed to write to the outer page. */
function scriptRan(page: Page): Promise<boolean> {
  return page.evaluate(
    (marker) => (window as unknown as Record<string, unknown>)[marker] === true,
    MARKER,
  );
}

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
  test("a <script> loses its payload and its src, and never runs", async ({ page }) => {
    // Carrying **both** routes to code at once, because `attributes: []` is only worth
    // asserting against an element that had attributes. `type` + `src` is also the only
    // shape that exists in real books — all 1456 `<script>` elements in the sample are the
    // Kobo toolchain's `<script type="text/javascript" src="../js/kobo.js"/>`.
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [
        sectionWith(
          `<script type="text/javascript" src="kobo.js">window.top["${MARKER}"] = true;</script>`,
        ),
      ] as const,
    );

    // The element stays where the book put it; what it carried does not. A `<script>` with
    // neither a `src` nor any text is prepared once when the document is parsed and runs
    // nothing — an empty one is the same to the engine as none at all.
    //
    // A surviving `src` would be the worst of the two: `rewriteResourceReferences` rewrites
    // `src` to a `blob:` address, and a `blob:` carries the consuming app's own origin.
    expect(await remainsOf(page, "script")).toEqual([{ attributes: [], children: 0 }]);
    expect(await scriptRan(page)).toBe(false);
  });

  test("a <script> inside SVG is emptied too — it is in another namespace", async ({ page }) => {
    // `getElementsByTagName("script")` matches on qualified name in an XML document, so a
    // prefixed spelling slips through. This pins the choice of "query the NS version".
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [
        sectionWith(
          `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">` +
            // `type` is here for the same reason as in the case above: so that the
            // "no attributes left" half of the assertion has something to be about.
            `<script type="text/javascript">window.top["${MARKER}"] = true;</script></svg>`,
        ),
      ] as const,
    );

    expect(await remainsOf(page, "script")).toEqual([{ attributes: [], children: 0 }]);
    expect(await scriptRan(page)).toBe(false);
  });

  test("on* event attributes are stripped", async ({ page }) => {
    // Emptying only <script> would leave this route open.
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
  for (const [name, markup, frondAttributes] of [
    ["iframe", `<iframe src="inline-2.xhtml"></iframe>`, ["sandbox", "style"]],
    [
      "object",
      `<object data="inline-2.xhtml" type="application/xhtml+xml"></object>`,
      ["style"],
    ],
    ["embed", `<embed src="inline-2.xhtml" type="application/xhtml+xml"/>`, ["style"]],
  ] as const) {
    test(`<${name}> keeps its place but loses everything, and the document it points at is never loaded`, async ({ page }) => {
      const hostile = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head>
<body><script>window.top["${MARKER}"] = true;</script><p>埋め込み</p></body></html>`;

      await page.evaluate(
        ([outer, inner]) =>
          window.frond.mountInline([outer as string, inner as string], {}),
        [sectionWith(markup), hostile] as const,
      );

      // `src` / `data` are what open the nested browsing context; with them gone the element
      // addresses nothing. The two attributes frond writes in their place are the ones the
      // comment on `emptyInPlace` explains: `style` to keep the layout as it was under
      // removal, `sandbox` to shut down even the `about:blank` an srcless iframe still gets.
      expect(await remainsOf(page, name)).toEqual([
        { attributes: [...frondAttributes], children: 0 },
      ]);

      // The outer page was not written to — that is the real criterion for "ran with the
      // app's origin".
      expect(await scriptRan(page)).toBe(false);

      // And the book itself is still readable: what was emptied is the vehicle, not the
      // content.
      expect(await page.evaluate(() => window.frond.html())).toContain(
        "本文がここにあります",
      );

      // Removal used to take the box away with the element. An srcless `<iframe>` still lays
      // out at 300x150 by default, so without this the reader would see a hole in the text
      // where before there was none.
      expect(await page.evaluate((selector) => window.frond.computed(selector, "display"), name)).toBe("none");
    });
  }
});

/**
 * The reason the elements are emptied rather than removed: **a CFI is a sibling ordinal.**
 *
 * `childAt` in `cfi-dom.ts` counts element children, so an element that disappears takes two
 * off the index of every sibling after it. That would make frond's own CFIs unreadable by
 * other readers, and other readers' CFIs resolve **to the wrong node** inside frond — not
 * fail to resolve, which is loud, but silently name a different sentence. Progress and
 * annotations are stored as CFIs, so that is the whole of what breaks.
 *
 * Emptying in place is what keeps the count: an emptied `<script>` is still one element
 * child, so nothing after it moves.
 *
 * ## No real book has ever exercised this
 *
 * 34 books in circulation, 1638 sections: `<script>` in `<body>` is **0**, and so are
 * `<iframe>` / `<object>` / `<embed>` / `<frame>` and `on*` attributes. The 1456 scripts that
 * do exist are all in `<head>` — where removal shifted nothing an annotation could point at
 * either, because `<head>` is `/2` and `<body>` is `/4` regardless of what is inside
 * `<head>`. So the `scripted-content-in-body` fixture is synthetic; no real book has this
 * shape (ADR-0007). It was fixed while the cost of fixing it was zero: ADR-0008 makes a
 * removal-shaped intervention a CFI-level breaking change, and that price only ever goes up
 * as readers accumulate stored positions (#65).
 */
test.describe("emptying in place leaves every CFI where the book put it", () => {
  test("the paragraph after the emptied nodes answers to the CFI it has in the file", async ({
    page,
  }) => {
    await mountFixture(page, "scripted-content-in-body");

    // `/6/2` is the first itemref, `!/4` the body, `/10` the body's fifth element child:
    // <h1>, <p>, <script>, <iframe>, <p> — the same position it holds on disk.
    expect(
      await page.evaluate(() => window.frond.textAt("epubcfi(/6/2!/4/10/1:0)", 5)),
    ).toBe("机の上には");

    // And `/6` is the `<script>`, which is where it was: a CFI naming it walks into an
    // element with no text and resolves to nothing. Under removal `/6` was this paragraph,
    // which is precisely the silent mis-resolution being guarded against.
    expect(
      await page.evaluate(() => window.frond.textAt("epubcfi(/6/2!/4/6/1:0)", 5)),
    ).toBeNull();
  });

  test("that index is the file's own — the document frond renders has the same shape", async ({
    page,
  }) => {
    // Without this half, the case above only says "that CFI points at that text" and would
    // stay green if the fixture stopped carrying scripted content at all. It parses the
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

    const after = await page.evaluate(() => {
      const parsed = new DOMParser().parseFromString(window.frond.html(), "text/html");
      return [...(parsed.body?.children ?? [])].map((child) => child.localName);
    });

    expect(before.names).toEqual(["h1", "p", "script", "iframe", "p", "p"]);
    expect(before.step).toBe(10);
    // Element for element, in order. This is the invariant in its most direct form: frond
    // hands the CFI machinery a body of the same shape the book wrote.
    expect(after).toEqual(before.names);
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
