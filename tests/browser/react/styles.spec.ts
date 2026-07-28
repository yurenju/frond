import { expect, test } from "@playwright/test";
import { loadDefaultStyles, mount, openReactHarness } from "./support/harness.ts";

/**
 * The default styles' two properties. Together they are what "entirely optional" means:
 *
 *   1. **Without the import they do not exist at all.** The parts carry no declaration of
 *      their own.
 *   2. **With the import they are still overridable.** The whole sheet is wrapped in
 *      `:where()`, so its specificity is 0.
 *
 * The second is especially worth testing. A default stylesheet that is "optional" but
 * high-specificity is in practice something you have to fight before you can begin — and
 * the specificity is maintained by how the selectors are written, so editing one rule can
 * quietly break it, with CSS raising no error at all.
 */

test.beforeEach(async ({ page }) => {
  await openReactHarness(page);
});

test("without importing the styles, the buttons keep the browser's native look", async ({ page }) => {
  await mount(page, { book: "one" });

  // A native `<button>` comes with a border. The default styles clear it — nothing is
  // imported here, so it is still there.
  const border = await page
    .getByTestId("next")
    .evaluate((element) => getComputedStyle(element).borderTopStyle);

  expect(border).not.toBe("none");
});

test("after the import, the buttons' native appearance is cleared", async ({ page }) => {
  await loadDefaultStyles(page);
  await mount(page, { book: "one" });

  const styles = await page.getByTestId("next").evaluate((element) => {
    const computed = getComputedStyle(element);
    return { border: computed.borderTopStyle, cursor: computed.cursor };
  });

  expect(styles.border).toBe("none");
  expect(styles.cursor).toBe("pointer");
});

test("one consumer class rule is enough to override the default styles", async ({ page }) => {
  await loadDefaultStyles(page);
  await page.addStyleTag({ content: ".viewport { min-height: 123px; }" });
  await mount(page, { book: "one" });

  // The default styles set `min-height: var(--frond-viewport-min-height)` on the viewport,
  // wrapped in `:where()` at specificity 0. The most ordinary consumer class rule should
  // win — no `!important` needed, and no need to care which stylesheet loaded first.
  const minHeight = await page
    .getByTestId("viewport")
    .evaluate((element) => getComputedStyle(element).minHeight);

  expect(minHeight).toBe("123px");
});

test("setting a custom property alone is enough to adjust, without rewriting rules", async ({ page }) => {
  await loadDefaultStyles(page);
  await page.addStyleTag({ content: ":root { --frond-progress-thickness: 9px; }" });
  await mount(page, { book: "one" });

  const height = await page
    .getByTestId("progress")
    .evaluate((element) => getComputedStyle(element).height);

  expect(height).toBe("9px");
});
