/**
 * One section's view: an iframe, plus the measurement and scrolling of the document
 * inside it.
 *
 * One iframe per section (ADR-0006). There is barely a choice here — EPUB stylesheets
 * make heavy use of global selectors such as `body`, `p` and `*`, and Shadow DOM cannot
 * hold back pollution at that level; and pagination needs a real document to carry
 * `writing-mode` and multi-column.
 *
 * ## The margin is outside the iframe, not in the book's CSS
 *
 * The reader's margin is achieved by **insetting the iframe within its container**,
 * rather than injecting padding into the book. The difference is more than an
 * implementation preference: padding on the multi-column container makes the first column
 * start at a different place from the rest, so "one page turn = one page stride" no longer
 * holds (foliate has to track an extra `contentStart` for this). Insetting the iframe
 * leaves the document entirely unaware the margin exists — the stride is a clean whole
 * number, and the book's cascade never has to fight frond over `body`'s padding (spine
 * hung a MutationObserver that is never released to fight for that one slot).
 */

import {
  marginInsets,
  pageAt,
  pageContaining,
  pageCountFor,
  pageMetrics,
  pageOffsetFor,
  resolveColumns,
  type Insets,
  type PageMetrics,
  type WritingMode,
} from "./geometry.ts";
import type { RendererKeyEvent, RendererPointerEvent } from "./events.ts";
import { LAYOUT_STYLE_ID, layoutStylesheet } from "./layout.ts";
import { isElement, isTextLike } from "./node-type.ts";
import type { ReaderSettings } from "./settings.ts";
import type { SectionDocument } from "./document-source.ts";
import { textNodesIn } from "./text-index.ts";
import { readWritingMode } from "./writing-mode.ts";

export interface SectionViewHooks {
  /** The reader activated a link in the content. frond only prevents the default; the consumer decides whether to navigate (ADR-0002). */
  readonly onLinkActivate: (href: string) => void;
  /** The selection inside the iframe changed. */
  readonly onSelectionChange: () => void;
  /** A pointer went down or up inside the iframe. Coordinates are already converted to the container's coordinate system. */
  readonly onPointer: (
    kind: "pointerdown" | "pointerup",
    event: RendererPointerEvent,
  ) => void;
  /** A key inside the iframe. The outer page receives nothing while focus is in the iframe, so it has to come out through here. */
  readonly onKey: (kind: "keydown" | "keyup", event: RendererKeyEvent) => void;
}

/**
 * The writing mode could not be read.
 *
 * This is an **explicit failure** rather than a fallback to horizontal: Firefox returns an
 * empty string when it cannot be read (`docs/browser-quirks.md`), and an implementation
 * treating the empty string as horizontal has the symptom "vertical books occasionally lay
 * out entirely horizontally".
 */
export class WritingModeUnreadableError extends Error {
  constructor(path: string) {
    super(`${path}'s writing mode could not be read — the computed style is an empty string`);
    this.name = "WritingModeUnreadableError";
  }
}

export class SectionView {
  readonly document: Document;
  readonly writingMode: WritingMode;

  private readonly frame: HTMLIFrameElement;
  private readonly source: SectionDocument;
  private readonly host: HTMLElement;
  private settings: ReaderSettings;
  private metrics: PageMetrics;
  /** The reader's margin after landing on the four physical sides. Both coordinate conversion and iframe positioning need it. */
  private insets: Insets;
  /** The text nodes flattened into document order. Measuring positions binary-searches it, so it is computed once. */
  private textNodes: readonly Text[];

  private constructor(
    frame: HTMLIFrameElement,
    source: SectionDocument,
    host: HTMLElement,
    document: Document,
    writingMode: WritingMode,
    settings: ReaderSettings,
    metrics: PageMetrics,
    insets: Insets,
  ) {
    this.frame = frame;
    this.source = source;
    this.host = host;
    this.document = document;
    this.writingMode = writingMode;
    this.settings = settings;
    this.metrics = metrics;
    this.insets = insets;
    this.textNodes = textNodesIn(document);
  }

