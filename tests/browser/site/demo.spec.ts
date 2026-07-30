import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { buildDemoBook } from "../../../src/test-fixtures/demo-book.ts";
import { collectPageErrors } from "../support/page-errors.js";
import {
  BOOK_BACKGROUND,
  PAGE_BACKGROUND,
  backgroundInsideBook,
  backgroundOfPage,
} from "./palette.js";

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
  const failures = collectPageErrors(page);

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

/**
 * The theme is the site's, and the book is inside it.
 *
 * ## Why this needs a test rather than an eyeball
 *
 * The two halves of the switch travel by completely different routes. Outside the book it is
 * `color-scheme` on `<html>` and `light-dark()` pairs in the stylesheet, and it is impossible
 * to get subtly wrong — it either flips or it does not. **Inside the book nothing of the sort
 * applies**: the book renders in an iframe, the page's CSS stops at its edge, and the colours
 * only arrive because `app.js` hands them to frond as `settings.theme`. Break that one wiring
 * and the page turns dark while the book stays a sheet of white paper — with nothing thrown,
 * nothing logged, and every other test still green.
 *
 * That is why the assertions below reach into `contentDocument` rather than settling for the
 * container behind it: the container is `--panel` by stylesheet regardless, so it would look
 * right even with the theme never reaching frond at all.
 */
test("the site follows the system's colour scheme, and the book turns with it", async ({ page }) => {
  await serveSite(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${ORIGIN}/`);

  // Nothing has been chosen, so there is no attribute at all — `:root`'s own
  // `color-scheme: light dark` is what follows the system, and it does so with no JavaScript.
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("#theme-choice")).toHaveValue("system");
  expect(await backgroundOfPage(page)).toBe(PAGE_BACKGROUND.light);

  await page.setInputFiles("#file-input", DEMO_EPUB);
  await expect(page.locator("#status-cfi")).toContainText("epubcfi(");
  expect(await backgroundInsideBook(page, "#viewer")).toBe(BOOK_BACKGROUND.light);

  // The system changes underneath a reader who never chose anything. The page follows because
  // of the stylesheet; the book follows only because `theme.js` woke `app.js` up and it
  // re-applied the settings.
  await page.emulateMedia({ colorScheme: "dark" });

  await expect.poll(() => backgroundOfPage(page)).toBe(PAGE_BACKGROUND.dark);
  await expect.poll(() => backgroundInsideBook(page, "#viewer")).toBe(BOOK_BACKGROUND.dark);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});

test("an explicit choice overrides the system, keeps the reader's place, and is remembered", async ({ page }) => {
  await serveSite(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${ORIGIN}/`);
  await page.setInputFiles("#file-input", DEMO_EPUB);
  await expect(page.locator("#status-cfi")).toContainText("epubcfi(");

  // Somewhere other than the first page, so that "the theme did not throw the reader back to
  // the start" has something to say.
  await page.locator("#next").click();
  const where = await page.locator("#status-cfi").textContent();

  await page.locator("#theme-choice").selectOption("light");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => backgroundOfPage(page)).toBe(PAGE_BACKGROUND.light);
  await expect.poll(() => backgroundInsideBook(page, "#viewer")).toBe(BOOK_BACKGROUND.light);

  // A theme change goes through `applySettings()`, not another `attach()`. A remount would put
  // the reader back on page one — and this is the one setting a reader is most likely to
  // change *while* reading.
  await expect(page.locator("#status-cfi")).toHaveText(where ?? "");

  // Remembered: the choice is in `localStorage`, so the page comes back light on a machine
  // that is still dark, and the control agrees with it.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("#theme-choice")).toHaveValue("light");
  await expect.poll(() => backgroundOfPage(page)).toBe(PAGE_BACKGROUND.light);
});

/**
 * The stored choice is applied **before the first paint**.
 *
 * This is the `<head>` script's whole reason for existing, and it needs a test of its own:
 * the reload in the test above cannot show it. There, `theme.js` has loaded by the time the
 * background is read and would have set the very same attribute a moment later — so those
 * assertions pass with the `<head>` script deleted outright (measured, not assumed). What a
 * reader would get is a white flash on every load, and nothing would have gone red.
 *
 * So this one lets nothing but that script run: `app.js` never arrives, which takes the
 * `theme.js` it imports with it. Whatever is on `<html>` afterwards was put there before the
 * page was painted, because there was nothing else left to do it.
 */
test("the stored choice is applied before the first paint, with no module loaded", async ({
  page,
}) => {
  await serveSite(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${ORIGIN}/`);
  await page.locator("#theme-choice").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Registered after `serveSite`'s catch-all, and so consulted before it: Playwright matches
  // routes newest first.
  await page.route(`${ORIGIN}/app.js`, (route) => route.abort());
  await page.reload();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await backgroundOfPage(page)).toBe(PAGE_BACKGROUND.light);

  // And the module really did not run — otherwise this proves nothing. The control is left
  // at the markup's own first option, which is exactly what `connectChoiceControl` would
  // have corrected.
  await expect(page.locator("#theme-choice")).toHaveValue("system");
});

/** The reader toolbar no longer has a theme of its own — one question, one switch. */
test("clearing the reader settings leaves the site's theme alone", async ({ page }) => {
  await serveSite(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${ORIGIN}/`);
  await page.setInputFiles("#file-input", DEMO_EPUB);
  await expect(page.locator("#status-cfi")).toContainText("epubcfi(");

  await page.locator("#font-size").fill("34");
  await page.locator("#reset-settings").click();

  // The typography went back to the book's own declarations, but the theme is not a reader
  // setting made on this toolbar — cleared, it would leave a white book on a dark page.
  await expect.poll(() => backgroundInsideBook(page, "#viewer")).toBe(BOOK_BACKGROUND.dark);
  await expect(page.locator("#theme")).toHaveCount(0);
});
