import { expect, test, type Page } from "@playwright/test";
import { mountFixture, openHarness, type EventRecord } from "../support/harness.js";

/**
 * The outlet for pointer and key events inside the iframe.
 *
 * ## Why this is indispensable
 *
 * A section renders inside an iframe (ADR-0006), and an iframe's boundary blocks event
 * bubbling — a consumer with a listener on the container receives nothing at all. Without
 * this outlet, swipe-to-turn, tap-the-sides-to-turn and the arrow keys while the content
 * has focus **all do nothing**, and with no error message.
 *
 * ## Why frond sends only these
 *
 * What it sends is facts: at this moment, at this point in container coordinates, a
 * pointer went down, and these two DOM conditions held at the time. "Swiping left means
 * next page" and "tapping the right third turns the page" are policy, and belong to the
 * consumer (ADR-0002). So not one assertion here reads "after the swipe it turned to the
 * next page" — that is not frond's behaviour.
 *
 * It uses Playwright's real mouse and keyboard rather than synthetic events: coordinate
 * conversion and focus routing are the two things most easily got wrong in this slot, and
 * synthetic events bypass both.
 */

/** The shell page's container sits at (0, 0), so page coordinates are container coordinates. */
const CONTAINER = { width: 800, height: 600 };

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("pointer events", () => {
  test("down and up are each sent once, with container coordinates", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.move(300, 200);
    await page.mouse.down();
    await page.mouse.up();

    const down = await waitForEvent(page, "pointerdown");
    const up = await waitForEvent(page, "pointerup");

    // The event's clientX/clientY are relative to the iframe's viewport, and the iframe was
    // inset by the margin. Adding that back gives container coordinates — where the mouse
    // actually clicked.
    expect(down.x).toBeCloseTo(300, 0);
    expect(down.y).toBeCloseTo(200, 0);
    expect(up.x).toBeCloseTo(300, 0);
    expect(up.y).toBeCloseTo(200, 0);
  });

  test("carries the container's size — tap zones need it to compute proportions", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);
    const event = await waitForEvent(page, "pointerup");

    expect(event.width).toBe(CONTAINER.width);
    expect(event.height).toBe(CONTAINER.height);
  });

  /**
   * The coordinates and `rectsFor()` have to share one frame of reference.
   *
   * A consumer draws a floating toolbar on the container, positioned from both of these at
   * once (the selection's rectangles decide where to attach it, the pointer's position
   * decides whether to dismiss it). With different origins, the symptom is the toolbar
   * offset by one margin — and since that distance equals the reader's margin setting,
   * increasing the margin increases the offset.
   */
  test("coordinates and rectsFor share an origin: a larger margin shifts both together", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: { margin: 80 } });

    const frame = await page.evaluate(() => window.frond.frameBox());
    expect(frame.x).toBe(80);
    expect(frame.y).toBe(80);

    // Clicking the top-left corner of the iframe's content area. The container coordinate
    // should be the margin itself.
    await page.mouse.click(frame.x + 1, frame.y + 1);
    const event = await waitForEvent(page, "pointerup");

    expect(event.x).toBeCloseTo(frame.x + 1, 0);
    expect(event.y).toBeCloseTo(frame.y + 1, 0);
  });

  test("isLink is false when clicking body text", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);
    expect((await waitForEvent(page, "pointerup")).isLink).toBe(false);
  });

  /**
   * The link slot, and the order of `pointerup` and `linkactivate`.
   *
   * For a consumer to make "tapped a link" beat "tapped the right side to turn the page",
   * it has to be decidable at the moment of `pointerup` — which is what `isLink` exists
   * for. Reversed, that field has no use, so both facts are pinned together.
   */
  test("clicking a link: isLink is true, and pointerup comes before linkactivate", async ({
    page,
  }) => {
    await mountFixture(page, "nested-toc");
    const at = await prependLink(page);

    await page.mouse.click(at.x, at.y);

    expect((await waitForEvent(page, "pointerup")).isLink).toBe(true);

    const names = (await events(page)).map((record) => record.name);
    const up = names.lastIndexOf("pointerup");
    const activate = names.lastIndexOf("linkactivate");

    expect(activate).toBeGreaterThan(-1);
    expect(up).toBeLessThan(activate);
  });

  /**
   * `pointerType` separates a finger from a mouse.
   *
   * The consumer's reason for asking: tapping the edge of the page is the only way to turn it
   * on a phone, while the same click on a desktop competes with placing the caret and with
   * double-click to select a word — and a desktop has a keyboard and on-screen buttons for
   * turning. Without this field the two are one event and the policy cannot differ.
   */
  test("pointerType says a mouse is a mouse", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);

    expect((await waitForEvent(page, "pointerup")).pointerType).toBe("mouse");
  });

  test("pointerType says a finger is a finger", async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage();
    try {
      await openHarness(page);
      await mountFixture(page, "vertical-japanese");

      await page.touchscreen.tap(400, 300);

      expect((await waitForEvent(page, "pointerup")).pointerType).toBe("touch");
    } finally {
      await context.close();
    }
  });

  test("hasSelection is true while text is selected — not turning the page mid-selection depends on it", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.selectText("p"));

    await page.mouse.move(300, 200);
    await page.mouse.down();

    expect((await waitForEvent(page, "pointerdown")).hasSelection).toBe(true);
  });
});

