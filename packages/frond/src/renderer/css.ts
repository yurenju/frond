/**
 * Every textual rewrite made to a book's stylesheets. **This module does not touch the
 * DOM**; its input and output are both CSS strings.
 *
 * Each rewrite corresponds to one entry in ADR-0003's intervention list, and the reasons
 * live with that list in `interventions.ts` — only the mechanism is here. They are kept
 * apart because they change at different rates: the mechanism changes when new browser
 * behaviour is measured, the list changes when a trade-off changes, and mixing them
 * would scatter the question "why is frond allowed to touch the book's declarations"
 * across the codebase.
 *
 * ## Why a hand-written pass rather than regular expressions
 *
 * CSS declarations are not line-oriented: a `;` may appear inside a string or a `url()`,
 * a comment may be spliced into the middle of a property name, and an `@media` block
 * contains rules rather than declarations. Regular expressions get all three wrong, and
 * the form the failure takes is **silently corrupting a book's stylesheet** — nobody
 * receives an error message, they just see a broken layout.
 *
 * So this walks the text itself, recognising only four things: comments, strings,
 * parentheses, and the `{` `}` `;` separators. It is not a CSS parser (selectors and
 * at-rule preludes are always carried over verbatim), it is a **declaration locator** —
 * enough to answer "is this stretch of text a declaration, and what is its property
 * name", and that is exactly all any of the rewrites need.
 */

/** One declaration. `important` and `value` are separate, because every rewrite only touches one of them. */
export interface Declaration {
  /** The property name, already lower-cased and trimmed. */
  readonly property: string;
  /** The value, with `!important` removed and trimmed. */
  readonly value: string;
  readonly important: boolean;
  /** The whole declaration verbatim (without the trailing `;`). When unchanged the original text is carried back, whitespace and comments included. */
  readonly source: string;
}

/**
 * Walks every declaration in a stylesheet.
 *
 * Returning `undefined` means leaving this one alone — **and leaving it alone means
 * carrying the original text back**, whitespace and comments preserved. That is
 * deliberate: a rewrite has to be applicable to a book repeatedly and leave a trace only
 * where it should, or "what did frond touch" becomes unanswerable.
 */
export function mapStylesheet(
  css: string,
  map: (declaration: Declaration) => string | undefined,
): string {
  return scan(css, map, { insideBlock: false });
}

/**
 * Walks a **declaration list** — the kind inside a `style="…"` attribute, with no braces.
 *
 * Two entry points are needed because the same text means different things in the two
 * contexts: in a stylesheet, the `p` of `p { color: red }` is a selector, while in a
 * style attribute the whole thing is declarations.
 */
export function mapDeclarationList(
  text: string,
  map: (declaration: Declaration) => string | undefined,
): string {
  return scan(text, map, { insideBlock: true });
}

/**
 * Expands `@import`ed stylesheets **in place**, recursively all the way down.
 *
 * ## Why rewriting the `@import`'s address to `blob:` is not enough
 *
 * Two independent reasons, and four books in the sample walk into both:
 *
 * 1. **The string form is not a `url()` at all.** `@import "style-standard.css";`
 *    contains no `url(`, so `rewriteUrls` does not touch one character of it. Relative
 *    paths always fail to resolve under `blob:` (`document-source.ts`'s header), so that
 *    stylesheet **disappears entirely**. Four books (九歌112年散文選, 創業投資聖經,
 *    原子習慣, 大器可以晚成, all from the same Kadokawa/BookCreator toolchain) have
 *    content documents that only `<link>` a single `book-style.css`, and that file
 *    contains **nothing but `@import` strings** apart from an `@charset` — the entire
 *    typographic intent lives in the imported files. The symptom is all four vertical
 *    books laying out horizontally.
 *
 * 2. **`@import` loads asynchronously.** Even rewritten to `blob:`, frond measures the
 *    total content length to compute the page count immediately after the iframe's load
 *    event, and if the styles have not arrived what is measured is an unstyled layout —
 *    so the page count is wrong, and only when loading happens to be slow. The `<link>`
 *    case is already solved by inlining; `@import` follows the same reasoning.
 *
 * Expanding in place solves both at once: the cascade order is preserved verbatim (the
 * spec requires `@import` to precede all rules, so "splice at its original position" and
 * "treat as written there" are the same thing), and once the text is inside a `<style>`
 * there is no second network round trip to speak of.
 *
 * ## What will not expand is left verbatim
 *
 * `expand` returns `undefined` when the reference points outside the book
 * (`@import url(https://…)`), when the archive has no such file, or on a cycle. It is
 * left verbatim rather than deleted — deleting would hide from whoever is investigating
 * what the book actually asked for, and an unresolvable `@import` looks the same on
 * screen as not having one.
 *
 * The `layer()` and `supports()` forms are likewise left verbatim: both change the
 * cascade's layering and conditions, and "splicing the text in" cannot reproduce that.
 * Not one book in the sample has them, so implementing it would mean writing to the spec.
 */
