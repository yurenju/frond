import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page, expect, test } from "@playwright/test";
import { buildDemoBook } from "../../../packages/frond/src/test-fixtures/demo-book.ts";
import { collectPageErrors } from "../support/page-errors.js";
import {
  BOOK_BACKGROUND,
  PAGE_BACKGROUND,
  backgroundInsideBook,
  backgroundOfPage,
} from "./palette.js";

/**
 * The demo site's React page (`site/react/`) really does run.
 *
 * ## What it covers differs from `tests/browser/react/`
 *
 * Those run against **the source** (the harness uses esbuild aliases to point the package
 * names back at their own `src/`), so they cannot catch the errors that only exist in the
 * shipped artifact: a mistyped `exports` path, something missing from `files`, an emitted
 * `.js` short an extension. Those are fatal for a consumer and green no matter how they
 * are run inside this repo.
 *
 * This one is the reverse: it loads the `bundle.js` that `npm run site` produces, and that
 * bundle goes through node_modules resolution — that is, **the files a consumer gets after
 * `npm install`** (`scripts/bundle-site-react.ts`). So it is frond-react's version of "the
 * consumer's route".
 *
 * ## It also guards the two switches on that page
 *
 * "The default styles can be skipped entirely" and "policy has to be turned on explicitly"
 * are frond-react's two claims most easily taken as platitudes, and that page turns them
 * into switches. With the switches broken, the page would be demonstrating two unkept
 * promises — so they are asserted here.
 *
 * ## This test depends on `site/react/bundle.js` existing
 *
 * That is, it needs `npm run site` to have run. In the container the `Dockerfile` handles
 * it, so `npm run test:container` simply has it.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SITE = join(REPO_ROOT, "site");
const ORIGIN = "http://frond-site.test";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

test.use({ viewport: { width: 1180, height: 780 } });

/** Serves `site/` to this tab. Route interception; the reasoning is in `site/demo.spec.ts`'s header comment. */
async function serveSite(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.endsWith("/") ? `${url.pathname}index.html` : url.pathname;

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

/** Opens the book and waits for the first page to lay out. */
async function openDemoBook(page: Page): Promise<void> {
  await serveSite(page);
  await page.goto(`${ORIGIN}/react/`);
  await page.getByTestId("file-input").setInputFiles(DEMO_EPUB);
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");
}

test("the React demo page opens a vertical Traditional Chinese book", async ({ page }) => {
  const failures = collectPageErrors(page);

  await serveSite(page);
  await page.goto(`${ORIGIN}/react/`);

  // Before opening a book: the dropzone is there and the reader is not.
  await expect(page.getByTestId("dropzone")).toBeVisible();
  await expect(page.getByTestId("viewport")).toHaveCount(0);

  await page.getByTestId("file-input").setInputFiles(DEMO_EPUB);

  await expect(page.getByTestId("book-title")).toHaveText("渡口");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-writing-mode", "vertical-rl");
  await expect(page.getByTestId("status-writing-mode")).toHaveText("Vertical");
  await expect(page.getByTestId("status-cfi")).toContainText("epubcfi(");

  // fraction only has a value once the whole-book index is built (user story 25).
  await expect(page.getByTestId("status-fraction")).toContainText("Book progress");
  await expect(page.getByTestId("progress")).toHaveAttribute("data-state", "loaded");

  // StrictMode is on (the last part of `app.tsx`), so this also guards "an effect running
  // twice does not leave a second iframe" — and guards it against **the shipped artifact**.
  await expect(page.getByTestId("viewport").locator("iframe")).toHaveCount(1);

  expect(failures).toEqual([]);
});

test("the paging buttons work, and going back is disabled at the start", async ({ page }) => {
  await openDemoBook(page);

  const previous = page.getByTestId("previous");
  await expect(previous).toBeDisabled();
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-at-start", "");

  const first = await page.getByTestId("status-cfi").textContent();
  await page.getByTestId("next").click();
  await expect(page.getByTestId("status-cfi")).not.toHaveText(first ?? "");

  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(page.getByTestId("status-cfi")).toHaveText(first ?? "");
});

test("the font size is a controlled prop: dragging it relayouts without throwing the reader back to page one", async ({ page }) => {
  await openDemoBook(page);

  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-at-start", "");

  await page.getByTestId("next").click();
  await expect(viewport).not.toHaveAttribute("data-at-start", "");

  await page.getByTestId("font-size").fill("34");

  // The layout really did change.
  await expect(page.getByTestId("status-cfi")).toContainText("epubcfi(");

  // And the reader is **still where they were** — changing settings goes through
  // `applySettings()`, not another `attach()`. A remount would throw the reader back to the
  // start, and that happens at every notch while dragging a slider.
  //
  // The assertion is on `data-at-start` rather than a page number: page numbers change
  // wholesale with the font size, which is exactly what this setting does (CONTEXT.md: a
  // page is a product of the layout).
  await expect(viewport).not.toHaveAttribute("data-at-start", "");
  await expect(viewport.locator("iframe")).toHaveCount(1);
});

test("the default styles can be turned off, and the parts return to the browser's native look", async ({ page }) => {
  await openDemoBook(page);

  const next = page.getByTestId("next");
  const borderOf = () =>
    next.evaluate((element) => getComputedStyle(element).borderTopStyle);

  // On: the default styles cleared the native button's border.
  await expect(page.getByTestId("toggle-styles")).toBeChecked();
  expect(await borderOf()).toBe("none");

  await page.getByTestId("toggle-styles").uncheck();

  // Off: `<link disabled>`, so the whole stylesheet stops taking effect and the border
  // returns.
  //
  // This looks small, but what it guards is the sentence "the default styles are entirely
  // optional" — and the moment that stops holding, the switch on the page is demonstrating
  // an unkept promise.
  expect(await borderOf()).not.toBe("none");

  // The book is still there and was not remounted. The styles and the Renderer are unrelated
  // things.
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");
  await expect(page.getByTestId("viewport").locator("iframe")).toHaveCount(1);
});

/**
 * This demo book is vertical, so the horizontal arrow for "forward" is **ArrowLeft**
 * rather than ArrowRight.
 *
 * When `useKeyboardPaging()` is not given a page progression direction it infers one from
 * the writing mode: `vertical-rl` is always taken as `rtl` (`paging.ts`'s header comment).
 * So this test also pins that inference — written as ArrowRight it would quietly do
 * nothing, which is exactly the symptom of that inference breaking.
 */
const FORWARD_KEY = "ArrowLeft";

/**
 * Position is always read from the CFI, never from a page number.
 *
 * **A page is a product of the layout, not a property of the book** (CONTEXT.md) — one
 * section is two pages in a 780-tall window and may be one in a 900-tall one. A test
 * asserting "turned to page 3" therefore goes red after a one-line CSS change, for reasons
 * unrelated to what it guards. The first version was written that way, and went entirely
 * red after the viewer frame's height was adjusted.
 */
async function cfiOf(page: Page): Promise<string> {
  return (await page.getByTestId("status-cfi").textContent()) ?? "";
}

test("policy can be turned off: with it off the arrow keys do not turn pages and the buttons still do", async ({ page }) => {
  await openDemoBook(page);
  const start = await cfiOf(page);

  // On: the arrow keys turn pages.
  await page.keyboard.press(FORWARD_KEY);
  await expect(page.getByTestId("status-cfi")).not.toHaveText(start);
  const afterKey = await cfiOf(page);

  await page.getByTestId("toggle-paging").uncheck();

  await page.keyboard.press(FORWARD_KEY);
  await page.waitForTimeout(300);

  // With it off the keyboard does nothing — ADR-0002's line is visible on this page.
  await expect(page.getByTestId("status-cfi")).toHaveText(afterKey);

  // But the buttons still turn pages: a button is an action, not policy.
  await page.getByTestId("next").click();
  await expect(page.getByTestId("status-cfi")).not.toHaveText(afterKey);
});

test("a vertical book's arrow keys follow the page progression direction", async ({ page }) => {
  await openDemoBook(page);
  const start = await cfiOf(page);

  // Vertical ⇒ rtl ⇒ left is the next page.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("status-cfi")).not.toHaveText(start);

  // Right comes back.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("status-cfi")).toHaveText(start);

  // `ArrowDown` is "next page" in both writing modes — that is the convention of every
  // scrolling interface, and what the reader's fingers remember is that meaning, not the
  // layout direction (`paging.ts`'s comments).
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("status-cfi")).not.toHaveText(start);
});

