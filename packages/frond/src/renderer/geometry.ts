/**
 * The arithmetic of pagination. **This module does not touch the DOM** — its inputs are
 * measured sizes and its outputs are the column configuration and page positions.
 *
 * Lifting it into pure functions is not cosmetic; it is what gives defects like
 * "several pages stacked in one screen" something to hold them. Every cause of that
 * defect lies in the arithmetic (a column width applied to the wrong axis, fractional
 * pixels accumulating, the rounding direction of a page count), and arithmetic is the
 * most expensive and least reproducible thing to chase inside a browser — left in
 * `section-view.ts`, answering one boundary condition would mean opening three
 * browsers.
 *
 * ## Columns overflow along the inline axis, and `column-width` measures the inline size
 *
 * This is the foundation of the whole module, and it is measured in all three
 * (`tests/browser/renderer/multicol-geometry.spec.ts`):
 *
 * | Writing mode | Inline axis | `column-width` measures | Which axis pages advance along |
 * | --- | --- | --- | --- |
 * | `horizontal-tb` | horizontal | width | x |
 * | `vertical-rl` | vertical (characters run top to bottom) | **height** | **y** |
 *
 * The rule spine walked into — "a vertical column width has to equal exactly one viewer
 * height" — is the second row, but that sentence gives only the conclusion; answering
 * which number to change after the viewport changes shape takes this table.
 *
 * ## The whole-pixel discipline is applied to the container, not to the column width
 *
 * spine's patch rounds `column-width` down (`Math.floor`), whereas what actually needs
 * rounding is the **container's inline size**. The reason is that `column-width` is
 * only a suggestion in the spec: once the column count is settled, the width actually
 * used is always derived back from the container size. So with the column width rounded
 * and the container still fractional, the page stride (`stride`) is still fractional,
 * and after a few dozen page turns the accumulated error becomes two half-pages stacked
 * in one screen.
 *
 * Both are rounded here — rounding the container is the one that treats the cause, and
 * rounding the column width keeps the two numbers consistent in the single-column case.
 */

/** The book's writing mode. frond v1's vertical mode is always `vertical-rl` (CONTEXT.md). */
export type WritingMode = "horizontal-tb" | "vertical-rl";

/** Which axis pages advance along. */
export type PageAxis = "x" | "y";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** How many columns the reader wants. `"auto"` is only meaningful horizontally (ADR-0003). */
export type ColumnChoice = 1 | 2 | "auto";

/**
 * The margin around the layout.
 *
 * A scalar means all four sides equally. The object form **splits by axis according to
 * the writing mode**, not into top/right/bottom/left:
 *
 * | | Inline axis (`inline`) | Block axis (`block`) |
 * | --- | --- | --- |
 * | `horizontal-tb` | left and right | top and bottom |
 * | `vertical-rl` | **top and bottom** | **left and right** |
 *
 * Splitting by axis rather than by physical side is right because what the reader is
 * really adjusting is the **line length**. Adjusting left and right in a horizontal book
 * and top and bottom in a vertical one looks like two different things, but both are
 * "make the lines a bit shorter" — both fall on the inline axis. Expressed as physical
 * sides, the same preference would have to be written into a different field on
 * switching to a vertical book, and every consumer would have to do that conversion
 * itself (which is what spine does today:
 * `vertical ? '${m}px 16px' : '16px ${m}px'`).
 */
export type Margin = number | { readonly block: number; readonly inline: number };

/** The inset on each of the four physical sides, in px. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Landing the margin on the four physical sides.
 *
 * In vertical mode the inline axis is vertical (characters run top to bottom), so
 * `inline` supplies top and bottom — the opposite of horizontal. Getting this case
 * wrong does not raise an error; the symptom is "adjusting the margin on a vertical book
 * does not change the line length, it widens the gutter between pages".
 */
export function marginInsets(margin: Margin, writingMode: WritingMode): Insets {
  if (typeof margin === "number") {
    return { top: margin, right: margin, bottom: margin, left: margin };
  }

  const { block, inline } = margin;
  return writingMode === "vertical-rl"
    ? { top: inline, right: block, bottom: inline, left: block }
    : { top: block, right: inline, bottom: block, left: inline };
}

export interface ColumnRequest {
  readonly writingMode: WritingMode;
  /** The available layout size, with the reader's margin already subtracted. */
  readonly viewport: Viewport;
  readonly columns: 1 | 2;
  /** The column gap. It is also the invisible gutter between two adjacent pages. */
  readonly gap: number;
}

/**
 * A document's column configuration and page geometry.
 *
 * `stride` is the one quantity worth remembering here: **the distance between adjacent
 * pages along the pagination axis**. It is not equal to `inlineSize` — a `columnGap`
 * separates one column from the next, and that gutter falls between two pages where the
 * reader never sees it. Turning a page is moving the scroll position by one `stride`.
 */
export interface PageMetrics {
  readonly axis: PageAxis;
  /** The container's size along the inline axis, which is the visible length of one page. A whole number. */
  readonly inlineSize: number;
  /** The container's size along the block axis. A whole number. */
  readonly blockSize: number;
  readonly columnWidth: number;
  readonly columnGap: number;
  readonly columnCount: number;
  readonly stride: number;
}

