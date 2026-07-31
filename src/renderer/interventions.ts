/**
 * Every intervention frond makes in a book, registered one by one — the **closed list**
 * ADR-0003 requires.
 *
 * > Every one of frond's interventions is registered in a closed list and written down,
 * > and adding one requires stating why. The danger is not on day one but on day thirty:
 * > "we already override column-width anyway, might as well nudge line-height too", and
 * > six months later nobody remembers why the book's typography differs from what its
 * > author designed.
 *
 * So this list lives in the code rather than only in the documentation:
 * `interventions.test.ts` compares **set equality**, and one entry too many or too few
 * turns it red. Documentation drifts; tests do not.
 *
 * ## Four reasons, not two
 *
 * ADR-0003's prose says "only two situations qualify", but its table of examples
 * actually uses four. Telling them apart is necessary: the first two really do
 * **override the book**, the latter two do not, and mixing them together leaves "how
 * many things has frond overridden" unanswerable.
 *
 * | Reason | Overrides the book? | Basis in ADR-0003 |
 * | --- | --- | --- |
 * | `content-unreadable` | yes | prose reason 1: overflow clipped, overlap, blank pages |
 * | `reader-blocked` | yes | prose reason 2: the book uses `!important` to override the reader's choice |
 * | `frond-own-layer` | no | first row of the example table: books never declare `column-width`; the CSS used for pagination belongs to frond to begin with |
 * | `syntax-translation` | no | the prefix row of the example table: the browser did not do what the book said, and translating the declaration does not change the book's intent |
 *
 * Only the first two need to be weighed against the threshold. The latter two are
 * "frond doing its own job" and "restating the book's meaning to a browser that did not
 * understand it".
 */

export type InterventionReason =
  /** Content cannot be read — overflow clipped, overlap, blank pages. */
  | "content-unreadable"
  /** The reader's setting is blocked by the book. */
  | "reader-blocked"
  /** CSS belonging to the pagination mechanism itself, a layer books have never declared. */
  | "frond-own-layer"
  /** The book's intent is unchanged; only the notation is swapped for one the browser recognises. */
  | "syntax-translation";

export interface Intervention {
  readonly id: string;
  /** What frond did. */
  readonly what: string;
  readonly reason: InterventionReason;
  /** Why this one clears the threshold. */
  readonly why: string;
  /** Which module implements it. */
  readonly where: string;
  /**
   * Whether it only happens when the reader has set something.
   *
   * All the `reader-blocked` entries are `true` — with no reader setting there is
   * nothing being blocked, and the threshold does not apply. This field turns that rule
   * into something assertable.
   */
  readonly onlyWhenReaderOverrides: boolean;
}

