import { describe, expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  overriddenProperties,
  readerStylesheet,
  withLayout,
  withSettings,
  type LayoutSettings,
  type ReaderSettings,
} from "../../../src/renderer/settings.ts";

/**
 * The reader settings layer.
 *
 * This group's weight is not on "what happens when something is set" but on **what
 * happens when nothing is** — ADR-0003's threshold is "a reader setting is blocked by
 * the book", which does not hold without a reader setting, and an implementation that
 * misses that runs an override pass on every single book with nobody noticing: the
 * screen looks fine, the author's design has simply been erased.
 */

function settings(patch: Partial<ReaderSettings> = {}): ReaderSettings {
  return withSettings(DEFAULT_SETTINGS, patch);
}

describe("the defaults", () => {
  test("nothing is set except the margin", () => {
    expect(DEFAULT_SETTINGS.fontFamily).toBeUndefined();
    expect(DEFAULT_SETTINGS.fontSize).toBeUndefined();
    expect(DEFAULT_SETTINGS.lineHeight).toBeUndefined();
    expect(DEFAULT_SETTINGS.theme).toBeUndefined();
    expect(DEFAULT_SETTINGS.fontFaces).toBeUndefined();
    expect(DEFAULT_SETTINGS.fontLanguage).toBeUndefined();
  });

  test("the margin has a default — at 0 the text would sit against the screen edge", () => {
    expect(DEFAULT_SETTINGS.margin).toBeGreaterThan(0);
  });

  test("with nothing set, the injected stylesheet is empty", () => {
    // The machine-readable form of user story 45 (with no active adjustment, the book's
    // layout is preserved intact).
    expect(readerStylesheet(DEFAULT_SETTINGS)).toBe("");
  });

  test("with nothing set, not one !important is demoted", () => {
    expect(overriddenProperties(DEFAULT_SETTINGS).size).toBe(0);
  });
});

describe("the scope of an intervention", () => {
  test("setting the size touches only the size (plus the font shorthand)", () => {
    const properties = overriddenProperties(settings({ fontSize: 24 }));

    expect([...properties].sort()).toEqual(["font", "font-size"]);
  });

  test("setting the theme touches the colour slots, not the size", () => {
    const properties = overriddenProperties(
      settings({ theme: { foreground: "#eee", background: "#111" } }),
    );

    expect(properties.has("color")).toBe(true);
    expect(properties.has("background-color")).toBe(true);
    expect(properties.has("font-size")).toBe(false);
  });

  test("the font shorthand is always included — one declaration can pin size, line height and family at once", () => {
    expect(overriddenProperties(settings({ lineHeight: 2 })).has("font")).toBe(true);
    expect(overriddenProperties(settings({ fontFamily: "X" })).has("font")).toBe(true);
  });
});

describe("the injected stylesheet", () => {
  test("the size is set on the root element only — the book's own hierarchy survives through inheritance", () => {
    const css = readerStylesheet(settings({ fontSize: 24 }));

    expect(css).toContain(":root { font-size: 24px !important; }");
    // Set on every element, headings and body text would come out the same size.
    expect(css).not.toContain(":root * { font-size");
  });

  test("the family is set on every element — the book's declarations on descendants cannot win it back", () => {
    const css = readerStylesheet(settings({ fontFamily: '"Noto Serif CJK JP"' }));

    expect(css).toContain(':root, :root * { font-family: "Noto Serif CJK JP" !important; }');
  });

  test("the theme's background goes on the root element only; everything else is transparent", () => {
    const css = readerStylesheet(
      settings({ theme: { foreground: "#eeeeee", background: "#111111" } }),
    );

    expect(css).toContain(":root { background-color: #111111 !important; }");
    expect(css).toContain(":root *:not(:root) { background-color: transparent !important; }");
    expect(css).toContain("color: #eeeeee !important;");
  });

  test("a link colour is set with a selector more specific than the foreground rule", () => {
    const css = readerStylesheet(
      settings({
        theme: { foreground: "#eeeeee", background: "#111111", link: "#8ab4f8" },
      }),
    );

    // The whole mechanism is specificity: `:root a` is (0,1,1) and `:root *` is (0,1,0),
    // and both carry `!important`. Written any less specifically, links would come out the
    // same colour as the body text and the reader could not see what is tappable.
    expect(css).toContain(":root a, :root a * { color: #8ab4f8 !important; }");
    expect(css).toContain(":root, :root * { color: #eeeeee !important; }");
  });

  test("without a link colour the injected CSS is character-for-character what it was", () => {
    // The status quo is that links take the body text's colour. This test is what stops
    // `Theme.link` from having quietly changed every existing consumer's rendering — frond
    // picks no default link colour, because that would be exactly the presentational
    // opinion it declines to hold.
    const theme = { foreground: "#eeeeee", background: "#111111" };

    expect(readerStylesheet(settings({ theme }))).toBe(
      [
        ":root, :root * { color: #eeeeee !important; }",
        ":root { background-color: #111111 !important; }",
        ":root *:not(:root) { background-color: transparent !important; }",
      ].join("\n"),
    );
    expect(readerStylesheet(settings({ theme: { ...theme, link: undefined } }))).toBe(
      readerStylesheet(settings({ theme })),
    );
  });

  test("the margin does not appear in the injected CSS — it lives outside the iframe", () => {
    // Injecting into the book's CSS to fight over body's padding is exactly why spine
    // hangs a MutationObserver.
    expect(readerStylesheet(settings({ margin: 48 }))).not.toContain("48");
  });

  test("the column count does not appear in the reader stylesheet — it is a parameter of the pagination layer", () => {
    expect(readerStylesheet(settings({ columns: 2 }))).toBe("");
  });
});

