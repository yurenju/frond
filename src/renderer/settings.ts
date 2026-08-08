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

import type { ColumnChoice, Margin, Viewport, WritingMode } from "./geometry.ts";

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
  /**
   * What the book's generic families should resolve to.
   *
   * ## Why this is a reader setting rather than a correction of frond's own
   *
   * ADR-0003's table originally answered this case with "the book wins": a book declaring
   * `font-family: serif` has declared something legal, every character is still there, and
   * frond does not intervene because a book is ugly. That verdict stands for frond acting
   * **on its own** — and it is why this field exists instead.
   *
   * `serif` names no face. It **delegates the choice to the platform**, and for CJK the
   * three engines resolve that delegation to different faces (`docs/browser-quirks.md`
   * #4) — some of which carry no vertical punctuation glyphs, so the same declaration
   * that reads correctly on one machine puts the full stop at the bottom left on another.
   * Filling in a delegation the book left open is not overriding the book's choice; it is
   * supplying the one the book declined to make, and the reader's layer is the one
   * entitled to name a face (ADR-0004, and `fontFamily` above).
   *
   * The difference from `fontFamily` is the whole point: `fontFamily` replaces the book's
   * typography wholesale, while this leaves every face the book actually **named**
   * untouched and only reaches the stretches it left to the platform. A reader who wants
   * the publisher's fonts has nowhere else to go.
   *
   * Unset — and it is unset by default — frond substitutes nothing, so ADR-0003's
   * "frond does not intervene because a book is ugly" remains literally true.
   */
  readonly genericFamilies: GenericFamilies | undefined;
  /**
   * Faces the consumer supplies as **bytes** rather than by name.
   *
   * Each one is emitted as an `@font-face` rule into the reader's stylesheet, so a name
   * used in `fontFamily` or `genericFamilies` can resolve to a face the machine does not
   * have installed. `genericFamilies` fills in the name the book delegated; this fills in
   * where that name's bytes come from — the other half of the same delegation.
   *
   * ## Why the consumer cannot do this itself
   *
   * `@font-face` is per-document and does not inherit, and the book is in an iframe
   * (ADR-0006): a rule declared on the consumer's own page reaches not one character of
   * the book, and reaching into the iframe to add one is precisely what that boundary
   * exists to prevent. frond already injects the reader's stylesheet into the book's
   * document, so this is two more declarations on a route that is already open, not a new
   * one.
   *
   * It is a named field rather than an arbitrary stylesheet entry point for the reason
   * `Theme.link` gives: an arbitrary stylesheet would hand the intervention threshold
   * itself to the consumer.
   *
   * ## Supplying a face is not applying it
   *
   * Nothing here changes which face anything is set in — that stays with `fontFamily`,
   * `genericFamilies`, or the book's own declarations. Keeping the two apart is what lets
   * a consumer self-host the very face the book asks for by name, without overriding a
   * single one of the book's choices to do it.
   */
  readonly fontFaces: readonly FontFace[] | undefined;
  /**
   * Which OpenType language system the faces should be shaped with — the `ZHT` / `ZHS` /
   * `JAN` / `KOR` tag, emitted as `font-language-override`.
   *
   * ## Why naming the face is not enough
   *
   * A pan-CJK face (Noto CJK, and it is the norm) carries the whole CJK glyph set in one
   * file and switches between the regional forms with the `locl` feature — the Traditional
   * Chinese, Simplified, Japanese and Korean shapes of the same code point are all in
   * there. What selects between them is the **book's `lang`**, and a book saying `lang="zh"`
   * is very common: all three engines then draw a Traditional Chinese book with Simplified
   * glyphs (`docs/browser-quirks.md`).
   *
   * The consumer often knows the answer better than the book does — spine decides by
   * counting characters in the text, because language metadata lies. This is how it says
   * so **without frond touching the book's `lang` attribute**, which also drives line
   * breaking and what a screen reader announces: overwriting that really would be
   * overriding the book's declaration, while a glyph variant is not.
   *
   * **WebKit ignores this** — it does not implement the property at all (measured, see
   * `docs/browser-quirks.md`). What a reader gets there is the book's own `lang`, which is
   * where they already were, so the setting is inert rather than wrong.
   */
  readonly fontLanguage: string | undefined;
}

