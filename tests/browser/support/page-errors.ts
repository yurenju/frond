import type { Page } from "@playwright/test";

/**
 * Collects everything the page reports as an error, so a spec can assert there was none.
 *
 * Both `pageerror` (uncaught exceptions and error events on `window`) and `console` errors
 * are taken: the demo pages catch their own failures and `console.error` them, so watching
 * only `pageerror` would miss exactly the failures they handle.
 *
 * The returned array is live — it fills up as the page runs, and the assertion goes at the
 * end of the test.
 */
export function collectPageErrors(page: Page): string[] {
  const failures: string[] = [];

  page.on("pageerror", (error) => {
    if (!isBenign(String(error))) failures.push(String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !isBenign(message.text())) {
      failures.push(message.text());
    }
  });

  return failures;
}

/**
 * The one message that is a browser notification rather than a defect.
 *
 * `Renderer` observes its container with a `ResizeObserver` and relayouts from the
 * callback (`src/renderer/renderer.ts`). When a frame runs long enough that the resulting
 * observations cannot be delivered within it, the browser defers them to the next frame
 * and says so — **as an error event on `window`**, which is why it lands in `pageerror`
 * at all.
 *
 * It is the mild variant. Chromium's "ResizeObserver loop limit exceeded" means the
 * observer kept re-triggering itself and the browser gave up; "completed with undelivered
 * notifications" means the work simply moved to the next frame, and nothing is lost. It
 * shows up under load — CI runners hit it where an idle machine does not, which makes an
 * unfiltered assertion flaky in a way that has nothing to do with what these specs guard.
 *
 * **Matched exactly, not by substring on `ResizeObserver`.** The loop-limit variant is a
 * real signal about a relayout feedback loop, and it has to keep going red.
 */
function isBenign(message: string): boolean {
  return BENIGN.some((benign) => message.includes(benign));
}

const BENIGN = ["ResizeObserver loop completed with undelivered notifications."];