  static async mount(
    host: HTMLElement,
    source: SectionDocument,
    settings: ReaderSettings,
    hooks: SectionViewHooks,
    path: string,
  ): Promise<SectionView> {
    const frame = host.ownerDocument.createElement("iframe");

    // `allow-scripts` is forced on us by WebKit, not because the book's scripts should run:
    // without it, WebKit does not even deliver events to listeners the parent attached to
    // contentDocument (bug 218086, reproduced in all three in #7). The book's scripts were
    // already removed while the document was still text (`document-source.ts`), so this
    // sandbox value does not let code inside the book run.
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts");
    frame.setAttribute("title", "");
    frame.style.border = "0";
    frame.style.display = "block";
    frame.style.position = "absolute";
    frame.style.background = "transparent";
    host.append(frame);

    // Size it with a symmetric margin before loading. An axis-split margin needs the
    // writing mode to map onto physical sides, and that cannot be read until the document
    // has laid out — so the real size is measured again below, after the mode is read. A
    // scalar margin computes the same both times, so that path has no second reflow.
    sizeFrame(frame, host, marginInsets(settings.margin, "horizontal-tb"));

    await new Promise<void>((resolve, reject) => {
      frame.addEventListener("load", () => resolve(), { once: true });
      frame.addEventListener(
        "error",
        () => reject(new Error(`${path}'s iframe failed to load`)),
        { once: true },
      );
      frame.src = source.url;
    });

    const document = frame.contentDocument;
    if (document === null) {
      throw new Error(`${path}'s contentDocument was unavailable after loading`);
    }

    // Measure only once the fonts have loaded. Pagination is a function of the fonts: the
    // line and page breaks measured before they arrive are provisional, and that set of
    // numbers gets written into the page count and the positions. foliate also uses this
    // in place of the unreliable `ResizeObserver` on Firefox (`docs/browser-quirks.md`
    // table 1, #3).
    await document.fonts.ready;

    const reading = readWritingMode(document);
    if (reading.kind === "unreadable") throw new WritingModeUnreadableError(path);

    // Size it once more **before** measuring geometry: `metricsFor` reads the iframe's
    // client size, and only now is it known which two sides an axis-split margin subtracts.
    const insets = marginInsets(settings.margin, reading.writingMode);
    sizeFrame(frame, host, insets);

    const view = new SectionView(
      frame,
      source,
      host,
      document,
      reading.writingMode,
      settings,
      metricsFor(frame, settings, reading.writingMode),
      insets,
    );
    view.applyLayout();
    view.attachHooks(hooks);

    return view;
  }

  /**
   * How many pages this section has.
   *
   * ## Why the scroll extent alone will not do
   *
   * The scroll extent counts **a tail consisting only of margin** as a page. Vertical mode
   * walks into this particularly easily: when the book writes `p { margin: 0 0 1em }` (the
   * norm in real books), that `margin-bottom` is a physical margin, and under `vertical-rl`
   * it falls on the **pagination axis** — so the last paragraph's bottom margin can push
   * the scroll extent into the next column, and that column has not a single character in
   * it.
   *
   * A reader turning to that page sees blank white, and "blank page" is one of the entries
   * on the closed defect list (`docs/agents/pull-requests.md`). Worse, it breaks the
   * identity of the position round trip: that page can report a page number but not a CFI
   * of its own (the nearest position is on the previous page), so "CFI → jump → CFI" does
   * not match on the last page.
   *
   * So the page count is the smaller of the two: the one from the scroll extent, and **the
   * page the content actually extends to**.
   */
  get pageCount(): number {
    const byScroll = pageCountFor(this.metrics, this.scrollExtent);
    const lastWithContent = this.lastPageWithContent();

    return lastWithContent === undefined
      ? byScroll
      : Math.max(1, Math.min(byScroll, lastWithContent + 1));
  }

  /** Which page it is currently on, counting from 0. */
  get page(): number {
    return Math.min(pageAt(this.metrics, this.scrollOffset), this.pageCount - 1);
  }

