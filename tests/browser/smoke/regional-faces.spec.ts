import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  GLYPH_BOX_PX,
  glyphMarkup,
  screenshotGlyph,
  screenshotGlyphInIsolation,
  withFreshPage,
} from "../support/glyph.js";
import { decodePixels } from "../support/ink.js";
import { documentWith } from "../support/document.js";

/**
 * Whether the regional faces (TC / SC / JP) are selected correctly by lang.
 *
 * Noto CJK is one family covering Traditional Chinese, Simplified Chinese and Japanese,
 * but that is not the same as one face: the OTC contains Noto Serif CJK TC / SC / JP and
 * others. Which one is picked depends on face selection, and face selection is decided by
 * lang plus fontconfig's language matching — which is exactly where the three browsers may
 * each go their own way. Bound badly, the three may pick different faces for the same
 * Japanese book, and the cross-browser diff lights up red for reasons unrelated to frond's
 * code.
 *
 * ===========================================================================
 * Which character to test with matters more than how to assert. Measured
 * conclusions — do not change them on intuition.
 * ===========================================================================
 *
 * Han characters **cannot** discriminate between faces. The regional forms of Han
 * unification exemplars like 骨 and 直 are driven by the document's lang through
 * OpenType's locl feature — one face gives different forms under lang=ja and lang=zh-TW,
 * and different faces give the same form under one lang. Asking a Han character "which
 * face was resolved" always answers "cannot tell", so the test goes green even in an
 * environment where the binding is entirely broken.
 *
 * Punctuation **can**. The full stop sits differently in the JP and TC faces (Japanese
 * places it at the top right or bottom left, Chinese centres it), and that difference
 * persists under one lang — which makes it a difference of the face itself.
 *
 * The first group of tests below pins those two properties, because they are the premise
 * on which the second group rests.
 */

/** A Han unification exemplar. Used to prove Han characters are driven by lang, not to discriminate faces. */
const HAN_UNIFICATION_EXEMPLAR = "骨";

/** The full stop. Its position varies by face, making it the only discriminating character here. */
const IDEOGRAPHIC_FULL_STOP = "。";

const JAPANESE_FACE = '"Noto Serif CJK JP"';
const TRADITIONAL_CHINESE_FACE = '"Noto Serif CJK TC"';

test.describe("the two routes to glyph selection", () => {
  test("a Han character's regional form is driven by lang, not by the face", async ({ page }) => {
    const sameLangDifferentFace = [
      await render(page, HAN_UNIFICATION_EXEMPLAR, {
        lang: "ja",
        fontFamily: JAPANESE_FACE,
      }),
      await render(page, HAN_UNIFICATION_EXEMPLAR, {
        lang: "ja",
        fontFamily: TRADITIONAL_CHINESE_FACE,
      }),
    ] as const;

    const sameFaceDifferentLang = [
      await render(page, HAN_UNIFICATION_EXEMPLAR, {
        lang: "ja",
        fontFamily: JAPANESE_FACE,
      }),
      await render(page, HAN_UNIFICATION_EXEMPLAR, {
        lang: "zh-TW",
        fontFamily: JAPANESE_FACE,
      }),
    ] as const;

    expect(sameLangDifferentFace[0].equals(sameLangDifferentFace[1])).toBe(true);
    expect(sameFaceDifferentLang[0].equals(sameFaceDifferentLang[1])).toBe(
      false,
    );
  });

  test("punctuation's position is driven by the face, making it the only discriminating character", async ({ page }) => {
    // This is the premise for the whole group below. If the full stop looked the same in
    // both faces, no character could discriminate between faces and the assertions below
    // would be meaningless even when green.
    const japanese = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });
    const traditionalChinese = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: TRADITIONAL_CHINESE_FACE,
    });

    expect(japanese.equals(traditionalChinese)).toBe(false);
  });
});

test.describe("named faces", () => {
  test("rendering one set of inputs is deterministic", async ({ page }) => {
    // The cases above argue from pixel-for-pixel equality and inequality, so it first has to
    // be proven that the same input gives the same output — otherwise those equalities and
    // inequalities could just be rendering being unstable.
    const first = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });
    const second = await render(page, IDEOGRAPHIC_FULL_STOP, {
      lang: "ja",
      fontFamily: JAPANESE_FACE,
    });

    expect(first.equals(second)).toBe(true);
  });
});

