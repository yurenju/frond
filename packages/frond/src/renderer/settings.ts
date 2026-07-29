/**
 * Reader settings — the topmost layer in the authority order (ADR-0003:
 * `reader settings > frond's corrections > the book's declarations`).
 *
 * ADR-0003 says "where frond refuses to fix something itself, it takes on the duty of
 * letting the layer above fix it", so this override surface is a requirement rather
 * than a bonus. The list is set by that ADR too: font, font size, line height, margin,
 * one/two/auto columns (horizontal only), theme.
 *
 * **Text alignment is explicitly not offered** (left-aligned / justified), as ADR-0003
 * states.
 *
 * ## No setting means no intervention
 *
 * Every field may be `undefined`, and `undefined` is a different thing from "set to the
 * book's default": for an unset field frond overrides not one character, and the book's
 * own declarations stand untouched (ADR-0003's "the book's own fonts and typography are
 * preserved intact as long as I have not actively adjusted anything", user story 45).
 *
 * That boundary becomes machine-readable in `overriddenProperties()` — it answers
 * "which of the book's `!important` declarations should be taken away", and the answer
 * covers only what the reader actually set.
 */

import type { ColumnChoice, Margin } from "./geometry.ts";

/** A theme's foreground and background. Any CSS colour value will do. */
export interface Theme {
  readonly foreground: string;
  readonly background: string;
  /**
   * The link colour. Unset, links take the same colour as the body text.
   *
   * ## Why this is part of the theme rather than a general CSS entry point
   *
   * `foreground` is applied to every element (`:root, :root *`), and `a` is one of them —
   * so once a theme is set, a link is the same colour as the text around it and the reader
   * cannot see what is tappable. Excluding `a` from the colour rule instead would leave the
   * book's own dark blue sitting on a dark background, and "the content cannot be read" is
   * the one intervention ADR-0003 does recognise: that trades one ailment for another.
   *
   * So the fix has to come from above, and ADR-0003 requires frond to make that possible
   * ("where frond refuses to fix something itself, it takes on the duty of letting the layer
   * above fix it"). It is a named field rather than an arbitrary stylesheet because an
   * arbitrary stylesheet would hand the intervention threshold itself to the consumer — and
   * because what a link looks like is genuinely part of the theme the reader chose.
   *
   * frond picks no default: a colour of its own would be exactly the presentational opinion
   * it declines to hold.
   */
  readonly link?: string | undefined;
}

export interface ReaderSettings {
  /**
   * A named face. **Named rather than a generic family**: the three browsers do not
   * agree on CJK resolution for `serif` (#4), and reader settings are the one layer in
   * the authority order that may legitimately name a face (ADR-0004).
   */
  readonly fontFamily: string | undefined;
  /** Font size, in px. */
  readonly fontSize: number | undefined;
  /** Line height, as a multiplier (unitless). */
  readonly lineHeight: number | undefined;
  /**
   * The layout margin, in px. A scalar means all four sides equally; the object form
   * splits by axis according to the writing mode (`geometry.ts`'s `Margin`).
   *
   * It is **not** CSS injected into the book; it insets the iframe within its container
   * — see `section-view.ts`. The margin therefore never passes through the book's
   * cascade, and never has to fight the book's `body` padding.
   */
  readonly margin: Margin;
  /** The column count. Vertical is always single-column, and setting it has no effect (ADR-0003). */
  readonly columns: ColumnChoice;
  readonly theme: Theme | undefined;
}

/**
 * A reader who has set nothing.
 *
 * The margin is the one field with a default — at 0 the text would sit flush against the
 * edge of the screen, and that is not "the book's own declaration", it is frond failing
 * to provide a layout. This value belongs to frond's own layer (ADR-0003's first row:
 * the layout used for pagination belongs to frond to begin with).
 */
export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: undefined,
  fontSize: undefined,
  lineHeight: undefined,
  margin: 24,
  columns: "auto",
  theme: undefined,
};

/** Applies a partial set of settings. Fields not mentioned keep their current value. */
export function withSettings(
  base: ReaderSettings,
  patch: Partial<ReaderSettings>,
): ReaderSettings {
  return { ...base, ...patch };
}