test.describe("key events", () => {
  /**
   * While focus is inside the iframe, the outer document's keyup receives nothing at all —
   * which is exactly why arrow-key paging stops working once frond is wired up. So this
   * test clicks the content first to send focus in, and only then presses a key: receiving
   * events while focus is outside proves nothing about this outlet.
   */
  test("arrow keys still get out while focus is inside the iframe", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);
    await page.keyboard.press("ArrowLeft");

    const down = await waitForKeyEvent(page, "keydown");
    const up = await waitForKeyEvent(page, "keyup");

    expect(down.key).toBe("ArrowLeft");
    expect(up.key).toBe("ArrowLeft");
    expect(up.code).toBe("ArrowLeft");
  });

  test("carries the modifier key state", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.mouse.click(400, 300);
    await page.keyboard.press("Shift+ArrowRight");

    const event = await waitForKeyEvent(page, "keydown");
    expect(event.key).toBe("ArrowRight");
    expect(event.shiftKey).toBe(true);
    expect(event.ctrlKey).toBe(false);
  });
});

test.describe("frond makes no decisions about input", () => {
  /**
   * This guards ADR-0002's line itself: forwarding events **does not mean** starting to
   * consume gestures.
   *
   * After swiping some distance to the left, the position must not move at all — "this was
   * a swipe, so turn the page" is the consumer's decision. When this test goes red, someone
   * has added gesture handling inside frond.
   */
  test("swiping over the content does not turn the page", async ({ page }) => {
    const before = await mountFixture(page, "vertical-japanese");

    await page.mouse.move(600, 300);
    await page.mouse.down();
    await page.mouse.move(200, 300, { steps: 10 });
    await page.mouse.up();

    const after = await page.evaluate(() => window.frond.snapshot());
    expect(after.page).toBe(before.page);
    expect(after.sectionIndex).toBe(before.sectionIndex);
  });

  test("arrow keys do not turn the page", async ({ page }) => {
    const before = await mountFixture(page, "vertical-japanese");

    await page.mouse.click(400, 300);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");

    const after = await page.evaluate(() => window.frond.snapshot());
    expect(after.page).toBe(before.page);
    expect(after.sectionIndex).toBe(before.sectionIndex);
  });
});

interface PointerPayload {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pointerType: string;
  readonly hasSelection: boolean;
  readonly isLink: boolean;
}

interface KeyPayload {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

function events(page: Page): Promise<readonly EventRecord[]> {
  return page.evaluate(() => window.frond.events());
}

/**
 * Inserts a link at the start of this section and returns its position in page
 * coordinates.
 *
 * The fixture's content documents contain no `<a>` of their own (`pagination.spec.ts`'s
 * linkactivate case inserts one too), and it goes at the **start** so that it can be
 * clicked — at the end it would land on some later page, off screen.
 *
 * `createElementNS` rather than `createElement`: the content document is XML, and an
 * element `createElement` builds has no namespace, so it is not an XHTML `<a>` and the
 * browser does not treat it as a link.
 */
async function prependLink(page: Page): Promise<{ x: number; y: number }> {
  const at = await page.evaluate(() => {
    const frame = document.querySelector("#viewport iframe") as HTMLIFrameElement | null;
    const contents = frame?.contentDocument;
    if (frame === null || contents == null || contents.body === null) return null;

    const anchor = contents.createElementNS("http://www.w3.org/1999/xhtml", "a");
    anchor.setAttribute("href", "section-2.xhtml#part-2-1");
    anchor.textContent = "次へ";
    contents.body.prepend(anchor);

    const rect = anchor.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return {
      x: frameRect.left + rect.left + rect.width / 2,
      y: frameRect.top + rect.top + rect.height / 2,
    };
  });

  expect(at).not.toBeNull();
  return at!;
}

async function waitForEvent(page: Page, name: string): Promise<PointerPayload> {
  await expect
    .poll(async () => (await events(page)).some((record) => record.name === name))
    .toBe(true);

  const all = await events(page);
  const last = [...all].reverse().find((record) => record.name === name)!;
  return last.payload as PointerPayload;
}

async function waitForKeyEvent(page: Page, name: string): Promise<KeyPayload> {
  await expect
    .poll(async () => (await events(page)).some((record) => record.name === name))
    .toBe(true);

  const all = await events(page);
  const last = [...all].reverse().find((record) => record.name === name)!;
  return last.payload as KeyPayload;
}