  goToPage(page: number): void {
    const clamped = Math.min(Math.max(0, page), this.pageCount - 1);
    const offset = pageOffsetFor(this.metrics, clamped);
    const root = this.document.documentElement;

    if (this.metrics.axis === "y") root.scrollTop = offset;
    else root.scrollLeft = offset;
  }

  /**
   * Re-measures after the layout changed (the container size, the reader's margin or
   * column count).
   *
   * **The document is not reloaded**: only the content of `<style id="frond-layout">`
   * changes, the DOM is untouched, and so `Range`s pointing at nodes are still valid after
   * reflow — recovering a position therefore does not have to go through a CFI string round
   * trip.
   */
  relayout(settings: ReaderSettings): void {
    this.settings = settings;
    this.insets = marginInsets(settings.margin, this.writingMode);
    sizeFrame(this.frame, this.host, this.insets);
    this.metrics = metricsFor(this.frame, settings, this.writingMode);
    this.applyLayout();
  }

  /** Where a `Range` falls along the pagination axis (with the scroll offset added back). */
  offsetOf(range: Range): number {
    const rect = firstVisibleRect(range);
    if (rect === undefined) return 0;

    return this.metrics.axis === "y"
      ? rect.top + this.document.documentElement.scrollTop
      : rect.left + this.document.documentElement.scrollLeft;
  }

  /**
   * Which page a `Range` falls on.
   *
   * This goes through `pageContaining` rather than `pageAt` — a content position falls
   * anywhere within a page, not on a whole multiple of the stride (`geometry.ts`).
   */
  pageOf(range: Range): number {
    return Math.min(
      pageContaining(this.metrics, this.offsetOf(range)),
      this.pageCount - 1,
    );
  }

  /**
   * The first character on some page.
   *
   * A binary search rather than a scan from the start: one section of the
   * `huge-single-section` book has over a thousand paragraphs, and scanning on every page
   * turn would mean measuring thousands of rectangles each time. The binary search holds
   * on the premise that **text nodes' positions along the pagination axis increase with
   * document order** — which is exactly the property of a multi-column layout.
   *
   * Returns `undefined` when nothing is found (a section with no text at all, such as the
   * one in `empty-and-image-only-sections`).
   */
  positionAtPageStart(page: number): { readonly node: Text; readonly offset: number } | undefined {
    if (this.textNodes.length === 0) return undefined;

    const target = pageOffsetFor(this.metrics, page);
    const nodeIndex = this.firstNodeAtOrAfter(target);
    const node = this.textNodes[nodeIndex];
    if (node === undefined) {
      // The target falls past the last text node: stop at its end.
      const last = this.textNodes[this.textNodes.length - 1]!;
      return { node: last, offset: last.length };
    }

    // This node may straddle the page boundary (a long paragraph), so binary-search once
    // more inside the node.
    return { node, offset: this.firstCharacterAtOrAfter(node, target) };
  }

  /**
   * Turns a position into a `Range` within this document.
   *
   * It lives here rather than letting the caller `createRange()` itself: a `Range` has to
   * be built by **this** document, and using the outer document's `createRange()` to point
   * at nodes inside the iframe throws `WrongDocumentError`. Keeping that constraint on the
   * side that owns the document means there is no second place the caller has to remember
   * it.
   */
  rangeAt(position: { readonly node: Node; readonly offset: number }): Range {
    const range = this.document.createRange();
    range.setStart(position.node, position.offset);
    range.collapse(true);
    return range;
  }

  /** A `Range` covering a whole element — the one needed when jumping to an anchor. */
  rangeOfNode(node: Node): Range {
    const range = this.document.createRange();
    range.selectNode(node);
    return range;
  }

  /** The element in this document with this id. */
  elementById(id: string): Element | null {
    return this.document.getElementById(id);
  }