test("the table of contents navigates", async ({ page }) => {
  await openDemoBook(page);

  const toc = page.getByTestId("toc");
  await expect(toc).toBeEnabled();

  const first = await page.getByTestId("status-cfi").textContent();
  await toc.selectOption({ index: 2 });

  await expect(page.getByTestId("status-cfi")).not.toHaveText(first ?? "");
});

/**
 * The theme is the site's on this page too, and it reaches the book through a prop.
 *
 * The home page's version of this test (`demo.spec.ts`) explains why the assertion has to
 * reach inside `contentDocument`. What is different here is the route the colours take: the
 * masthead is **outside** the React root, so the control is wired imperatively while the book
 * reads the same choice back through `useSyncExternalStore`. Those two halves can come apart
 * — the control flipping the page while the prop never updates is a live failure mode, and it
 * looks exactly like "the theme works" until you open a book.
 */
test("the site's theme reaches the book, and switching it keeps the reader's place", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openDemoBook(page);

  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  await expect(page.locator("#theme-choice")).toHaveValue("system");
  expect(await backgroundOfPage(page)).toBe(PAGE_BACKGROUND.light);
  expect(await backgroundInsideBook(page, "[data-testid='viewport']")).toBe(
    BOOK_BACKGROUND.light,
  );

  // Away from the first page, so "the theme did not remount the book" has something to say.
  await page.getByTestId("next").click();
  const where = await page.getByTestId("status-cfi").textContent();

  await page.locator("#theme-choice").selectOption("dark");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => backgroundOfPage(page)).toBe(PAGE_BACKGROUND.dark);
  await expect
    .poll(() => backgroundInsideBook(page, "[data-testid='viewport']"))
    .toBe(BOOK_BACKGROUND.dark);

  // `settings` changing is `applySettings()`, not another `attach()` — one iframe, same place
  // in the book. A remount here would be especially visible: `Root` rebuilds the iframe and
  // waits on fonts again.
  await expect(page.getByTestId("status-cfi")).toHaveText(where ?? "");
  await expect(page.getByTestId("viewport").locator("iframe")).toHaveCount(1);
});

test("the system changing reaches a book already on screen", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await openDemoBook(page);

  await page.emulateMedia({ colorScheme: "dark" });

  // Nothing was chosen, so the page follows by stylesheet alone; the book follows only
  // because the subscription re-rendered `App` with new colours.
  await expect.poll(() => backgroundOfPage(page)).toBe(PAGE_BACKGROUND.dark);
  await expect
    .poll(() => backgroundInsideBook(page, "[data-testid='viewport']"))
    .toBe(BOOK_BACKGROUND.dark);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme");
});
