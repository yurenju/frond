import { expect, test } from "@playwright/test";
import { mount, openReactHarness, update } from "./support/harness.ts";

/**
 * `Root`'s lifecycle.
 *
 * This is where this package's real risk lives. frond-react adds very little logic, but
 * all of what it does add lands on React's lifecycle — and that is exactly where a thin
 * wrapper goes wrong: an effect running twice, a cleanup that never destroys, props
 * changing and the whole book remounting. All three share one symptom: "it looks like it
 * works".
 */

test.beforeEach(async ({ page }) => {
  await openReactHarness(page);
});

test("only one iframe remains under StrictMode", async ({ page }) => {
  // `Renderer.attach()` is asynchronous, and StrictMode runs the effect's cleanup before it
  // resolves. If the cleanup is only `renderer?.destroy()`, `renderer` is still undefined
  // at that moment — so nothing tears down what the first attach produced, and the iframe
  // stays in the DOM.
  //
  // The symptom is two books stacked on top of each other, visible only to those who
  // turned StrictMode on.
  await mount(page, { book: "one", strict: true });

  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");

  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(1);
  expect(await page.evaluate(() => window.reactHarness.attachCount())).toBe(1);
});

test("stays idle with no book, and mounts only once given one", async ({ page }) => {
  await mount(page, { book: null });

  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "idle");
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(0);

  await update(page, { book: "one" });
  await expect(viewport).toHaveAttribute("data-state", "ready");
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(1);
});

test("tears the Renderer down when book goes back to undefined", async ({ page }) => {
  await mount(page, { book: "one" });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  await update(page, { book: null });

  // The container stays (that is the consumer's layout) but the book is gone. Leaving the
  // iframe leaks memory along with the resources' blob URLs, and nothing on screen looks
  // wrong — so this has to measure the DOM, not the state.
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "idle");
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(0);
});

test("unmounting the whole tree takes the iframe with it", async ({ page }) => {
  await mount(page, { book: "one" });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  await page.evaluate(() => window.reactHarness.unmount());

  expect(await page.evaluate(() => document.querySelectorAll("iframe").length)).toBe(0);
});

test("changing books remounts, and the position returns to the new book's start", async ({ page }) => {
  await mount(page, { book: "one" });
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");

  await page.getByTestId("next").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBeGreaterThan(0);

  await update(page, { book: "two" });
  await expect(viewport).toHaveAttribute("data-state", "ready");

  await expect
    .poll(async () => await page.evaluate(() => window.reactHarness.location()))
    .toMatchObject({ sectionPath: "two-a.xhtml", page: 0 });

  expect(await page.evaluate(() => window.reactHarness.attachCount())).toBe(2);
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(1);
});

test("changing reader settings neither remounts nor sends the reader back to page one", async ({ page }) => {
  await mount(page, { book: "one", settings: { fontSize: 16 } });
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");

  await page.getByTestId("next").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBeGreaterThan(0);

  await update(page, { book: "one", settings: { fontSize: 28 } });

  await expect
    .poll(async () => await page.evaluate(() => window.reactHarness.computed("p", "font-size")))
    .toBe("28px");

  // The same `Renderer`: changing settings goes through `applySettings()`, not another
  // `attach()`. A remount would throw the reader back to page one, and that happens at
  // every notch while dragging a font-size slider.
  expect(await page.evaluate(() => window.reactHarness.attachCount())).toBe(1);
  expect(
    (await page.evaluate(() => window.reactHarness.location()))?.page,
  ).toBeGreaterThan(0);
});

test("a re-render that changes nothing does not touch the Renderer underneath", async ({ page }) => {
  await mount(page, { book: "one" });
  const viewport = page.getByTestId("viewport");
  await expect(viewport).toHaveAttribute("data-state", "ready");

  await page.getByTestId("next").click();
  await expect
    .poll(async () => (await page.evaluate(() => window.reactHarness.location()))?.page)
    .toBe(1);

  // This guards the identity of `Viewport`'s ref callback. Written as an inline arrow
  // function, React calls the old one with null and the new one with the node on every
  // render — that is, every render sends `Root` a "the viewport is gone" followed by a "the
  // viewport is back".
  //
  // That pair is swallowed by React's bail out today, so the symptom is not necessarily
  // visible. The day it is, the reader will find the page flicking back to page one every
  // so often.
  for (let round = 0; round < 5; round += 1) {
    await update(page, { book: "one" });
  }

  expect(await page.evaluate(() => window.reactHarness.attachCount())).toBe(1);
  expect(await page.evaluate(() => window.reactHarness.iframeCount())).toBe(1);
  expect((await page.evaluate(() => window.reactHarness.location()))?.page).toBe(1);
});

test("passing the same settings values in does not reapply them", async ({ page }) => {
  await mount(page, { book: "one", settings: { fontSize: 20 } });
  await expect(page.getByTestId("viewport")).toHaveAttribute("data-state", "ready");

  const before = await page.evaluate(() => window.reactHarness.loadCount());

  // An object literal has a new identity on every render. If the comparison looked at
  // identity, this would relayout — and `settings={{ fontSize }}` is the most natural thing
  // for a consumer to write, which would mean relayouting on every single re-render.
  await update(page, { book: "one", settings: { fontSize: 20 } });
  await update(page, { book: "one", settings: { fontSize: 20 } });

  expect(await page.evaluate(() => window.reactHarness.loadCount())).toBe(before);
});