export const INTERVENTIONS: readonly Intervention[] = [
  {
    id: "multicol-pagination",
    what: "writes every declaration pagination needs onto documentElement: writing-mode (following the direction the book actually lays out in, so container and content share an axis), column-width, column-count, column-gap, column-fill, inline-size, block-size, releasing max-inline-size and max-block-size, box-sizing, overflow",
    reason: "frond-own-layer",
    why: "pagination is frond's responsibility and multi-column is its tool. Books have never declared this layer, so this is not an override (first row of ADR-0003's example table)",
    where: "src/renderer/layout.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "integer-page-geometry",
    what: "always rounds the container's inline size and the column width to whole pixels",
    reason: "frond-own-layer",
    why: "as above, these are parameters of the pagination layer. Fractional sizes let the page stride accumulate error, with the symptom of several pages stacked in one screen (spine walked into this)",
    where: "src/renderer/geometry.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "reset-root-box",
    what: "zeroes the margin, padding and border on documentElement and body, and puts body's block-size back to auto",
    reason: "frond-own-layer",
    why: "the layout margin is supplied by frond outside the iframe (the reader's margin setting), and spacing on the book's root element pushes the column boundary off screen — spine hung a MutationObserver that is never released for this",
    where: "src/renderer/layout.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "unprefix-writing-mode",
    what: "adds an unprefixed equivalent alongside -epub-/-webkit- prefixed writing-mode",
    reason: "syntax-translation",
    why: "Firefox recognises neither prefix, so a book writing only the prefixed form lays out entirely horizontally there. The book's intent is unchanged; only the syntax is (ADR-0003's example table, docs/browser-quirks.md)",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "column-break",
    what: "adds a break-* equivalent alongside page-break-*",
    reason: "syntax-translation",
    why: "the page break type has no effect in a multi-column layout, so content flows straight on where the book asked for a break. Adding column says the same intent in language a multi-column layout understands",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "vertical-punctuation",
    what: "injects font-feature-settings: \"vert\" 1 on documentElement when vertical",
    reason: "syntax-translation",
    why: "WebKit does not apply vert automatically in vertical mode, leaving the Japanese full stop at the bottom left (first entry in docs/browser-quirks.md). The other two apply it automatically, so forcing it changes nothing there. This is stating a typographic behaviour writing-mode already implies to a browser that did not follow it, not adding an effect the book never asked for — which is why it deliberately carries **no !important**, so a book declaring font-feature-settings itself still wins",
    where: "src/renderer/layout.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "cap-overflowing-boxes",
    what: "caps body and img/svg/video/table with max-inline-size and max-block-size (the block-axis side in pixels rather than a percentage), and gives img/svg/video a break-inside: avoid without !important",
    reason: "content-unreadable",
    why: "when a book hard-codes width: 800px the right half is clipped and unreadable on a small screen (ADR-0003's example table). When it fits, this rule is a no-op, so it only takes effect when the content really would be clipped. The block-axis cap has to be in pixels: `max-block-size: 100%` needs a definite containing-block size to resolve, and the `height: auto` div wrapping a plate silently turns it into a no-op (layout.ts has the measured numbers)",
    where: "src/renderer/layout.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "demote-important",
    what: "removes the book's !important on the properties the reader has overridden (in both stylesheets and style attributes)",
    reason: "reader-blocked",
    why: "an external stylesheet cannot beat an !important written in the book's style attribute — no position in the cascade wins against it. The scope is strictly limited to the properties the reader actually set (settings.ts's overriddenProperties)",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: true,
  },
  {
    id: "relativise-font-size",
    what: "converts the book's absolute font-size values to rem when the reader has set a font size",
    reason: "reader-blocked",
    why: "removing !important alone is not enough: an absolute value by itself detaches that stretch from the inheritance chain, so the reader's font size adjustment has no effect on it. Converting preserves the book's own **proportions** of font size and gives up the absolute values — an intent that conflicts directly with user story 42, which ADR-0003 has already resolved in the reader's favour",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: true,
  },
  {
    id: "reader-stylesheet",
    what: "injects the reader's font-size, font-family, line-height, color, link color and background-color, all with !important",
    reason: "reader-blocked",
    why: "ADR-0003 requires frond to provide an override surface. It covers only what the reader actually set — for an unset field not one character is injected",
    where: "src/renderer/settings.ts",
    onlyWhenReaderOverrides: true,
  },
  {
    id: "strip-scripted-content",
    what: "empties <script> in any namespace and nested browsing contexts (iframe/object/embed/frame) where they stand, leaving the element itself in place with no attributes and no children; the nested contexts are then given display: none !important, and an <iframe> an empty sandbox. on* event attributes are removed throughout",
    reason: "frond-own-layer",
    why: "ADR-0006 explicitly states that frond does not support EPUB scripted content, and that this is a security decision rather than a feature trade-off. The iframe has to carry allow-scripts for the parent to receive events at all (WebKit bug 218086), so the sandbox cannot stop scripts inside the book — this step is the only thing that can. A nested browsing context **inherits** the parent's sandbox flags, and serving content as blob: means carrying the consuming app's origin, so missing it would mean there is no defence at all. The elements are emptied rather than removed because a CFI numbers an element by its position among its siblings: removing one would shift every following sibling by two, silently pointing stored progress and annotations at different text (#65)",
    where: "src/renderer/document-source.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "resolve-generic-families",
    what: "substitutes the reader's faces for a bare font-family: serif / sans-serif in the book's stylesheets and style attributes, keeping the generic keyword as the last resort and the book's !important intact",
    reason: "reader-blocked",
    why: "ADR-0003's table used to answer this case with \"the book wins\", and that verdict stands for frond acting on its own — this entry only ever fires when the reader has said what the generics should resolve to (settings.genericFamilies). A bare `serif` names no face; it delegates the choice to the platform, and for CJK the three engines resolve that delegation to different faces (#4), some without vertical punctuation glyphs. Where the reader has expressed a preference, the delegation left open by the book is the one thing standing between them and it — every face the book actually named is left untouched",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: true,
  },
  {
    id: "blob-urls",
    what: "rewrites references to resources inside the book into blob: addresses",
    reason: "frond-own-layer",
    why: "content is served as same-origin blob: (ADR-0006), and blob: has no directory structure, so every relative path in the book fails to resolve. This expresses the same reference in a different notation, still pointing at the same resource",
    where: "src/renderer/document-source.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "unselectable-during-press",
    what: "writes user-select: none (and the -webkit- prefixed form) onto documentElement while a press the consumer asked to suppress selection for is in progress, and removes it on release",
    reason: "frond-own-layer",
    why: "turning pages by tapping is a layer books never declared, and on a phone the browser competes for the same tap: Chrome for Android selects a word out of a plain tap and raises a search bar over the book, which no page script can take back down afterwards. Unselectable text is the one page-side condition Chrome documents it as not firing on. It only happens when the consumer calls preventTextSelection() in that press's pointerdown, it lasts until the press ends, and it changes nothing about how the book is laid out or painted",
    where: "src/renderer/section-view.ts",
    onlyWhenReaderOverrides: false,
  },
];