/**
 * Faces the reader hands over as bytes (`settings.fontFaces`).
 *
 * `@font-face` is per-document and does not inherit, and the book is in an iframe
 * (ADR-0006) — so a consumer declaring the face on its own page reaches not one character
 * of the book. This is the only route in, which is why the address is carried through
 * verbatim: a `blob:` URL is the one form that survives offline (the issue's measurement:
 * a `blob:` iframe is not under a service worker's control in Chromium at all).
 */
describe("faces supplied as bytes", () => {
  const BLOB = "blob:http://reader.test/8d9a6c1e-1f2b-4d3c-9a7e-5b6c7d8e9f01";

  test("an empty list is the same as saying nothing", () => {
    expect(readerStylesheet(settings({ fontFaces: [] }))).toBe("");
  });

  test("a face becomes an @font-face rule carrying the address verbatim", () => {
    const css = readerStylesheet(
      settings({ fontFaces: [{ family: '"Reader Serif"', src: BLOB }] }),
    );

    expect(css).toBe(`@font-face { font-family: "Reader Serif"; src: url("${BLOB}"); }`);
  });

  test("weight and style are written only when the consumer gave them", () => {
    const bare = readerStylesheet(
      settings({ fontFaces: [{ family: '"Reader Serif"', src: BLOB }] }),
    );
    expect(bare).not.toContain("font-weight");
    expect(bare).not.toContain("font-style");

    const dressed = readerStylesheet(
      settings({
        fontFaces: [{ family: '"Reader Serif"', src: BLOB, weight: "700", style: "italic" }],
      }),
    );
    expect(dressed).toContain("font-weight: 700;");
    expect(dressed).toContain("font-style: italic;");
  });

  test("one family with two weights is two rules", () => {
    const css = readerStylesheet(
      settings({
        fontFaces: [
          { family: '"Reader Serif"', src: `${BLOB}-regular`, weight: "400" },
          { family: '"Reader Serif"', src: `${BLOB}-bold`, weight: "700" },
        ],
      }),
    );

    expect(css.split("\n")).toHaveLength(2);
    expect(css).toContain(`${BLOB}-regular`);
    expect(css).toContain(`${BLOB}-bold`);
  });

  test("supplying the bytes does not also apply the face — naming it stays a separate act", () => {
    // The division of labour this setting rests on: `fontFaces` says where a name's bytes
    // come from, `fontFamily` and `genericFamilies` say where the name is used. Applying it
    // here would make "self-host the book's own face" impossible to express — the reader
    // would be unable to supply bytes without also overriding every face the book named.
    const css = readerStylesheet(
      settings({ fontFaces: [{ family: '"Reader Serif"', src: BLOB }] }),
    );

    expect(css).not.toContain(":root");
  });

  test("a quote in the address cannot break out of the rule", () => {
    // A URL carries no unescaped `"` (it would be percent-encoded), so this guards a
    // malformed input rather than a plausible one — but the cost of not guarding it is the
    // rest of the reader's stylesheet being swallowed by an unterminated string.
    const css = readerStylesheet(
      settings({ fontFaces: [{ family: '"X"', src: 'blob:http://reader.test/a"; }' }] }),
    );

    expect(css).toBe('@font-face { font-family: "X"; src: url("blob:http://reader.test/a\\"; }"); }');
  });

  test("nothing is demoted for a face — no book declaration can block one", () => {
    // A book cannot declare "do not load that face", so there is no `!important` to take
    // away. Putting `font-family` in scope instead would strip the flag from every face the
    // book named, which is the opposite of what this setting promises.
    expect(
      overriddenProperties(settings({ fontFaces: [{ family: '"X"', src: BLOB }] })).size,
    ).toBe(0);
  });
});