/**
 * ===========================================================================
 * Resolving a generic family by lang — the three engines disagree, and it
 * cannot be fixed (#4)
 * ===========================================================================
 *
 * This section was once marked fixme, waiting for "get the three to agree". After
 * investigation the conclusion is that it **cannot be done**, so it instead pins each
 * engine's actual behaviour: the divergence is itself a property of this test environment,
 * and somebody has to know when it changes. The reasoning and measurements are in
 * docs/browser-quirks.md and the conclusion in issue #4.
 *
 * Each engine bypasses fontconfig's generic bindings differently:
 *
 *   Firefox   asks fontconfig for serif/sans-serif with the book's lang → the bindings
 *             take full effect.
 *   WebKit    does ask fontconfig for the generic family, but without the book's lang; the
 *             missing lang is filled in by fontconfig from **the process's locale**, so the
 *             whole process shares one regional face. The container's locale is C.UTF-8,
 *             which lands on the general rule's TC.
 *   Chromium  does not ask fontconfig for the generic family at all — that is Blink's own
 *             font preference, resolving to Liberation Serif/Sans, which have no CJK; the
 *             CJK characters then go through per-character fallback, which brings in a
 *             separate font.
 *
 * frond does not intervene (ADR-0003: an ugly book is no reason to intervene, and neither
 * is three engines disagreeing). For the cross-browser self-diff to hold, the face has to
 * be named by **reader settings** — named, the three agree, and those tests are above.
 */

/**
 * Generic family + the face that lang actually lands on. Changing this table requires a
 * measurement.
 *
 * Chromium's entries are **font stacks** rather than single faces, because its generic
 * family is two-stage: the primary font (Liberation Serif/Sans) decides the line height
 * and baseline but has no CJK glyphs, and the CJK is filled in by per-character fallback.
 * Comparing against a single Noto CJK face would come out unequal — the glyphs match, but
 * the baseline is set by the primary font and the position differs by a few pixels. The
 * stack spelling reproduces both stages.
 *
 * It is also why Chromium's sans-serif still counts as disagreeing: the regional face is
 * picked correctly, but the primary font is a Latin one, its line height differs from the
 * other two, and the line breaking differs with it.
 */
const LANDS_ON: Record<string, Record<string, Record<string, string>>> = {
  serif: {
    chromium: {
      ja: '"Liberation Serif", "Noto Sans CJK JP"',
      "zh-TW": '"Liberation Serif", "Noto Sans CJK TC"',
    },
    firefox: { ja: JAPANESE_FACE, "zh-TW": TRADITIONAL_CHINESE_FACE },
    webkit: {
      ja: TRADITIONAL_CHINESE_FACE,
      "zh-TW": TRADITIONAL_CHINESE_FACE,
    },
  },
  "sans-serif": {
    chromium: {
      ja: '"Liberation Sans", "Noto Sans CJK JP"',
      "zh-TW": '"Liberation Sans", "Noto Sans CJK TC"',
    },
    firefox: {
      ja: '"Noto Sans CJK JP"',
      "zh-TW": '"Noto Sans CJK TC"',
    },
    webkit: {
      ja: '"Noto Sans CJK TC"',
      "zh-TW": '"Noto Sans CJK TC"',
    },
  },
};

/** The face a lang should get when the book declares a generic family. Only Firefox delivers it. */
const CORRECT_FACE: Record<string, Record<string, string>> = {
  serif: { ja: JAPANESE_FACE, "zh-TW": TRADITIONAL_CHINESE_FACE },
  "sans-serif": { ja: '"Noto Sans CJK JP"', "zh-TW": '"Noto Sans CJK TC"' },
};