export function inlineImports(
  css: string,
  expand: (reference: string) => string | undefined,
): string {
  let output = "";
  let index = 0;
  let depth = 0;

  while (index < css.length) {
    // Comments and strings are carried over verbatim — an `@import` inside one is not an
    // at-rule.
    const skipped = skipOpaque(css, index);
    if (skipped > index) {
      output += css.slice(index, skipped);
      index = skipped;
      continue;
    }

    const character = css[index]!;
    if (character === "{") depth += 1;
    else if (character === "}") depth = Math.max(0, depth - 1);

    // `@import` is only meaningful at the outermost level. One inside a block (inside an
    // `@media`, say) is non-conforming and is left verbatim.
    if (depth === 0 && character === "@" && IMPORT_AT_RULE.test(css.slice(index))) {
      const rule = readImportRule(css, index);
      if (rule !== undefined) {
        const expanded = rule.reference === undefined ? undefined : expand(rule.reference);
        output +=
          expanded === undefined
            ? css.slice(index, rule.end)
            : wrapInMedia(expanded, rule.media);
        index = rule.end;
        continue;
      }
    }

    output += character;
    index += 1;
  }

  return output;
}

/**
 * `@import`, in any case.
 *
 * It has to be followed by whitespace, a quote or a `(` — without that lookahead a custom
 * at-rule like `@imports-are-fun` would also match. The `url(` route is covered by the
 * whitespace (`@import url(…)` always has whitespace, and `@importurl(…)` is not valid
 * CSS).
 */
