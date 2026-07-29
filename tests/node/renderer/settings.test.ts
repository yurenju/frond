import { describe, expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  overriddenProperties,
  readerStylesheet,
  withSettings,
  type ReaderSettings,
} from "../../../packages/frond/src/renderer/settings.ts";

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