/**
 * One face, supplied as bytes.
 *
 * ## Why `src` is an absolute URL, and why `blob:` has to be accepted
 *
 * A consumer that works offline has to keep the font's bytes on the device, and the
 * measurement in #92 says there is only one way back out of that storage in all three
 * engines: **a `blob:` iframe is not under a service worker's control in Chromium at
 * all**, so "keep the font in the Cache API and let the worker serve it" leaves Chrome
 * with missing glyphs offline. Bytes wrapped in a `Blob` and named by `createObjectURL`
 * load in all three.
 *
 * That is also why the address is absolute: a relative path resolves against the book's
 * document, which is itself a `blob:` (ADR-0006), and resolution there is not dependable.
 * A `blob:` URL is absolute to begin with.
 */
export interface FontFace {
  /**
   * The family name to declare, as a CSS value — the same string the consumer would pass
   * to `fontFamily`, quoting and all, so that one name can be written once and used in
   * both places.
   */
  readonly family: string;
  /** Where the bytes are. An absolute URL; `blob:` is the point (see above). */
  readonly src: string;
  /** The `font-weight` descriptor. Left out, the face answers for every weight. */
  readonly weight?: string | undefined;
  /** The `font-style` descriptor. Left out, the face answers for every style. */
  readonly style?: string | undefined;
}

/**
 * The faces to use where the book delegated the choice to the platform.
 *
 * A field left out means "leave that keyword alone", which is a different thing from an
 * empty string — the same distinction the rest of these settings draw between `undefined`
 * and a value.
 *
 * Only `serif` and `sans-serif` are recognised. `monospace`, `cursive`, `fantasy` and
 * `system-ui` are left alone: they are not what CJK body text is set in, and the
 * measurement this exists for (#4) covers those two only. `font: 12px serif`, the
 * shorthand, is likewise not reached — see `css.ts`'s `resolveGenericFamilies`.
 */
export interface GenericFamilies {
  readonly serif?: string | undefined;
  readonly sansSerif?: string | undefined;
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
  genericFamilies: undefined,
  fontFaces: undefined,
  fontLanguage: undefined,
};

/** Applies a partial set of settings. Fields not mentioned keep their current value. */
export function withSettings(
  base: ReaderSettings,
  patch: Partial<ReaderSettings>,
): ReaderSettings {
  return { ...base, ...patch };
}

/**
 * What a layout is a function of, at the one moment they are all known and nothing has
 * laid out yet.
 *
 * The writing mode is the reason this exists. It is declared in the book's stylesheet and
 * settled by the browser, so **frond cannot answer it until the document is displayed**
 * (`writing-mode.ts` — reading it any earlier means matching strings, which misses real
 * books). A consumer whose margin depends on it therefore has nowhere to compute that
 * margin: before `attach()` the fact does not exist, and after the first `load` the
 * position has already been restored, so correcting it means a second layout — which
 * moves the reader somewhere else in the section.
 */
export interface LayoutFacts {
  readonly writingMode: WritingMode;
  /**
   * The container's size in CSS px, **before the margin is taken off** — the number the
   * layout is divided up out of.
   */
  readonly viewport: Viewport;
}

/**
 * The settings that may depend on `LayoutFacts`, and the only ones that can.
 *
 * The list is not a matter of taste. Every other setting is written into the document
 * **while it is still text** (`css.ts`: the book's `!important` is demoted, absolute font
 * sizes become `rem`, generic families are filled in), and that happens before there is a
 * document to read a writing mode from. These two are the ones applied afterwards: the
 * margin insets the iframe within its container, and the column count goes into the
 * stylesheet frond injects.
 *
 * So a wider type would be a promise frond cannot keep — a `fontSize` returned from here
 * could only be honoured by rebuilding the document and laying out a second time, which is
 * exactly what a consumer comes here to avoid.
 */
export type LayoutSettings = Pick<ReaderSettings, "margin" | "columns">;

/**
 * Answers the layout settings from the facts. Called **once per layout**: every section
 * mount, and every `relayout()`.
 *
 * Per layout rather than per book, because neither fact is a property of the book:
 * sections of one book need not agree on the writing mode, and the viewport changes when
 * the window does.
 *
 * **Exceptions are not caught.** One thrown here fails the section load and surfaces as an
 * `error` event; the alternative — falling back to the base settings — would show a book
 * laid out to a margin nobody asked for, with nothing anywhere saying why.
 */