  /**
   * A range's rectangles in the container's coordinate system — the geometry a consumer
   * needs to draw its own highlights (user stories 49 and 51).
   *
   * They are given **relative to the container** rather than to the iframe: the consumer
   * draws highlights on the container, and the iframe itself is offset by the margin.
   * Colour, style and animation are the consumer's decision; frond only supplies the
   * geometry (ADR-0002).
   */
  rectsFor(range: Range): readonly DOMRect[] {
    // A zero-length range goes through `measurable` (expanding by one character first)
    // rather than being asked for its own rectangles, for the same reason as when measuring
    // a position: a caret on a column boundary gets drawn at the end of the previous
    // column. It also happens to solve the case where zero-width rectangles are all
    // filtered out and the consumer receives an empty array.
    const resolved =
      measurable(range)
        .map((candidate) =>
          [...candidate.getClientRects()].filter(
            (rect) => rect.width > 0 && rect.height > 0,
          ),
        )
        .find((rects) => rects.length > 0) ?? [];

    return resolved.map(
      (rect) =>
        new DOMRect(
          rect.left + this.insets.left,
          rect.top + this.insets.top,
          rect.width,
          rect.height,
        ),
    );
  }

  /** The current selection. `undefined` when there is none, or when it is not in this document. */
  selection(): Range | undefined {
    const selection = this.document.getSelection();
    if (selection === null || selection.rangeCount === 0) return undefined;

    const range = selection.getRangeAt(0);
    return range.collapsed ? undefined : range;
  }

  /** Drops the selection in this document. Raises `selectionchange` when there was one. */
  clearSelection(): void {
    this.document.getSelection()?.removeAllRanges();
  }

  destroy(): void {
    this.frame.remove();
    this.source.release();
  }

  /**
   * Which page the content actually extends to. Returns `undefined` for a section with
   * neither a character nor an image.
   *
   * "Content" covers text and replaced elements (images, video) — looking only at text
   * would judge an image-only section such as the one in
   * `empty-and-image-only-sections` to have zero pages.
   *
   * ## The last text node in document order is not necessarily drawable
   *
   * This is an ailment measured on real books (`hidden-trailing-notes`): books putting
   * footnotes **after** the body text and hiding them with `display: none`, so the reader
   * only sees them on tapping a marker, is a very common practice; so is hiding the entire
   * `nav.xhtml`. Those nodes are the last few in document order, and not one rectangle can
   * be measured for them.
   *
   * Taking such a node as the end of the content, `getBoundingClientRect()` gives **all
   * zeros** — so `axisEndOf` computes 0, `pageContaining` computes page 0, and the whole
   * section's page count is squashed to 1. The symptom is the reader being able to read
   * only the first page of a chapter and unable to turn past it, **with no error at all**:
   * the page count looks like a perfectly normal number. The worst section in the sample
   * has 8778 drawable characters and reports 1 page for the whole book.
   *
   * So this searches backwards for the first text node **that does have a measurable
   * rectangle**, rather than taking the last one. The length of that walk is the number of
   * hidden nodes on the tail, which is zero steps for a normal book.
   */
  private lastPageWithContent(): number | undefined {
    let end: number | undefined;

    for (let index = this.textNodes.length - 1; index >= 0; index -= 1) {
      const range = this.document.createRange();
      range.selectNodeContents(this.textNodes[index]!);
      const rect = renderedRect(range);
      if (rect !== undefined) {
        end = this.axisEndOf(rect);
        break;
      }
    }

    for (const element of this.document.querySelectorAll(REPLACED_ELEMENTS)) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const candidate = this.axisEndOf(rect);
      end = end === undefined ? candidate : Math.max(end, candidate);
    }

    if (end === undefined) return undefined;

