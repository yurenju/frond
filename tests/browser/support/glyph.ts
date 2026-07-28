import type { Browser, Page } from "@playwright/test";
import { documentWith } from "./document.js";

/**
 * Rendering and screenshotting a single character.
 *
 * Both the vertical-glyph and the regional-face test groups need to "put one character
 * in an em box, screenshot it, look at the pixels", and differ only in how they analyse
 * the result afterwards. Sharing one implementation guarantees the box size, line height
 * and overflow handling are the same on both sides — declared separately in two files,
 * those values drift apart silently, and once they have, the two sets of conclusions are
 * no longer comparable.
 */

/** The em box's edge length. Taken large, so that antialiasing is negligible relative to the glyph. */
export const GLYPH_BOX_PX = 200;

export interface GlyphRequest {
  readonly char: string;
  /** The language the document declares. Regional face selection is driven by it. */
  readonly lang: string;
  /** Defaults to a generic family, letting fontconfig's bindings decide the outcome. */
  readonly fontFamily?: string;
  readonly writingMode?: "horizontal-tb" | "vertical-rl";
  /**
   * OpenType features. Used to request vertical glyphs explicitly — WebKit does not apply
   * them automatically, see docs/browser-quirks.md.
   */
  readonly fontFeatureSettings?: string;
}

/**
 * The markup for one em box. Split out so the in-iframe version (see the Chromium
 * fallback-cache group in regional-faces.spec.ts) goes through the same styles as this
 * one.
 *
 * The styles go through a <style> element rather than a style="..." attribute. Quoted
 * font names are the norm (font-family: "Noto Serif CJK JP"), and pushing one into a
 * double-quoted HTML attribute truncates the attribute — so the whole declaration
 * disappears along with width / height / writing-mode, leaving only lang alive. And the
 * page still draws a character and the test still runs to completion; it just measures
 * something else.
 */
export function glyphMarkup(request: GlyphRequest): string {
  const {
    char,
    lang,
    fontFamily = "serif",
    writingMode = "horizontal-tb",
    fontFeatureSettings = "normal",
  } = request;

  return `
      <style>
        #glyph {
          writing-mode: ${writingMode};
          font-family: ${fontFamily};
          font-feature-settings: ${fontFeatureSettings};
          font-size: ${GLYPH_BOX_PX}px;
          line-height: 1;
          width: ${GLYPH_BOX_PX}px;
          height: ${GLYPH_BOX_PX}px;
          overflow: hidden;
        }
      </style>
      <div id="glyph" lang="${lang}">${char}</div>
    `;
}

export async function screenshotGlyph(
  page: Page,
  request: GlyphRequest,
): Promise<Buffer> {
  await page.setContent(documentWith(glyphMarkup(request)));
  await page.evaluate(() => document.fonts.ready);

  return page.locator("#glyph").screenshot();
}

/**
 * As above, but each measurement gets a brand-new page.
 *
 * **This is mandatory when measuring generic families.** Chromium's character fallback
 * result is once-per-page: the face resolved the first time a code point needs fallback
 * is remembered by that page, and subsequent documents get the same face even with a
 * different lang (see docs/browser-quirks.md). Measuring several langs in a row on one
 * shared page measures the first lang's answer, and it looks a great deal like "Chromium
 * ignores lang" — which is an artefact of the measurement, not the browser's behaviour.
 *
 * Not needed with a named face: the face covers the code point itself, so fallback is
 * never reached.
 */
export async function screenshotGlyphInIsolation(
  browser: Browser,
  request: GlyphRequest,
): Promise<Buffer> {
  return withFreshPage(browser, (page) => screenshotGlyph(page, request));
}

/** A throwaway context and page. Same reason as above: that fallback cache. */
export async function withFreshPage<T>(
  browser: Browser,
  use: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext();
  try {
    return await use(await context.newPage());
  } finally {
    await context.close();
  }
}