export type ResolveLayout = (facts: LayoutFacts) => Partial<LayoutSettings>;

/**
 * Applies what the resolver answered on top of the reader's settings.
 *
 * **An `undefined` field means "no opinion" here**, which is the opposite of what it means
 * in `withSettings`: there, `fontFamily: undefined` is a reader who set no font, and it has
 * to be able to overwrite one that was set. Neither of these two fields has that state —
 * every layout needs a margin and a column count — so an `undefined` coming out of the
 * resolver can only be an omission, and `{ ...base, ...patch }` would turn it into a
 * missing margin and a crash one frame later.
 */
export function withLayout(
  base: ReaderSettings,
  patch: Partial<LayoutSettings>,
): ReaderSettings {
  return {
    ...base,
    ...(patch.margin === undefined ? {} : { margin: patch.margin }),
    ...(patch.columns === undefined ? {} : { columns: patch.columns }),
  };
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
 *
 * **`genericFamilies` deliberately adds nothing here.** That rewrite substitutes a value
 * in place and carries the book's `!important` over with it (`css.ts`'s
 * `resolveGenericFamilies`), so there is nothing to demote — the book's declaration keeps
 * whatever weight it had, and only the platform's share of it is filled in. Adding
 * `font-family` to this set would instead strip the flag from every face the book named,
 * which is the opposite of what that setting promises.
 *
 * **`fontFaces` and `fontLanguage` add nothing here either**, for two different reasons.
 * A face is *supplied*, not applied: there is no declaration in any book that can block an
 * `@font-face`, so there is no `!important` to take away — and `font-family` would be the
 * wrong thing to take it from, exactly as above. A language tag is a per-element
 * declaration and could in principle be blocked, but only by the `font` shorthand, which
 * resets `font-language-override` along with everything else it sets. Demoting `font` for
 * that would take the flag off the book's size, family and line height as well, none of
 * which this reader has set — a wider intervention than the setting asks for, in exchange
 * for a shape no book in the sample has.
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
 *
 * ## The `@font-face` rules carry no `!important`, and no selector
 *
 * They are not in the fight with the book's cascade at all: an `@font-face` declares that
 * a name has bytes, and nothing a book can write competes with that. They go first only
 * because a face is easier to read above the rules that might use it.
 */
export function readerStylesheet(settings: ReaderSettings): string {
  const rules: string[] = [];

  for (const face of settings.fontFaces ?? []) {
    const descriptors = [
      `font-family: ${face.family};`,
      `src: url(${cssString(face.src)});`,
      ...(face.weight === undefined ? [] : [`font-weight: ${face.weight};`]),
      ...(face.style === undefined ? [] : [`font-style: ${face.style};`]),
    ];
    rules.push(`@font-face { ${descriptors.join(" ")} }`);
  }

  if (settings.fontSize !== undefined) {
    rules.push(`:root { font-size: ${settings.fontSize}px !important; }`);
  }

  const everything: string[] = [];
  if (settings.fontFamily !== undefined) {
    everything.push(`font-family: ${settings.fontFamily} !important;`);
  }
  if (settings.fontLanguage !== undefined) {
    // Quoted, because the value is a string rather than a keyword: `font-language-override:
    // ZHT` is invalid and the whole declaration would be thrown away — silently, which is
    // the failure mode worth spending a function call on.
    everything.push(`font-language-override: ${cssString(settings.fontLanguage)} !important;`);
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

/**
 * A consumer-supplied value written out as a CSS string.
 *
 * The rest of this module passes the reader's values through verbatim, because they are
 * documented as CSS values — the consumer writes the quotes. These two are not: a `src` is
 * a URL and a `fontLanguage` is an OpenType tag, so frond adds the quoting, and having
 * added it has to make sure the value cannot end the string early. A URL percent-encodes
 * its quotes and a language tag is four letters, so this guards a malformed input rather
 * than a plausible one — but an unterminated string swallows every rule after it, and the
 * reader would see their settings half-applied with nothing reported.
 */
function cssString(value: string): string {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}