/**
 * ## Known gaps
 *
 * Registered in this comment rather than as an exported array: no code reads it, and
 * making it data would only put the same explanation in two places.
 *
 * Each entry is "we know it is there, and we know why we are not doing it now", not a
 * to-do list. **There are two kinds of reason, and telling them apart matters**:
 *
 * - **This shape was not measured in the sample** (entries 1 and 2). Doing something
 *   about what never once appeared in those books means writing to the spec rather than
 *   to what books actually look like (CONTEXT.md's "model books"). The right handling of
 *   this kind of gap is **to wait until it is measured** — and the postscript below
 *   records the lesson from applying that criterion wrongly once.
 * - **It was measured, but how to fix it is a trade-off decision** (entry 3). This kind
 *   of gap cannot be waved away with "not measured", so it carries an extra requirement:
 *   the status quo needs a fixture and a test holding it, so that someone knows if it
 *   changes.
 *
 * 1. **Absolute font sizes inside the `font` shorthand are not converted to `rem`.** The
 *    shorthand's value has to be taken apart to know which part is the size
 *    (`font: 12px/1.4 serif`), and taking it apart wrongly corrupts the whole
 *    declaration, which is worse than not converting. `!important` can still be removed
 *    (`demote-important`'s scope covers `font`), so all that still blocks the reader is
 *    "an absolute size in a shorthand without `!important`".
 *
 * 2. **`@import`'s `layer()` and `supports()` forms are not expanded.** Both change the
 *    cascade's layering and conditions, and the way frond expands `@import` is by
 *    splicing the text into its original position (`css.ts`'s `inlineImports`) — splicing
 *    cannot reproduce layering. That `@import` is left verbatim, and so is still loaded
 *    asynchronously. Not one book in the sample has it.
 *
 * 3. **Tables taller than one column have their lower half unreadable.** This entry
 *    differs from the others: **it was measured in the sample** (3 books, 9 sections, the
 *    worst clipped by 2563px), and `cap-overflowing-boxes` is a no-op against it — CSS
 *    specifies that `max-height` is a **lower** bound rather than an upper one for
 *    `display: table`, so a table is always as long as its content. And **Firefox does not
 *    break tables across adjacent columns** (Chromium and WebKit both do), so those rows
 *    extend past the container and are clipped by `overflow: hidden`; worse, not breaking
 *    across columns means the content does not extend along the inline axis, so the
 *    **section's page count becomes 1** and everything after the table becomes unreadable
 *    too.
 *
 *    The reason for not acting is not "not measured", it is that **this is a trade-off
 *    decision rather than a bug fix**: the remaining route is to replace `display: table`,
 *    after which every row becomes a block, content flows into adjacent columns and all of
 *    it is readable, at the cost of the table's alignment disappearing entirely. Which is
 *    better for the reader — "readable but misaligned" or "aligned but half invisible" —
 *    needs an issue to decide, not a choice made in passing while fixing a bug.
 *
 *    The status quo is held by a fixture plus a test (`table-taller-than-page`,
 *    `rendering.spec.ts`'s "a table taller than one column"), and the measurements and the
 *    three-way comparison are in `docs/browser-quirks.md`. When Firefox starts breaking
 *    tables that test turns red, and this entry can be removed then — in other words this
 *    gap may well disappear without frond changing at all, and that is exactly what
 *    "holding the status quo" buys.
 *
 * ## Postscript: what used to be entries 2 and 3 are no longer gaps
 *
 * "`@import`'s string form is not parsed" and "stylesheets brought in by `@import` load
 * asynchronously" were once registered here, on the criterion "this shape was not
 * measured in the sample". **That criterion was wrong at the time** — a later rendering
 * pass over 34 real books found four (九歌112年散文選, 創業投資聖經, 原子習慣,
 * 大器可以晚成, all from the same Kadokawa/BookCreator toolchain) whose content
 * documents only `<link>` an aggregator file consisting purely of `@import` strings, so
 * the entire stylesheet disappeared and all four vertical books laid out horizontally.
 *
 * This record is kept because the lesson is not in those two lines: **"not in the sample"
 * is an assertion to go and measure, not a conclusion that can be inferred.** That
 * registration rested on an impression that "the string form is rare in EPUB", and in the
 * sample it accounts for 12%.
 *
 * ## Postscript: what used to be entry 4 is no longer a gap either
 *
 * "`strip-scripted-content` shifts the CFI index of every sibling after what it removed" was
 * registered here on a third criterion — **it was measured, and the measurement is zero**.
 * Across 34 books in circulation (1638 sections), `<script>` in `<body>` is 0/1638, and so
 * are `<iframe>` / `<object>` / `<embed>` / `<frame>` and `on*` attributes. Every `<script>`
 * that exists is in `<head>` — 33 of the 34 books, 1456 of the 1638 sections (89%), all of
 * them the same shape (the Kobo toolchain's
 * `<script type="text/javascript" src="../js/kobo.js"/>`, followed by a `id="koboSpanStyle"`
 * `<style>`), injected by the retailer rather than written by the book. Removing from
 * `<head>` shifts nothing an annotation could point at: `<head>` is `/2` and `<body>` is
 * `/4`, and `<head>` itself stays. **The sample's subject bias belongs with the number**:
 * all 34 are Traditional or Simplified Chinese trade non-fiction, and the EPUBs that
 * genuinely use scripting are fixed-layout, children's books and textbooks — none of the
 * three in the sample. So the honest reading was "zero within trade non-fiction", not "zero
 * in EPUB".
 *
 * The gap is closed: the elements are now emptied where they stand rather than removed
 * (`document-source.ts`'s `emptyInPlace`), so the node count never changes and no CFI moves.
 * The zero is why there was no rush, but it was never a reason not to — ADR-0008 makes a
 * removal-shaped intervention a CFI-level breaking change, so the price of changing it rises
 * with every position a reader stores, and zero affected books is the cheapest that price
 * ever gets (#65). **A measurement of zero says the bill has not arrived yet; it does not
 * say the bill is small.**
 */
