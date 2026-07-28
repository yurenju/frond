import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { buildDemoBook } from "../../../packages/frond/src/test-fixtures/demo-book.ts";

/**
 * The demo page (`site/`) really does run.
 *
 * ## Why this is a standing test rather than a one-off evidence spec
 *
 * `site/` is part of what ships — it is where the README points, and the only physical
 * proof of the "needs no bundler" claim. And nothing else guards it: `npm run typecheck`
 * does not see `site/app.js` (which is plain JavaScript, deliberately), and
 * `npm run build` only concerns `dist/`.
 *
 * This is not a hypothetical risk. On the first version, `#workspace { display: flex }`
 * used an id selector that overrode the UA stylesheet's `display: none` for `[hidden]`,
 * so "hide the workspace before a book is open" stopped working entirely — while the
 * JavaScript side was perfectly fine: `element.hidden = true` ran and raised nothing. That
 * kind of breakage is only visible with the page really opened.
 *
 * ## This test depends on `site/frond/` existing
 *
 * That is, it needs `npm run site` to have run. In the container the `Dockerfile` handles
 * it (the line after `COPY . .`), so `npm run test:container` simply has it.
 *
 * ## How the page reaches the browser
 *
 * Route interception, the same trick as `tests/browser/support/harness.ts` — the container
 * runs with `--network=none` and has not even loopback.
 *
 * ## The README's screenshots
 *
 * The two under `docs/images/` were taken at this test's assertion points, but the
 * screenshots themselves do not live here: a test that writes files on every CI run would
 * dirty `docs/` at random. To retake them, add `page.screenshot({ path: … })` back, go
 * through `npm run evidence` (`docs/agents/pull-requests.md`), and move the images into
 * `docs/images/`.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SITE = join(REPO_ROOT, "site");
const ORIGIN = "http://frond.test";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

test.use({ viewport: { width: 1180, height: 780 } });

/** Serves `site/` to this tab. Route interception; the reasoning is in the header comment. */
async function serveSite(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname === "/" ? "/index.html" : url.pathname;

    try {
      const body = await readFile(join(SITE, path));
      await route.fulfill({
        contentType: CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
        body,
      });
    } catch {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });
}

const DEMO_EPUB = {
  name: "demo-zh-tw.epub",
  mimeType: "application/epub+zip",
  get buffer(): Buffer {
    return Buffer.from(buildDemoBook());
  },
};

test("the demo page opens a vertical Traditional Chinese book", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });

  await serveSite(page);

  await page.goto(`${ORIGIN}/`);

  // Before opening a book: the dropzone is there and the workspace is not.
  await expect(page.locator("#dropzone")).toBeVisible();
  await expect(page.locator("#workspace")).toBeHidden();

  await page.setInputFiles("#file-input", DEMO_EPUB);

  // After opening: the title, the writing mode and the page count all have values.
  await expect(page.locator("#workspace")).toBeVisible();
  await expect(page.locator("#book-title")).toHaveText("渡口");
  await expect(page.locator("#status-writing-mode")).toHaveText("Vertical");
  await expect(page.locator("#status-page")).toContainText("Page 1 /");
  await expect(page.locator("#status-cfi")).toContainText("epubcfi(");

  // fraction only has a value once the whole-book index is built (user story 25).
  await expect(page.locator("#status-fraction")).toContainText("%");

  // Page turning works, and turning back returns.
  const first = await page.locator("#status-cfi").textContent();
  await page.locator("#next").click();
  await expect(page.locator("#status-cfi")).not.toHaveText(first ?? "");
  await page.locator("#previous").click();
  await expect(page.locator("#status-cfi")).toHaveText(first ?? "");

  // The inspect tab: the half that uses only EpubBook.
  await page.locator("#tab-inspect").click();
  await expect(page.locator("#panel-inspect")).toBeVisible();
  await expect(page.locator(".facts")).toContainText("EPUB 3");
  await expect(page.locator(".facts")).toContainText("rtl");

  expect(failures).toEqual([]);
});

/**
 * The viewer frame takes a book's proportions: a spread (1.4) on a wide screen, a single
 * page (0.7) on a narrow one.
 *
 * ## Why this needs a test
 *
 * The ratio is measured from the layer outside with `100cqh` (`.viewer-frame` in
 * `site/style.css`), and **container query units resolve to 0 on an ancestor chain with an
 * indefinite height** — at which point `#viewer` collapses to 2px of border and the book
 * draws not one character. Any layer on that chain switching `height` back to
 * `min-height` steps on it, while the JavaScript side is perfectly fine: `attach()`
 * succeeds, the status bar has values, and nothing raises. This version stepped on it once
 * while being written.
 *
 * So the assertions come in two halves: is the ratio right, and did the frame really
 * measure a size.
 */
test("the viewer frame is a spread on a wide screen and a single page on a narrow one", async ({ page }) => {
  await serveSite(page);
  await page.goto(`${ORIGIN}/`);
  await page.setInputFiles("#file-input", DEMO_EPUB);
  await expect(page.locator("#status-cfi")).toContainText("epubcfi(");

  const shapeOfViewer = async () => {
    const box = await page.locator("#viewer").boundingBox();
    if (box === null) throw new Error("#viewer could not be measured");
    return box;
  };

  // 1180×780: the frame is wider than a spread, so it lays out as a spread, constrained by
  // the height — it fills the available height.
  const spread = await shapeOfViewer();
  expect(spread.width / spread.height).toBeCloseTo(1.4, 1);
  expect(spread.height).toBeGreaterThan(300);

  // 390×844: a phone. A spread here would be constrained by the width and use only half the
  // height, so it switches to a single page.
  await page.setViewportSize({ width: 390, height: 844 });
  const single = await shapeOfViewer();
  expect(single.width / single.height).toBeCloseTo(0.7, 1);
  expect(single.height).toBeGreaterThan(300);

  // The book has to relayout after the size change — frond watches the container itself
  // (`Renderer`'s ResizeObserver), and the page count is the evidence that it did.
  await expect(page.locator("#status-page")).toContainText("Page 1 /");
});