const IMPORT_AT_RULE = /^@import(?=[\s"'(])/i;

interface ImportRule {
  /** The imported address. `undefined` when it cannot be recognised (the `layer()` forms, for instance). */
  readonly reference: string | undefined;
  /** What sits after the address and before the `;` — the media query. An empty string when there is none. */
  readonly media: string;
  /** Where this rule ends in the source (after the `;`). */
  readonly end: number;
}

/**
 * Reads one `@import`.
 *
 * Both notations are recognised: `@import "a.css"` and `@import url(a.css)`. **Both have
 * to be**, because the string form is precisely the one measured in the sample, and an
 * implementation recognising only `url()` makes the entire stylesheet disappear in those
 * four books.
 */
function readImportRule(css: string, start: number): ImportRule | undefined {
  let index = start + "@import".length;

  while (index < css.length && /\s/.test(css[index]!)) index += 1;

  let reference: string | undefined;

  if (css[index] === '"' || css[index] === "'") {
    const closing = skipOpaque(css, index);
    reference = unquote(css.slice(index, closing));
    index = closing;
  } else if (/^url\(/i.test(css.slice(index))) {
    const opening = index + "url".length;
    const closing = skipOpaque(css, opening);
    reference = unquote(css.slice(opening + 1, closing - 1).trim());
    index = closing;
  }

  // What lies between the address and the `;` is the media query. Going through
  // `skipOpaque` is what keeps the parentheses in
  // `@import "a.css" (min-width: 30em);` from fooling it.
  let media = "";
  while (index < css.length) {
    const skipped = skipOpaque(css, index);
    if (skipped > index) {
      media += css.slice(index, skipped);
      index = skipped;
      continue;
    }
    if (css[index] === ";") {
      index += 1;
      break;
    }
    // Hitting a block boundary with no semicolon — this `@import` is written wrong, so it
    // is left verbatim.
    if (css[index] === "}" || css[index] === "{") return undefined;
    media += css[index];
    index += 1;
  }

  media = media.trim();

  // `layer` and `supports()` change the cascade's layering and conditions, and splicing
  // text in cannot reproduce that.
  if (/^layer\b|\bsupports\s*\(/i.test(media)) {
    return { reference: undefined, media, end: index };
  }

  return { reference, media, end: index };
}

/**
 * An expanded `@import` carrying a media query has to be wrapped in an `@media`.
 *
 * `@import "print.css" print;` means "this stylesheet only applies under print", and
 * splicing its content in bare would make that condition disappear — those rules would
 * then apply unconditionally.
 */
function wrapInMedia(css: string, media: string): string {
  return media === "" ? css : `@media ${media} {\n${css}\n}`;
}

/**
 * Adds an unprefixed equivalent alongside `-epub-` and `-webkit-` prefixed
 * `writing-mode`.
 *
 * Firefox recognises neither prefix, so a book writing only the prefixed form (the
 * 《入境大廳》 shape) lays out entirely horizontally in Firefox
 * (`docs/browser-quirks.md`). This is **not overriding the book's declaration**: the
 * book's intent is unchanged, only the syntax expressing it is.
 *
 * It adds a declaration rather than replacing the original. Replacing would work in all
 * three, but if the removed declaration turned out to carry some other meaning (some
 * browser treating the prefixed property differently), that difference would be eaten by
 * this rewrite — whereas adding one costs only a few bytes.
 */
export function normalisePrefixedWritingMode(css: string): string {
  return mapStylesheet(css, (declaration) => {
    const unprefixed = UNPREFIXED_WRITING_MODE.get(declaration.property);
    if (unprefixed === undefined) return undefined;
    return `${declaration.source};${unprefixed}: ${declaration.value}${
      declaration.important ? " !important" : ""
    }`;
  });
}

const UNPREFIXED_WRITING_MODE = new Map([
  ["-epub-writing-mode", "writing-mode"],
  ["-webkit-writing-mode", "writing-mode"],
]);

/**
 * Adds the multi-column equivalent `break-*` alongside `page-break-*`.
 *
 * Books using `page-break-before: always` to separate sections is the norm, and
 * **`page-break-*` has no effect in a multi-column layout** — the `page` break type is
 * about paged media (printing), whereas columns on a screen want `column`. Without this,
 * content flows straight on where the book plainly asked for a break, and that is the
 * book's intent going unrealised rather than frond rendering faithfully.
 *
 * The same shape as the prefix rule: add one, replace nothing, intent unchanged and only
 * the expression swapped.
 */
export function normalisePageBreaks(css: string): string {
  return mapStylesheet(css, (declaration) => {
    const modern = MODERN_BREAK_PROPERTY.get(declaration.property);
    if (modern === undefined) return undefined;

    const value = COLUMN_BREAK_VALUE.get(declaration.value.toLowerCase());
    if (value === undefined) return undefined;

    return `${declaration.source};${modern}: ${value}${
      declaration.important ? " !important" : ""
    }`;
  });
}

const MODERN_BREAK_PROPERTY = new Map([
  ["page-break-before", "break-before"],
  ["page-break-after", "break-after"],
  ["page-break-inside", "break-inside"],
]);

/**
 * Converting `page-break-*` values into `break-*` values.
 *
 * `left` and `right` refer to the left and right pages of a spread, a concept that does
 * not exist in a multi-column layout — they fall back to a plain "break to the next
 * column", which is the closest meaning. `auto` and `avoid` are named the same on both
 * sides.
 */
const COLUMN_BREAK_VALUE = new Map([
  ["always", "column"],
  ["left", "column"],
  ["right", "column"],
  ["avoid", "avoid"],
  ["auto", "auto"],
]);

/**
 * Removes `!important` from the named properties.
 *
 * This is the only effective mechanism for the "the reader's setting is blocked by the
 * book" case. An external stylesheet cannot beat an `!important` the book wrote inside
 * `style="…"` — that is not a question of priority, it is that no position in the cascade
 * wins against it. So the only way to let the reader win is to remove that flag while the
 * book's declaration is still text.
 *
 * **Only the properties the reader has actually overridden are touched.** When the reader
 * has not set a font size, the book's `font-size: 12px !important` stands verbatim —
 * ADR-0003's intervention threshold is "the reader's setting is blocked by the book", and
 * with no reader setting nothing is being blocked, so there is no reason to intervene.
 */
export function demoteImportant(
  source: string,
  properties: ReadonlySet<string>,
  scope: CssScope = "stylesheet",
): string {
  return walk(source, scope, (declaration) =>
    declaration.important && properties.has(declaration.property)
      ? `${declaration.property}: ${declaration.value}`
      : undefined,
  );
}

/**
 * Which kind of text a rewrite is applied to.
 *
 * The same rewrite has to apply both to a stylesheet and to a `style="…"` attribute, and
 * those two have **different grammars**: in a stylesheet the `p` of `p { … }` is a
 * selector, while in a style attribute the whole thing is declarations. The only
 * difference is the walker, so it is expressed as a parameter rather than writing each
 * rewrite twice — two copies would certainly drift, and on the day they did, the reader's
 * font size would take effect when the book wrote it in a stylesheet and fail when the
 * book wrote it in a style attribute.
 */
export type CssScope = "stylesheet" | "declarations";

function walk(
  source: string,
  scope: CssScope,
  map: (declaration: Declaration) => string | undefined,
): string {
  return scope === "stylesheet"
    ? mapStylesheet(source, map)
    : mapDeclarationList(source, map);
}

/**
 * The book's initial font size. It is the basis when converting absolute `font-size`
 * values to `rem`.
 *
 * 16px is every browser's `font-size: medium`, which is the size when the book declares
 * nothing.
 */
const INITIAL_FONT_SIZE = 16;

/** 1pt = 4/3 px. */
const PX_PER_PT = 4 / 3;

/**
 * Converts the book's hard-coded absolute `font-size` values to `rem`.
 *
 * ## Why removing `!important` alone is not enough
 *
 * The reader's font size is set on `html` and carried down by inheritance. As soon as the
 * book writes an absolute value on any descendant (`p { font-size: 12px }`), that stretch
 * detaches from the inheritance chain — the reader raises the size to 24px and the body
 * text is still 12px. There is no `!important` involved here; **the absolute value
 * itself** is what blocks the reader.
 *
 * Converted to `rem`, every font size the book declares becomes "a multiple of what the
 * reader set": `12px` is 0.75×, `24px` is 1.5×. Adjusting the size scales the whole
 * document by the same factor, and **the book's own hierarchy of sizes is preserved
 * entirely** — headings are still larger than body text, in exactly the same proportion.
 *
 * ## Why `rem` rather than `em`
 *
 * `em` is relative to the parent, so nested absolute sizes would multiply: `p`'s 0.75×
 * under `span`'s 0.625× becomes 0.47×, where the book meant 0.625×. `rem` is always
 * relative to the root and does not multiply, so every proportion is identical before and
 * after conversion.
 *
 * ## The cost
 *
 * This is the **only entry on the list that changes a value the book declared**; all the
 * others merely add declarations or remove a flag. Put differently, the book's intent
 * that "this stretch is always 12px" genuinely goes unrealised — but that intent conflicts
 * directly with user story 42 (adjusting the reader's font size has to take effect), and
 * ADR-0003 has already resolved that in the reader's favour. What is preserved is the half
 * that can be: the **proportions** between sizes.
 *
 * As with `demoteImportant`, **this only happens when the reader has set a font size**.
 */
export function relativiseFontSizes(
  source: string,
  scope: CssScope = "stylesheet",
): string {
  return walk(source, scope, (declaration) => {
    if (declaration.property !== "font-size") return undefined;

    const rem = toRem(declaration.value);
    if (rem === undefined) return undefined;

    return `font-size: ${rem}${declaration.important ? " !important" : ""}`;
  });
}

/**
 * Converts an absolute length to `rem`. **Only when the entire value is one absolute
 * length.**
 *
 * Values that are already relative (`em`, `rem`, `%`, `larger`) follow the reader to begin
 * with and need no change; compound values such as `calc()` are left alone, because
 * converting them would require understanding the whole expression, and converting wrongly
 * is worse than not converting.
 */
function toRem(value: string): string | undefined {
  const match = /^(-?\d*\.?\d+)(px|pt)$/i.exec(value.trim());
  if (match === null) return undefined;

  const amount = Number(match[1]);
  const pixels = match[2]!.toLowerCase() === "pt" ? amount * PX_PER_PT : amount;
  const rem = pixels / INITIAL_FONT_SIZE;

  // Rounded to four decimal places. Without rounding, a conversion like 12pt drags out a
  // long repeating decimal that makes the rewritten stylesheet hard to read, and that text
  // is the only thing visible when investigating a problem.
  return `${Number(rem.toFixed(4))}rem`;
}

/**
 * Walks a stretch of CSS, handing every declaration to `map`.
 *
 * `insideBlock` is the whole walk's only state machine: outside a block, the accumulated
 * text is a selector or an at-rule prelude (only known on hitting `{`); inside a block, the
 * accumulated text is a declaration (only known on hitting `;` or `}`). Nested at-rules (an
 * `@media` containing rules) fall out naturally from "hitting `{` means what just
 * accumulated was a selector" — a colon inside that text is never mistaken for a
 * declaration.
 */
function scan(
  source: string,
  map: (declaration: Declaration) => string | undefined,
  options: { insideBlock: boolean },
): string {
  let output = "";
  let pending = "";
  let depth = options.insideBlock ? 1 : 0;
  let index = 0;

  const flushDeclaration = (): void => {
    output += depth > 0 ? rewriteDeclaration(pending, map) : pending;
    pending = "";
  };

  while (index < source.length) {
    const character = source[index]!;

    // Comments, strings and parentheses are carried over verbatim: the `;` `{` `}` `:`
    // inside them are not separators.
    const skipped = skipOpaque(source, index);
    if (skipped > index) {
      pending += source.slice(index, skipped);
      index = skipped;
      continue;
    }

    if (character === "{") {
      // What just accumulated was a selector or an at-rule prelude; carry it over verbatim.
      output += pending;
      pending = "";
      output += character;
      depth += 1;
      index += 1;
      continue;
    }

    if (character === "}") {
      flushDeclaration();
      output += character;
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    if (character === ";") {
      flushDeclaration();
      output += character;
      index += 1;
      continue;
    }

    pending += character;
    index += 1;
  }

  flushDeclaration();
  return output;
}

/**
 * Comments, strings and parentheses — separators inside these three do not separate.
 *
 * Returns the position after skipping; returns `index` unchanged when it is none of the
 * three. Parentheses are handled here too because semicolons inside `url(…)` are very
 * common (a `data:` URI has them), and parentheses inside `calc()` have to be counted in
 * pairs.
 */
function skipOpaque(source: string, index: number): number {
  const character = source[index]!;

  if (character === "/" && source[index + 1] === "*") {
    const end = source.indexOf("*/", index + 2);
    return end === -1 ? source.length : end + 2;
  }

  if (character === '"' || character === "'") {
    let cursor = index + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === character) return cursor + 1;
      cursor += 1;
    }
    return source.length;
  }

  if (character === "(") {
    let cursor = index + 1;
    let depth = 1;
    while (cursor < source.length && depth > 0) {
      const next = skipOpaque(source, cursor);
      if (next > cursor) {
        cursor = next;
        continue;
      }
      if (source[cursor] === "(") depth += 1;
      else if (source[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    return cursor;
  }

  return index;
}

/** Hands one "property: value" to `map`, carrying it back verbatim when it is not a declaration. */
function rewriteDeclaration(
  source: string,
  map: (declaration: Declaration) => string | undefined,
): string {
  const colon = topLevelColon(source);
  if (colon === -1) return source;

  // A comment may be spliced before or after the property name (`/* … */ margin: 0`), and
  // the property name is the text **with comments removed**. Without removing them,
  // `margin` becomes a string nothing will ever match, so that declaration is invisible to
  // every rewrite — no error, just a miss.
  const property = stripComments(source.slice(0, colon)).trim().toLowerCase();
  if (property === "") return source;

  const rawValue = source.slice(colon + 1);
  const important = IMPORTANT.test(rawValue);
  const value = rawValue.replace(IMPORTANT, "").trim();

  const replacement = map({ property, value, important, source });
  if (replacement === undefined) return source;

  // The leading whitespace is given to the rewritten text so the indentation does not
  // collapse — that text is the only thing visible when investigating a problem, and being
  // able to read it has real value.
  const indent = /^\s*/.exec(source)?.[0] ?? "";
  return indent + replacement;
}

/** `!important`, whitespace allowed on either side, in any case. */
const IMPORTANT = /\s*!\s*important\s*$/i;

/** Removes comments. Used only when reading a property name — output text always uses the original, and comments are kept. */
function stripComments(source: string): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "*") {
      index = skipOpaque(source, index);
      continue;
    }
    output += source[index];
    index += 1;
  }

  return output;
}

/** The first colon not inside a comment, a string or parentheses. */
function topLevelColon(source: string): number {
  let index = 0;
  while (index < source.length) {
    const skipped = skipOpaque(source, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }
    if (source[index] === ":") return index;
    index += 1;
  }
  return -1;
}

/**
 * Replaces `url(…)` in a value with the address the resolver gives.
 *
 * A book's stylesheets reference images and fonts by relative path, and frond serves
 * content as `blob:` (ADR-0006) — `blob:` has no directory structure, so every relative
 * path fails to resolve. This is not intervening in the book's declaration, it is
 * expressing the same reference in a different notation.
 *
 * When `resolve` returns `undefined` the original is left verbatim: that is usually a
 * `data:` URI or an absolute address pointing outside the book, and neither needs changing.
 *
 * The traversal is separate from `scan`, because what it looks at is parentheses inside a
 * value rather than declaration boundaries — an `@import`'s `url()` is not inside any
 * declaration at all.
 */
export function rewriteUrls(
  source: string,
  resolve: (reference: string) => string | undefined,
): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = skipOpaque(source, index);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    const match = URL_FUNCTION.exec(source.slice(index));
    if (match === null || match.index !== 0) {
      output += source[index];
      index += 1;
      continue;
    }

    const closing = skipOpaque(source, index + match[0].length - 1);
    const inside = source.slice(index + match[0].length, closing - 1);
    const reference = unquote(inside.trim());
    const resolved = reference === "" ? undefined : resolve(reference);

    output +=
      resolved === undefined
        ? source.slice(index, closing)
        : `url("${resolved.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
    index = closing;
  }

  return output;
}

/** `url(` — in any case, with no whitespace allowed between `url` and `(` (a CSS rule). */
const URL_FUNCTION = /^url\(/i;

function unquote(text: string): string {
  const first = text[0];
  if ((first === '"' || first === "'") && text.endsWith(first) && text.length >= 2) {
    return text.slice(1, -1);
  }
  return text;
}