/**
 * Which glyph variant the faces are shaped with (`settings.fontLanguage`).
 *
 * A pan-CJK face carries every CJK glyph and switches variants by language through `locl`,
 * and what triggers it is the book's `lang` — which a Traditional Chinese book very often
 * declares as a bare `zh`, at which point all three engines draw it with Simplified glyphs.
 * The consumer usually knows better than the book, and this lets it say so **without
 * touching the book's `lang` attribute**, which is also what hyphenation and screen readers
 * go by.
 */
describe("the glyph variant", () => {
  test("the tag is written as a quoted font-language-override on every element", () => {
    const css = readerStylesheet(settings({ fontLanguage: "ZHT" }));

    // Quoted because `font-language-override` takes a string, not a keyword: bare `ZHT` is
    // an invalid value and the whole declaration would be dropped.
    expect(css).toBe(':root, :root * { font-language-override: "ZHT" !important; }');
  });

  test("it rides in the same rule as the other per-element declarations", () => {
    const css = readerStylesheet(
      settings({ fontFamily: '"Reader Serif"', fontLanguage: "ZHT" }),
    );

    expect(css).toBe(
      ':root, :root * { font-family: "Reader Serif" !important; font-language-override: "ZHT" !important; }',
    );
  });

  test("nothing is demoted for a language tag", () => {
    // Books do not declare `font-language-override`. The one lever they have is the `font`
    // shorthand, which resets it — and demoting `font` would take the flag off the book's
    // size, family and line height too, none of which this reader has set.
    expect(overriddenProperties(settings({ fontLanguage: "ZHT" })).size).toBe(0);
  });
});

describe("applying a partial setting", () => {
  test("fields not mentioned stay as they were", () => {
    const first = withSettings(DEFAULT_SETTINGS, { fontSize: 24 });
    const second = withSettings(first, { lineHeight: 2 });

    expect(second.fontSize).toBe(24);
    expect(second.lineHeight).toBe(2);
    expect(second.margin).toBe(DEFAULT_SETTINGS.margin);
  });

  test("setting a field back to undefined cancels it", () => {
    const applied = withSettings(settings({ fontSize: 24 }), { fontSize: undefined });

    expect(applied.fontSize).toBeUndefined();
    expect(readerStylesheet(applied)).toBe("");
  });
});

/**
 * What the layout resolver answered, landed on the settings that layout runs under.
 *
 * The one thing worth pinning is that this is **not** `withSettings`: there, `undefined` is
 * a reader who set nothing and has to be able to cancel a setting. Here it can only be a
 * resolver with no opinion, because neither of these two fields has a "nothing" state —
 * every layout needs a margin and a column count. Merged the same way, an omitted margin
 * becomes a missing one, and `marginInsets()` reads `.block` off it one frame later.
 */
describe("applying what the layout resolver answered", () => {
  test("what it answers takes effect", () => {
    const applied = withLayout(settings({ margin: 24, columns: 1 }), {
      margin: { block: 10, inline: 60 },
      columns: 2,
    });

    expect(applied.margin).toEqual({ block: 10, inline: 60 });
    expect(applied.columns).toBe(2);
  });

  test("a field it left out keeps the reader's own value", () => {
    const applied = withLayout(settings({ margin: 24, columns: 2 }), { columns: 1 });

    expect(applied.margin).toBe(24);
  });

  test("an explicit undefined is an omission, not a cancellation", () => {
    const applied = withLayout(settings({ margin: 24 }), { margin: undefined });

    expect(applied.margin).toBe(24);
  });

  test("nothing outside those two fields can reach the settings from here", () => {
    // The type says so, and a consumer writing JavaScript has no type. The other settings
    // are written into the document while it is still text, before there is a writing mode
    // to read — honouring one here would mean rebuilding the document and laying out a
    // second time, which is what this API exists to avoid.
    const applied = withLayout(settings({ fontSize: 18 }), {
      fontSize: 32,
    } as Partial<LayoutSettings>);

    expect(applied.fontSize).toBe(18);
  });
});
