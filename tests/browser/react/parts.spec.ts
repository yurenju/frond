import { expect, test } from "@playwright/test";
import { mount, openReactHarness } from "./support/harness.ts";

/**
 * The parts' outward surface: the `data-*` attributes, the triggers' behaviour, and
 * `asChild`.
 *
 * The `data-*` attributes are this package's only contract with CSS, so they are **public
 * surface** rather than implementation detail — renaming one silently breaks a consumer's
 * styles (CSS raises no error; it simply does not take effect). They are pinned here.
 */

test.beforeEach(async ({ page }) => {
  await openReactHarness(page);
});

test("the viewport reflects state, writing mode and the boundaries", async ({ page }) => {
  await mount(page, { book: "one" });

  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-frond-part", "viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");
  await expect(viewport).toHaveAttribute("data-writing-mode", "horizontal-tb");

  // `data-at-start` is present-means-true, with an empty string as its value. Page one
  // should have it and `data-at-end` should not — this book lays out over several pages.
  await expect(viewport).toHaveAttribute("data-at-start", "");
  await expect(viewport).not.toHaveAttribute("data-at-end", "");
});

test("the consumer's className and data attributes reach the underlying element", async ({ page }) => {
  await mount(page, { book: "one" });

  // A part's own `data-*` set must not swallow what the consumer passed in. This is
  // unstyled's minimum requirement: an element you cannot put a class on cannot be restyled
  // by any means at all.
  await expect(page.getByTestId("viewport")).toHaveClass("viewport");
});

test("the paging triggers turn pages, and are not disabled before the end", async ({ page }) => {
  await mount(page, { book: "one" });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  const next = page.getByTestId("next");
  const previous = page.getByTestId("previous");

  // Page one: backwards goes nowhere, forwards works.
  await expect(previous).toBeDisabled();
  await expect(previous).toHaveAttribute("data-disabled", "");
  await expect(next).toBeEnabled();

  await next.click();

  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(1);

  // After one page turn, backwards works. `data-disabled` has to disappear with it —
  // leaving it stops the styling at greyed-out while the button is in fact clickable.
  await expect(previous).toBeEnabled();
  await expect(previous).not.toHaveAttribute("data-disabled", "");
});

test("the triggers are disabled before anything is mounted", async ({ page }) => {
  await mount(page, { book: null });

  await expect(page.getByTestId("next")).toBeDisabled();
  await expect(page.getByTestId("previous")).toBeDisabled();
});

test("progress is indeterminate before the index is built, and carries a fraction after", async ({ page }) => {
  await mount(page, { book: "one" });

  const progress = page.getByTestId("progress");
  await expect(progress).toHaveAttribute("role", "progressbar");

  // The whole-book index is built in the background, so this slot goes from indeterminate
  // to loaded. Drawing 0 rather than indeterminate tells the reader "I am at the very start
  // of the book" — which is a lie while the computation is still running.
  await expect(progress).toHaveAttribute("data-state", "loaded");
  await expect(progress).toHaveAttribute("aria-valuenow", /.+/);
});

test("asChild uses the consumer's own button, keeping both the behaviour and the className", async ({ page }) => {
  await mount(page, { book: "one", asChild: true });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  const next = page.getByTestId("next");

  // No nested button — that is what asChild exists for.
  expect(await page.evaluate(() => document.querySelectorAll("button button").length)).toBe(0);

  // Both classNames are present (merged rather than overwritten).
  await expect(next).toHaveAttribute("class", /\bmine\b/);
  await expect(next).toHaveAttribute("data-frond-part", "next-trigger");

  await next.click();

  // Both the part's behaviour (turning the page) and the child's own `onClick` ran.
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(1);
  expect(await page.evaluate(() => window.reactHarness.childClickCount())).toBe(1);
});

test("the keyboard does nothing when useKeyboardPaging is not installed", async ({ page }) => {
  await mount(page, { book: "one" });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);

  // This looks like a test of "nothing happened", but what it guards is ADR-0002's line:
  // policy has to be turned on explicitly. The day someone moves `useKeyboardPaging()` into
  // `Root` for convenience, this is what goes red.
  expect((await page.evaluate(() => window.reactHarness.location()))?.page).toBe(0);
});

test("with useKeyboardPaging installed, the arrow keys turn pages", async ({ page }) => {
  await mount(page, { book: "one", keyboard: true });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(1);

  await page.keyboard.press("ArrowLeft");
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(0);
});