/**
 * The tolerance for fractional pixels.
 *
 * Used when rounding the page count: the total content length is measured, and at
 * fractional DPI the last page frequently exceeds it by a fraction of a pixel, so a bare
 * `ceil` conjures an extra page out of nothing — and that page is empty.
 *
 * spine's `SCROLL_EPSILON = 4` treats the same class of ailment, but it applies to the
 * **page-turn boundary test** (`scrollTop` falls short and so never crosses a section
 * boundary). frond does not need that one: page positions are computed as whole
 * multiples of `stride`, and "have we reached the end" asks the page number rather than
 * the scroll coordinate, so that boundary never goes through a floating-point comparison
 * at all (`section-view.ts`).
 */
const SUBPIXEL_TOLERANCE = 1;

/**
 * The threshold for two columns. Narrower than this, `"auto"` gives one column — two
 * columns would leave under 20 Latin characters each, and lines that short are harder to
 * read, not easier.
 */
const TWO_COLUMN_MIN_INLINE_SIZE = 700;

export function pageAxisFor(writingMode: WritingMode): PageAxis {
  return writingMode === "vertical-rl" ? "y" : "x";
}

/** The available length along the inline axis: width when horizontal, height when vertical. */
export function inlineExtentOf(
  writingMode: WritingMode,
  viewport: Viewport,
): number {
  return writingMode === "vertical-rl" ? viewport.height : viewport.width;
}

/** The available length along the block axis — the complement of `inlineExtentOf`. */
export function blockExtentOf(
  writingMode: WritingMode,
  viewport: Viewport,
): number {
  return writingMode === "vertical-rl" ? viewport.width : viewport.height;
}

/**
 * Landing the reader's requested column count on an actual column count.
 *
 * **Vertical is always single-column**, whatever the reader asked for — ADR-0003
 * explicitly lists this as a deliberate simplifying assumption, since multi-column
 * vertical raises the complexity of the pagination geometry markedly. A reader setting
 * columns to 2 on a vertical book is not an error, it is a preference that does not
 * apply right now; it still renders single-column, without throwing.
 */
export function resolveColumns(
  writingMode: WritingMode,
  choice: ColumnChoice,
  viewport: Viewport,
): 1 | 2 {
  if (writingMode === "vertical-rl") return 1;
  if (choice !== "auto") return choice;
  return inlineExtentOf(writingMode, viewport) >= TWO_COLUMN_MIN_INLINE_SIZE
    ? 2
    : 1;
}

export function pageMetrics(request: ColumnRequest): PageMetrics {
  const { writingMode, viewport, columns, gap } = request;

  const inlineSize = Math.max(1, Math.floor(inlineExtentOf(writingMode, viewport)));
  const blockSize = Math.max(1, Math.floor(blockExtentOf(writingMode, viewport)));

  // The column width is derived back from the container, not the other way round — see
  // the file header, "the whole-pixel discipline is applied to the container".
  const columnWidth = Math.max(
    1,
    Math.floor((inlineSize - gap * (columns - 1)) / columns),
  );

  return {
    axis: pageAxisFor(writingMode),
    inlineSize,
    blockSize,
    columnWidth,
    columnGap: gap,
    columnCount: columns,
    // The next page's first column starts at `inlineSize + gap`: after a page is filled
    // there is still a column gap. The value is the same for one column and for two —
    // with two, the gutter inside the page is also gap, which brings it back to the same
    // expression.
    stride: inlineSize + gap,
  };
}

/**
 * Converting the total content length into a page count.
 *
 * @param scrollExtent the document's total length along the pagination axis (`scrollWidth` or `scrollHeight`)
 */
export function pageCountFor(metrics: PageMetrics, scrollExtent: number): number {
  return Math.max(
    1,
    Math.ceil((scrollExtent - SUBPIXEL_TOLERANCE) / metrics.stride),
  );
}

/** The scroll position of page `page` (counting from 0) along the pagination axis. */
export function pageOffsetFor(metrics: PageMetrics, page: number): number {
  return page * metrics.stride;
}

/**
 * Which page a **scroll position** falls on.
 *
 * Rounds to the nearest whole number: scroll positions are always whole multiples of
 * `stride` (frond sets them itself), it is just that at fractional DPI the browser
 * adjusts them by a fraction of a pixel. Truncating would report page 2 for "just turned
 * to page 3".
 */
export function pageAt(metrics: PageMetrics, offset: number): number {
  return Math.max(0, Math.round(offset / metrics.stride));
}

/**
 * Which page **a position inside the content** falls on.
 *
 * The difference from `pageAt` is the rounding direction, and that difference is not a
 * detail: a content position falls **anywhere within** a page, not on a whole multiple of
 * `stride`. Rounding to nearest would count the back half of a page as the next page —
 * the symptom being "jumping back to that page with a CFI lands on the following page",
 * and only when the position happens to sit late in the page, so it looks random.
 *
 * The tolerance is added in the positive direction so that a character sitting exactly at
 * the head of a page, but measured a fraction of a pixel short, counts on this page rather
 * than the previous one.
 */
export function pageContaining(metrics: PageMetrics, offset: number): number {
  return Math.max(
    0,
    Math.floor((offset + SUBPIXEL_TOLERANCE) / metrics.stride),
  );
}