/**
 * Which CSS properties the reader has actually overridden.
 *
 * This set is the **scope** of the intervention: only properties inside it have the
 * book's declared `!important` taken away (`css.ts`'s `demoteImportant`). When the
 * reader has not set a font size, `font-size` is not in it, and the book's
 * `font-size: 12px !important` stands verbatim — that is ADR-0003's threshold, not an
 * oversight.
 *
 * The `font` shorthand is included as soon as any one of the three font-related settings
 * is overridden: a single `font` declaration can pin the size, the line height and the
 * face all at once, so leaving its `!important` in place would leave a way around.
 */
export function overriddenProperties(
  settings: ReaderSettings,
): ReadonlySet<string> {
  const properties = new Set<string>();

  if (settings.fontSize !== undefined) properties.add("font-size");
  if (settings.fontFamily !== undefined) properties.add("font-family");
  if (settings.lineHeight !== undefined) properties.add("line-height");
  if (
    settings.fontSize !== undefined ||
    settings.fontFamily !== undefined ||
    settings.lineHeight !== undefined
  ) {
    properties.add("font");
  }

  if (settings.theme !== undefined) {
    properties.add("color");
    properties.add("background");
    properties.add("background-color");
    properties.add("background-image");
  }

  return properties;
}

/**
 * The stylesheet injected for the reader's settings.
 *
 * Every rule carries `!important`, and **it only means anything once the book's
 * `!important` has been taken away** — the two have to happen together to win
 * (`css.ts`'s `demoteImportant` and `relativiseFontSizes`). Injecting this alone, the
 * book's `p { font-size: 12px !important }` still wins, because its selector is more
 * specific.
 *
 * ## Why the font size is only set on the root element while the rest is set on every element
 *
 * The font size has to preserve the book's own hierarchy (headings larger than body
 * text), so only the root is set and the proportions carry down through inheritance and
 * `rem`. The face, line height and colour have no such concern — a reader saying "use
 * this face" means the whole book, so those are applied to every element directly, which
 * is the only way the book's declarations on descendant elements cannot win them back.
 */
export function readerStylesheet(settings: ReaderSettings): string {
  const rules: string[] = [];

  if (settings.fontSize !== undefined) {
    rules.push(`:root { font-size: ${settings.fontSize}px !important; }`);
  }

  const everything: string[] = [];
  if (settings.fontFamily !== undefined) {
    everything.push(`font-family: ${settings.fontFamily} !important;`);
  }
  if (settings.lineHeight !== undefined) {
    everything.push(`line-height: ${settings.lineHeight} !important;`);
  }
  if (settings.theme !== undefined) {
    everything.push(`color: ${settings.theme.foreground} !important;`);
  }
  if (everything.length > 0) {
    rules.push(`:root, :root * { ${everything.join(" ")} }`);
  }

  if (settings.theme?.link !== undefined) {
    // The whole mechanism is specificity: `:root a` is (0,1,1) against `:root *`'s (0,1,0),
    // and both carry `!important`, so this rule wins over the foreground colour above with
    // nothing else needed. Against the book it wins the same way every other reader setting
    // does — its `!important` is already demoted for `color` (`overriddenProperties` puts
    // `color` in scope as soon as a theme is set), including in a style attribute.
    rules.push(`:root a, :root a * { color: ${settings.theme.link} !important; }`);
  }

  if (settings.theme !== undefined) {
    // The background takes two rules: the base colour goes only on the root element, and
    // everything else is made transparent.
    //
    // Books hard-coding a background on `body` or on some wrapper div is the norm
    // (`hardcoded-colors`), and that patch of white would sit on top of the reader's dark
    // background. Setting it all to the reader's background is wrong too — that would make
    // the quote blocks a book distinguishes by background disappear. Transparent is the
    // one answer that lets the base colour through without pretending the book has no
    // sections.
    //
    // The cost has to be stated plainly: **setting a theme means giving up the book's own
    // colour scheme.** That is the cost of theming itself rather than a choice of this
    // implementation — it is precisely what user story 43 asks for.
    rules.push(`:root { background-color: ${settings.theme.background} !important; }`);
    rules.push(`:root *:not(:root) { background-color: transparent !important; }`);
  }

  return rules.join("\n");
}
