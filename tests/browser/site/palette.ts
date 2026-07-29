import type { Page } from "@playwright/test";

/**
 * The demo site's two schemes, as the browser reports them back.
 *
 * ## Why the colours are repeated here rather than read from the page
 *
 * Asserting "the page's background equals `var(--paper)`" would pass in both schemes — it
 * compares the stylesheet with itself, and the one failure worth catching (the switch stopped
 * switching) looks exactly like a pass. So the numbers are written out, and a palette change
 * has to come here too. That is the point: it is the only thing that makes these assertions
 * mean "dark **is darker**" rather than "dark is whatever dark is".
 *
 * The page's side comes from `light-dark()` in `site/style.css`, the book's side from
 * `BOOK_THEMES` in `site/theme.js` — and the book's are `--panel`, not `--paper`, because that
 * is the surface the book sits on.
 */
export const PAGE_BACKGROUND = {
  light: "rgb(251, 250, 248)",
  dark: "rgb(20, 22, 26)",
} as const;

export const BOOK_BACKGROUND = {
  light: "rgb(255, 255, 255)",
  dark: "rgb(27, 30, 35)",
} as const;

/** The page's own background — the half of the theme that is pure CSS. */
export function backgroundOfPage(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/**
 * The background frond painted **inside** the book.
 *
 * This is the assertion that matters. The container behind the iframe is `--panel` by
 * stylesheet anyway, so a theme that never reached frond would still look right there; only
 * the document inside the iframe can say the colours crossed the boundary.
 *
 * It returns `undefined` rather than throwing when there is no readable iframe: a settings
 * change reloads the section, so during the swap there is a moment with none, and callers
 * poll through it.
 */
export function backgroundInsideBook(
  page: Page,
  viewport: string,
): Promise<string | undefined> {
  return page.evaluate((selector) => {
    // The last one, not the first: while a section is being replaced both are attached for a
    // moment, and the old one still carries the previous theme.
    const frames = document.querySelectorAll(`${selector} iframe`);
    const frame = frames[frames.length - 1];
    const inside = frame instanceof HTMLIFrameElement ? frame.contentDocument : null;
    if (inside === null) return undefined;
    return getComputedStyle(inside.documentElement).backgroundColor;
  }, viewport);
}