    // Subtract one pixel so that content filling a page exactly is not counted onto the
    // next page by the tolerance.
    return pageContaining(this.metrics, Math.max(0, end - 1));
  }

  /** A rectangle's far edge along the pagination axis, with the scroll offset added back. */
  private axisEndOf(rect: DOMRect): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y"
      ? rect.bottom + root.scrollTop
      : rect.right + root.scrollLeft;
  }

  private get scrollExtent(): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y" ? root.scrollHeight : root.scrollWidth;
  }

  private get scrollOffset(): number {
    const root = this.document.documentElement;
    return this.metrics.axis === "y" ? root.scrollTop : root.scrollLeft;
  }

  private applyLayout(): void {
    const style = this.document.getElementById(LAYOUT_STYLE_ID);
    if (style === null) return;
    style.textContent = layoutStylesheet(this.metrics, this.writingMode);
  }

  private attachHooks(hooks: SectionViewHooks): void {
    this.document.addEventListener("click", (event) => {
      // **`instanceof Element` must not be used.** This module runs in the outer page's
      // realm while the event's target comes from the iframe's realm — the two realms have
      // their own `Element` constructors, so `instanceof` is always false. The symptom is
      // link events never being delivered, with no error message at all, looking exactly
      // like "this listener was never attached".
      const target = event.target as Node | null;
      if (target === null) return;

      const element = isElement(target) ? target : target.parentElement;
      const anchor = element?.closest("a[href]") ?? null;
      if (anchor === null) return;

      // Preventing the default is necessary: letting the iframe navigate there would throw
      // away the whole rendering state, after which frond's document reference points at a
      // document that is no longer on screen.
      event.preventDefault();
      hooks.onLinkActivate(anchor.getAttribute("href") ?? "");
    });

    this.document.addEventListener("selectionchange", () => {
      hooks.onSelectionChange();
    });

    // Always `passive`: frond makes no decision about pointers or keys, and so has no
    // default behaviour to prevent. A non-passive touch listener makes the browser wait for
    // the listener to finish before deciding whether to scroll, every time, and that is
    // exactly why selecting text and scrolling feel sluggish on phones.
    for (const kind of ["pointerdown", "pointerup"] as const) {
      this.document.addEventListener(
        kind,
        (event) => {
          hooks.onPointer(kind, this.describePointer(event as unknown as PointerFacts));
        },
        { passive: true },
      );
    }

    for (const kind of ["keydown", "keyup"] as const) {
      this.document.addEventListener(
        kind,
        (event) => {
          hooks.onKey(kind, describeKey(event as unknown as KeyFacts));
        },
        { passive: true },
      );
    }
  }

  /**
   * A pointer event's position in the container's coordinate system, plus the two DOM
   * conditions at that instant.
   *
   * The iframe's content scrolls itself, and the iframe is only one viewport large — so the
   * event's `clientX`/`clientY` are already relative to the visible area, and **the scroll
   * offset must not be added back**. All that has to be added is how far the iframe is
   * offset within the container, which is the reader's margin. This is the same conversion
   * as `rectsFor()`, so both return the same coordinate system.
   *
   * (spine has to subtract `scrollLeft` on epub.js because the iframe there spans the whole
   * scrolled section. frond's iframe is not that shape, and copying that step would shift
   * the coordinates by a whole page.)
   */
  private describePointer(event: PointerFacts): RendererPointerEvent {
    // **`instanceof Element` must not be used** — the target comes from the iframe's realm,
    // for the same reason as the click listener above.
    const target = event.target as Node | null;
    const element = target === null ? null : isElement(target) ? target : target.parentElement;

    return {
      x: event.clientX + this.insets.left,
      y: event.clientY + this.insets.top,
      width: this.host.clientWidth,
      height: this.host.clientHeight,
      hasSelection: this.selection() !== undefined,
      isLink: (element?.closest("a[href]") ?? null) !== null,
    };
  }

  /** The index of the first text node whose end is at or after `target`. */
  private firstNodeAtOrAfter(target: number): number {
    let low = 0;
    let high = this.textNodes.length;

    while (low < high) {
      const middle = (low + high) >> 1;
      const node = this.textNodes[middle]!;
      if (this.endOffsetOfNode(node) >= target) high = middle;
      else low = middle + 1;
    }

    return low;
  }

  /** The first character in this node that falls at or after `target`. */
  private firstCharacterAtOrAfter(node: Text, target: number): number {
    let low = 0;
    let high = node.length;

    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.offsetOfCharacter(node, middle) >= target) high = middle;
      else low = middle + 1;
    }

    return Math.min(low, Math.max(0, node.length - 1));
  }

  /** Where a node's end falls along the pagination axis. */
  private endOffsetOfNode(node: Text): number {
    const range = this.document.createRange();
    range.selectNodeContents(node);
    const rect = lastVisibleRect(range);
    if (rect === undefined) return 0;

    return this.metrics.axis === "y"
      ? rect.bottom + this.document.documentElement.scrollTop
      : rect.right + this.document.documentElement.scrollLeft;
  }

  /** Where a character falls along the pagination axis. */
  private offsetOfCharacter(node: Text, offset: number): number {
    const range = this.document.createRange();
    range.setStart(node, offset);
    range.setEnd(node, Math.min(offset + 1, node.length));
    return this.offsetOf(range);
  }
}