test.describe("resolving a generic family by lang (#4: unfixable; pinning the status quo)", () => {
  for (const generic of ["serif", "sans-serif"]) {
    for (const lang of ["ja", "zh-TW"]) {
      test(`${generic} + lang=${lang} lands on this engine's measured face`, async ({
        browser,
      }, testInfo) => {
        const landsOnFace = lookUp(
          lookUp(
            lookUp(LANDS_ON, generic, "LANDS_ON"),
            testInfo.project.name,
            "LANDS_ON",
          ),
          lang,
          "LANDS_ON",
        );
        const correctFace = lookUp(
          lookUp(CORRECT_FACE, generic, "CORRECT_FACE"),
          lang,
          "CORRECT_FACE",
        );

        const viaGenericFamily = await renderInIsolation(
          browser,
          lang,
          generic,
        );
        const landsOn = await renderInIsolation(browser, lang, landsOnFace);
        const correct = await renderInIsolation(browser, lang, correctFace);

        expect(viaGenericFamily.equals(landsOn)).toBe(true);
        // The same case also answers "is that landing point correct", so the two cannot drift
        // apart.
        expect(viaGenericFamily.equals(correct)).toBe(
          landsOnFace === correctFace,
        );
      });
    }
  }

  /**
   * Chromium's character fallback is **once per page**, and frond gives each Section its own
   * iframe while the whole book shares one page — so this is not a laboratory detail but
   * something frond's actual arrangement runs into: whichever Section renders first on a
   * page decides the regional face for every Section after it.
   *
   * The three engines' signatures happen to be mutually distinct, so one test can tell which
   * one broke:
   *
   *   Chromium  two iframes on one page get the same face (the first wins), and swapping the
   *             order swaps the result
   *   Firefox   each follows its own lang, independently of order
   *   WebKit    both are the same but independently of order — it never looked at lang at all
   */
  const FALLBACK_SIGNATURE: Record<
    string,
    { sameWithinPage: boolean; stableAcrossOrders: boolean }
  > = {
    chromium: { sameWithinPage: true, stableAcrossOrders: false },
    firefox: { sameWithinPage: false, stableAcrossOrders: true },
    webkit: { sameWithinPage: true, stableAcrossOrders: true },
  };

  test("two iframes on one page: Chromium is decided by the first, Firefox follows each lang, WebKit looks at neither", async ({
    browser,
  }, testInfo) => {
    const signature = lookUp(
      FALLBACK_SIGNATURE,
      testInfo.project.name,
      "FALLBACK_SIGNATURE",
    );

    const [japanese, chineseAfterJapanese] = await renderTwoFrames(browser, [
      "ja",
      "zh-TW",
    ]);
    const [chinese, japaneseAfterChinese] = await renderTwoFrames(browser, [
      "zh-TW",
      "ja",
    ]);

    expect(japanese.equals(chineseAfterJapanese)).toBe(
      signature.sameWithinPage,
    );
    expect(chinese.equals(japaneseAfterChinese)).toBe(signature.sameWithinPage);
    // The same lang=zh-TW content gets a different face purely for coming after Japanese
    // content.
    expect(chineseAfterJapanese.equals(chinese)).toBe(
      signature.stableAcrossOrders,
    );
  });
});

/** When a table has no such entry, the error message has to name which table is missing what. */
function lookUp<T>(table: Record<string, T>, key: string, name: string): T {
  const value = table[key];
  if (value === undefined) {
    throw new Error(`${name} has no "${key}" entry — adding a browser project or a lang means adding the measured result too`);
  }
  return value;
}

async function render(
  page: Page,
  char: string,
  options: { lang: string; fontFamily?: string },
): Promise<Buffer> {
  return decodePixels(await screenshotGlyph(page, { char, ...options }));
}

/** One brand-new page each time — the reasoning is in screenshotGlyphInIsolation. */
async function renderInIsolation(
  browser: Browser,
  lang: string,
  fontFamily?: string,
): Promise<Buffer> {
  return decodePixels(
    await screenshotGlyphInIsolation(browser, {
      char: IDEOGRAPHIC_FULL_STOP,
      lang,
      ...(fontFamily === undefined ? {} : { fontFamily }),
    }),
  );
}

/**
 * Two iframes on one page, each declaring serif and its own lang, returning both sets of
 * pixels in declaration order.
 *
 * The two iframes are attached **one after the other** rather than written into setContent
 * at once. This test's whole subject is "which renders first", and attaching both together
 * guarantees nothing about which srcdoc finishes first — which would make the assertion's
 * colour depend on a race nobody controls.
 */
async function renderTwoFrames(
  browser: Browser,
  langs: readonly [string, string],
): Promise<[Buffer, Buffer]> {
  return withFreshPage(browser, async (page) => {
    await page.setContent(documentWith(""));

    const rendered: Buffer[] = [];
    for (const lang of langs) {
      rendered.push(await appendFrameAndScreenshot(page, lang));
    }
    const [first, second] = rendered;
    return [first!, second!];
  });
}

async function appendFrameAndScreenshot(
  page: Page,
  lang: string,
): Promise<Buffer> {
  // srcdoc is single-quoted so the inner lang="…" does not truncate the attribute. Everything
  // here goes through a generic family, so the markup carries no quoted font name.
  const frame = `<iframe id="frame-${lang}" width="${GLYPH_BOX_PX + 20}" height="${
    GLYPH_BOX_PX + 20
  }" style="border:0" srcdoc='${glyphMarkup({
    char: IDEOGRAPHIC_FULL_STOP,
    lang,
  })}'></iframe>`;

  await page.evaluate((html) => {
    document.body.insertAdjacentHTML("beforeend", html);
  }, frame);

  const glyph = page.frameLocator(`#frame-${lang}`).locator("#glyph");
  await glyph.waitFor();
  await page
    .frameLocator(`#frame-${lang}`)
    .locator("body")
    .evaluate(() => document.fonts.ready);

  return decodePixels(await glyph.screenshot());
}
