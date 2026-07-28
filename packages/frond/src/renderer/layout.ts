/**
 * frond's own layer of CSS — the pagination mechanism itself.
 *
 * The first row of ADR-0003's example table is about exactly this: **books never declare
 * `column-width`, multi-column is the tool frond uses for pagination, and this layer of
 * CSS belongs to frond to begin with.** So every declaration in this module carries
 * `!important` without having to be weighed against the intervention threshold — they are
 * not overriding the book, they are laying a floor the book has no opinion about.
 *
 * The one exception is `font-feature-settings`, for the reason given below.
 *
 * It produces a string rather than manipulating the CSSOM directly, so that it can be
 * tested in Node (the base layer of ADR-0009).
 */

import type { PageMetrics, WritingMode } from "./geometry.ts";

/** Which `<style>` this stylesheet hangs on. On a layout change the whole thing is replaced, never patched incrementally. */
export const LAYOUT_STYLE_ID = "frond-layout";

/** Which `<style>` the reader-settings stylesheet hangs on. */
export const READER_STYLE_ID = "frond-reader";

export function layoutStylesheet(
  metrics: PageMetrics,
  writingMode: WritingMode,
): string {
  return [
    `:root {`,
    // The pagination container's writing mode has to follow the book.
    //
    // This is not overriding the book: when the book declares `writing-mode` on `<body>`
    // (the InDesign shape), `<html>` is still horizontal — and `<html>` is frond's
    // multi-column container. With a horizontal container and vertical content, the
    // columns run along the wrong axis, and on screen that is "the characters are
    // vertical but one screen has several pages stacked in it". What is set here is the
    // direction of frond's own box, making it agree with the direction the book actually
    // lays out in.
    `  writing-mode: ${writingMode} !important;`,
    `  box-sizing: border-box !important;`,
    // The root element's spacing is zeroed. If the book leaves padding here, the column
    // boundary is pushed off screen — spine hung a MutationObserver that is never
    // released to fight this (ADR-0002). The margin the reader wants comes from insetting
    // the iframe within its container, never passing through the book's cascade.
    `  margin: 0 !important;`,
    `  padding: 0 !important;`,
    `  border: 0 !important;`,
    // The inline size is the length of one page, and it is a whole number (geometry.ts).
    // Written out rather than using 100%, because 100% would follow a fractional-DPI
    // viewport into a fraction, and the page stride would become fractional with it.
    `  inline-size: ${metrics.inlineSize}px !important;`,
    `  block-size: ${metrics.blockSize}px !important;`,
    `  max-inline-size: none !important;`,
    `  max-block-size: none !important;`,
    `  column-width: ${metrics.columnWidth}px !important;`,
    // The column count is written alongside the width. With only the width, the count is
    // derived by the browser, and at fractional sizes that derivation is not guaranteed
    // to be the one we computed.
    `  column-count: ${metrics.columnCount} !important;`,
    `  column-gap: ${metrics.columnGap}px !important;`,
    // balance (the initial value) spreads the content evenly across the columns, at which
    // point "one column equals one page" no longer holds.
    `  column-fill: auto !important;`,
    // Overflowing columns become a scrollable range, but the reader must not scroll it —
    // page turning is controlled by frond, and a reader's mouse wheel scrolling the layout
    // to a half-page position would rob every position calculation of meaning.
    `  overflow: hidden !important;`,
    `}`,
    ``,
    `:root > body {`,
    `  margin: 0 !important;`,
    `  padding: 0 !important;`,
    // When the book hard-codes `width: 800px`, the right half is clipped and unreadable on
    // a small screen (ADR-0003's example table). When it fits, this rule is a no-op — it
    // only takes effect when the content really would be clipped.
    `  max-inline-size: 100% !important;`,
    // When the book writes `height: 100%`, body stretches to the whole multi-column
    // container's height and squeezes out everything after it.
    `  block-size: auto !important;`,
    `}`,
    ``,
    // ## The block-axis cap is in pixels, not a percentage
    //
    // `max-block-size: 100%` is **almost always ineffective** on real books, and the way
    // it fails is invisible to everything. A percentage max-height needs a **definite**
    // containing-block size to resolve; when an image is wrapped in a
    // `<div class="pic">` (the most common plate notation in the sample) that wrapper is
    // `height: auto`, so this declaration is treated as `none` — an image taller than one
    // column still stretches past it, and is then clipped by `overflow: hidden`.
    //
    // Measured: the plate in 《精準敘事》 OEBPS/Text/08-2.xhtml is 1290px tall at
    // 800x600, where one column is only 552px — the reader sees the top 43%, and the
    // remaining 738px is never visible and cannot be reached by turning pages either.
    // Four books in the sample, seven sections in total, have this shape.
    //
    // In pixels there is no such problem: one column's length along the block axis is
    // `blockSize`, and that is a number frond set itself, with no wrapper to consult. The
    // inline axis keeps `100%` — percentages on that side always resolve (a containing
    // block's inline size is always definite), and what it has to align with is the
    // **column width** rather than the container width, which only `100%` can state when
    // there are two columns.
    `:root img, :root svg, :root video, :root table {`,
    `  max-inline-size: 100% !important;`,
    `  max-block-size: ${metrics.blockSize}px !important;`,
    `}`,
    ``,
    // An image sliced in half across a column boundary is one of the most jarring layout
    // breakages, and it is completely invisible to DOM assertions. This rule carries no
    // !important: when the book asks for its images to be splittable, that is the book's
    // decision.
    `:root img, :root svg, :root video {`,
    `  break-inside: avoid;`,
    `}`,
    ...(writingMode === "vertical-rl" ? verticalRules() : []),
  ].join("\n");
}

/**
 * The rules that exist only in vertical mode.
 *
 * `font-feature-settings: "vert" 1` **deliberately carries no `!important`**: it states a
 * typographic behaviour `writing-mode` already implies to a browser that did not follow it
 * (WebKit does not apply `vert` automatically in vertical mode, leaving the Japanese full
 * stop at the bottom left — the first entry in `docs/browser-quirks.md`), rather than
 * adding an effect the book never asked for. When the book declares
 * `font-feature-settings` itself, the book still wins.
 *
 * All three browsers share one rule, with no branch: measured, forcing it moves WebKit's
 * to the top right while Chromium's and Firefox's results are **byte-for-byte unchanged**.
 * A branch would need a "which browser is this" test, and that test would become something
 * nobody remembers to remove once the browser is fixed.
 */
function verticalRules(): readonly string[] {
  return [
    ``,
    `:root {`,
    `  font-feature-settings: "vert" 1;`,
    `}`,
  ];
}