/**
 * Insets the iframe within its container by the reader's margin.
 *
 * Positioning uses the physical `left`/`top` rather than the logical
 * `inset-inline-start`/`inset-block-start`. Those two logical properties resolve against
 * the **container's** writing mode, which is the consuming app's direction and has nothing
 * to do with the book's — when the consumer's page is rtl, `inset-inline-start` becomes the
 * right side, while `rectsFor()` adds back `rect.left`. With the two sides using different
 * frames of reference, every highlight would be displaced.
 */
function sizeFrame(frame: HTMLIFrameElement, host: HTMLElement, insets: Insets): void {
  const width = Math.max(1, Math.floor(host.clientWidth - insets.left - insets.right));
  const height = Math.max(1, Math.floor(host.clientHeight - insets.top - insets.bottom));

  frame.style.left = `${insets.left}px`;
  frame.style.top = `${insets.top}px`;
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
}

/**
 * The few fields frond reads from a pointer event.
 *
 * Written as a narrow interface rather than using `PointerEvent`: the event comes from the
 * iframe's realm, and its type is the outer realm's constructor while in fact it is not the
 * same one — reading data fields only is safe, and a narrow interface turns "reads data
 * fields only" into something the type system enforces.
 */
interface PointerFacts {
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget | null;
}

interface KeyFacts {
  readonly key: string;
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

function describeKey(event: KeyFacts): RendererKeyEvent {
  return {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    isComposing: event.isComposing,
  };
}

function metricsFor(
  frame: HTMLIFrameElement,
  settings: ReaderSettings,
  writingMode: WritingMode,
): PageMetrics {
  const viewport = {
    width: frame.clientWidth,
    height: frame.clientHeight,
  };

  return pageMetrics({
    writingMode,
    viewport,
    columns: resolveColumns(writingMode, settings.columns, viewport),
    // The column gap is also the invisible gutter between two adjacent pages, which the
    // reader never sees — so it need not be a setting, and a fixed value will do. 0 would
    // work too; a positive value is chosen so that two columns have a real separation
    // between them.
    gap: COLUMN_GAP,
  });
}

/**
 * The column gap.
 *
 * With one column it falls entirely off screen (between two pages); with two it is the
 * separator inside the page. 40px is chosen because two columns of text too close together
 * make the eye jump lines, and this value simultaneously sets the distance between two
 * pages in single-column mode — a stretch the reader never sees, so its size does not
 * affect the layout at all.
 */
const COLUMN_GAP = 40;

/**
 * Elements with content but no text. They have to count when deciding "is this page empty".
 *
 * `<iframe>` / `<object>` / `<embed>` are not included: all three were removed entirely
 * while the document was still text (`document-source.ts`'s `stripScriptedContent`), and
 * listing them here would only make a reader think they can appear.
 */
const REPLACED_ELEMENTS = "img, svg, video, canvas";

/**
 * A range's first rectangle **with any area**.
 *
 * Three measured pitfalls are all blocked by this one function (the foliate patch table in
 * `docs/browser-quirks.md`):
 *
 * - A collapsed range sometimes returns no client rect at all (table 2, #7). CFI
 *   positioning produces collapsed ranges constantly, so this case is guaranteed to come up.
 * - Firefox's `getBoundingClientRect()` misses rects with zero width and non-zero height
 *   (table 1, #5; this project's probe did not hit that precondition, so the status is
 *   unknown rather than "Firefox does not have this bug").
 * - When a range's start immediately follows a hyphen in the previous column, that column
 *   gains an extra zero-width rect (table 2, #12). Taking the first one with area skips it.
 *
 * So this always goes through `getClientRects()` and filters out the ones with no area,
 * rather than using `getBoundingClientRect()`.
 */
function firstVisibleRect(range: Range): DOMRect | undefined {
  for (const candidate of measurable(range)) {
    for (const rect of candidate.getClientRects()) {
      if (rect.width > 0 || rect.height > 0) return rect;
    }
  }
  return undefined;
}

/**
 * Which forms of a range to measure, in order.
 *
 * **A zero-length range is always expanded by one character before measuring, rather than
 * being asked for its own rectangles first.** This is not a performance consideration, it
 * is correctness: when a zero-length position falls on a column boundary, the browser draws
 * the caret at **the end of the previous column** rather than the start of this one (the
 * text caret's affinity — one position at a line break has two reasonable renderings). So
 * "the first character on this page" measures out on the previous page.
 *
 * The symptom is particularly hard to trace: it only happens when the position is exactly a
 * page break, and that is precisely the situation frond meets every time it reports a
 * position. It presents as "jumping back to that page with a CFI lands on the previous
 * page", and only on some pages.
 *
 * After expansion what is measured is that character's own box, leaving no room for
 * affinity. Only when it cannot be expanded (the end of a node, an empty node) does it fall
 * back to the original range.
 */
function measurable(range: Range): readonly Range[] {
  if (!range.collapsed) return [range];

  const expanded = uncollapse(range);
  return expanded === undefined ? [range] : [expanded, range];
}

/**
 * A range's last **actually drawn** rectangle. `undefined` when it is not drawn.
 *
 * The only difference from `lastVisibleRect` is the not-drawn case, and the two handlings
 * of that case serve two different problems, which is why they are two functions rather
 * than one flag:
 *
 * | | Asks | What it wants when unmeasurable |
 * | --- | --- | --- |
 * | `renderedRect` | how far the content extends (page count) | **`undefined`** — hidden content occupies no pages |
 * | `lastVisibleRect` | where this position is on screen (CFI) | an approximate position, see below |
 *
 * The cost of conflating them has actually been paid: the page count side receives an
 * all-zero rectangle, and the whole section is squashed to one page
 * (`lastPageWithContent`).
 */
function renderedRect(range: Range): DOMRect | undefined {
  for (const candidate of measurable(range)) {
    let found: DOMRect | undefined;
    for (const rect of candidate.getClientRects()) {
      if (rect.width > 0 || rect.height > 0) found = rect;
    }
    if (found !== undefined) return found;
  }

  return undefined;
}

function lastVisibleRect(range: Range): DOMRect | undefined {
  const rendered = renderedRect(range);
  if (rendered !== undefined) return rendered;

  // Not one rectangle can be measured. The whitespace-node case is already filtered out in
  // `text-index.ts`, so what is left is content such as `display: none` — fall back to the
  // element it sits in, so the position at least lands in the right region. Returning
  // `undefined` would give the binary search 0, and 0 holds on every page, so the search
  // would lose its direction.
  const element = range.startContainer.parentElement;
  return element?.getBoundingClientRect();
}

/** Expands a zero-length range to one character wide. Returns `undefined` when it cannot be expanded. */
function uncollapse(range: Range): Range | undefined {
  if (!range.collapsed) return undefined;

  const container = range.startContainer;
  const expanded = range.cloneRange();

  if (isTextLike(container)) {
    const length = container.nodeValue?.length ?? 0;
    if (range.startOffset < length) {
      expanded.setEnd(container, range.startOffset + 1);
      return expanded;
    }
    if (range.startOffset > 0) {
      expanded.setStart(container, range.startOffset - 1);
      return expanded;
    }
    return undefined;
  }

  expanded.selectNode(container);
  return expanded;
}
