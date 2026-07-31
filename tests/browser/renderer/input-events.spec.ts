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

/**
 * `preventTapDefault()` — the one thing a press can decide while it is still happening.
 *
 * ## What is actually being defended against, and why it cannot be tested here
 *
 * Chrome for Android selects a word out of a plain tap on text and raises a search bar over
 * the page (Touch to Search). The reader taps the edge to turn the page and gets a search
 * bar; the selection can be dropped afterwards, but the bar belongs to the browser and no
 * page script takes it back down. **No desktop engine does this**, so the behaviour itself
 * is out of reach of this suite.
 *
 * ## Why the mechanism is this one
 *
 * It used to make the document unselectable for as long as the press lasted — the condition
 * Chrome's own documentation names as one Touch to Search will not fire on. Measured on a
 * phone, that only made the bar rarer: 21% of taps raised it anyway, against 72% with
 * nothing at all. Cancelling the touch that ends the press is what actually stopped it, 0
 * times in 15 (#80).
 *
 * So what is pinned here is that mechanism — the `touchend` of a press that asked is
 * cancelled, the press still reaches the consumer, and no answer carries into the next
 * press. Whether the bar is really gone is confirmed by hand, on a phone.
 */
test.describe("cancelling the browser's own action for one press", () => {
  // The whole subject is a touch sequence: without one there is no `touchend` to cancel.
  test.use({ hasTouch: true });

  test("the touch that ends a press which asked is cancelled — and only that press", async ({
    page,
  }) => {
    await mountFixture(page, "vertical-japanese");

    await page.evaluate(() => window.frond.preventTapDefaultOnPress(true));
    await page.touchscreen.tap(400, 300);
    expect(await page.evaluate(() => window.frond.touchEndDefaultPrevented())).toBe(true);

    // The other half. Without it the test would pass just as well on an implementation that
    // cancelled every touch it saw, which is a different mechanism with a different cost.
    await page.evaluate(() => window.frond.preventTapDefaultOnPress(false));
    await page.touchscreen.tap(400, 300);
    expect(await page.evaluate(() => window.frond.touchEndDefaultPrevented())).toBe(false);
  });

  /**
   * The press that never ends inside the iframe.
   *
   * A finger can leave the frame before it lifts, and the `touchend` goes wherever it went.
   * An answer left standing would then cancel a later tap the consumer never asked about —
   * one that might be on a link. The synthetic `pointerdown` reproduces the missing release:
   * it arrives with no touch sequence at all, which a real finger cannot do.
   */
  test("a press with no release does not cancel the next one", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.preventTapDefaultOnPress(true));

    await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe") as HTMLIFrameElement;
      frame.contentDocument?.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }),
      );
    });

    await page.evaluate(() => window.frond.preventTapDefaultOnPress(false));
    await page.touchscreen.tap(400, 300);

    expect(await page.evaluate(() => window.frond.touchEndDefaultPrevented())).toBe(false);
  });

  /**
   * Cancelling the tap's default must not cost the consumer the tap itself.
   *
   * The point of suppressing it is that the press turns a page instead. A consumer that
   * stopped hearing about the press would have nothing left to turn on, and the symptom
   * would read as "tapping the edge does nothing" rather than as anything to do with a
   * search bar.
   */
  test("the press still reaches the consumer", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.preventTapDefaultOnPress(true));

    await page.touchscreen.tap(400, 300);

    expect((await waitForEvent(page, "pointerdown")).pointerType).toBe("touch");
    expect((await waitForEvent(page, "pointerup")).pointerType).toBe("touch");
  });

  /**
   * What this mechanism, unlike the one before it, does not take away.
   *
   * Making the document unselectable cost the reader every selection that grew out of a
   * suppressed press: a long press inside the consumer's tap zone selected nothing, and a
   * selection already in progress was dropped where the press landed. Cancelling a touch
   * takes none of that — and a mouse, which has no touch sequence at all, is untouched even
   * while every press is asking.
   */
  test("a mouse drag still selects text, whatever the presses ask for", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");
    await page.evaluate(() => window.frond.preventTapDefaultOnPress(true));

    await dragAcrossText(page);

    expect((await selectedText(page)).length).toBeGreaterThan(0);
  });

  /**
   * The cost, written down as a test.
   *
   * A cancelled touch takes the tap's `click` with it, and frond's link handling is built on
   * that click — so a press that asks for this cannot also activate a link. Which presses
   * ask is policy (ADR-0002), and a consumer whose tap zones sit over body text has to leave
   * the ones landing on links alone; `isLink` is there for exactly that, and spine's
   * navigator reads it. What this pins is that "the footnote stopped working" traces back to
   * a decision rather than to a surprise.
   */
  test("a link tapped in a cancelled press does not activate, though the same tap otherwise does", async ({
    page,
  }) => {
    await mountFixture(page, "nested-toc");
    const at = await prependLink(page);

    // The control first, so the negative half below is measured against a tap already known
    // to reach the link.
    await page.evaluate(() => window.frond.preventTapDefaultOnPress(false));
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(async () => await linkActivations(page)).toBe(1);

    await page.evaluate(() => window.frond.preventTapDefaultOnPress(true));
    await page.touchscreen.tap(at.x, at.y);

    // The touch is recorded as it is cancelled, and a click follows a touch immediately —
    // so once the second tap's own answer is in, an activation it caused would be in too.
    await expect.poll(async () => await touchEndPrevented(page)).toBe(true);
    expect(await linkActivations(page)).toBe(1);
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

/** How many links have been activated so far — the link tests count rather than look. */
async function linkActivations(page: Page): Promise<number> {
  return (await events(page)).filter((record) => record.name === "linkactivate").length;
}

/** What became of the touch that ended the last press. */
function touchEndPrevented(page: Page): Promise<boolean | null> {
  return page.evaluate(() => window.frond.touchEndDefaultPrevented());
}

/**
 * Presses, drags across a paragraph and releases — the gesture a reader uses to choose a
 * passage.
 *
 * The two points come from the paragraph's own first rectangle rather than from figures
 * chosen against the viewport: the fixture is vertical, so "across the text" is down the
 * screen there and along it in a horizontal book, and a drag that misses the glyphs selects
 * nothing while looking exactly like a suppressed one.
 *
 * `steps` matters too — a single jump is one `mousemove`, and an engine extends a selection
 * along the moves it receives.
 */
async function dragAcrossText(page: Page): Promise<void> {
  const box = await page.evaluate(() => {
    const frame = document.querySelector("#viewport iframe") as HTMLIFrameElement | null;
    const contents = frame?.contentDocument;
    const paragraph = contents?.querySelector("p");
    if (frame == null || paragraph == null) return null;

    // The first rectangle, not the bounding box: a paragraph broken over several columns
    // has a bounding box spanning all of them, whose middle is white space between columns.
    const rect = paragraph.getClientRects()[0];
    if (rect === undefined) return null;

    const frameRect = frame.getBoundingClientRect();
    return {
      x: frameRect.left + rect.left,
      y: frameRect.top + rect.top,
      width: rect.width,
      height: rect.height,
    };
  });

  expect(box).not.toBeNull();
  const { x, y, width, height } = box!;

  await page.mouse.move(x + width * 0.5, y + height * 0.1);
  await page.mouse.down();
  await page.mouse.move(x + width * 0.5, y + height * 0.9, { steps: 10 });
  await page.mouse.up();
}

/** What is selected inside the content document right now. */
function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const frame = document.querySelector("#viewport iframe") as HTMLIFrameElement | null;
    return frame?.contentDocument?.getSelection()?.toString() ?? "";
  });
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
