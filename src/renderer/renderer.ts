/**
 * `Renderer` — the upper half of ADR-0005's two-layer split: the layer that needs the
 * DOM.
 *
 * Its shape is "**a plain class taking a container element**" rather than a custom
 * element, for the reason given in ADR-0005: `CustomEvent.detail` is `any` in TypeScript,
 * and "not having to guess fields against an `any`" is half the reason this project
 * exists.
 *
 * ## What it answers and what it does not
 *
 * frond owns the facts, the consumer owns the policy (ADR-0002). This class answers "what
 * does this book look like in this viewport, and where are we now" — the writing mode, the
 * page count, the current position's CFI and fraction, the rectangles a range occupies. It
 * **does not consume gestures**: `next()` and `previous()` are actions rather than event
 * handlers, and the decision that "swiping left means next page" belongs to the consumer.
 * The fact that a book is `rtl` comes from
 * `EpubBook.metadata.pageProgressionDirection`, not from this layer.
 */

import { parseCfi, serializeCfi, type Cfi } from "../epub/cfi.ts";
import { resolveHref } from "../epub/resource-path.ts";
import type { RenderableBook } from "./book.ts";
import { cfiForRange, rangeForCfi, sectionIndexOf, spineSegment } from "./cfi-dom.ts";
import {
  buildSectionDocument,
  ResourceUrls,
  SectionParseError,
} from "./document-source.ts";
import {
  Emitter,
  type RenderLocation,
  type RendererEvents,
  type Unsubscribe,
} from "./events.ts";
import type { WritingMode } from "./geometry.ts";
import { ProgressIndex } from "./progress.ts";
import { SectionView } from "./section-view.ts";
import {
  DEFAULT_SETTINGS,
  withSettings,
  type ReaderSettings,
} from "./settings.ts";
import { charactersBefore, countCharacters, positionAtCharacter, textNodesIn } from "./text-index.ts";

/** Where a whole-book progress value falls in the book. The product of `locate()`. */
export interface SectionAt {
  readonly sectionIndex: number;
  /** This section's path inside the archive — the same value as `TocItem.target.path`. */
  readonly sectionPath: string;
  /** Which character, counting from the start of this section. */
  readonly charactersIntoSection: number;
}

/** Where within a section to jump to. */
export type SectionAnchor =
  | { readonly kind: "first-page" }
  | { readonly kind: "last-page" }
  | { readonly kind: "fragment"; readonly id: string }
  | { readonly kind: "cfi"; readonly cfi: Cfi }
  | { readonly kind: "characters"; readonly characters: number };

/**
 * Where in the first section to render.
 *
 * ## Why there is no `{ fraction }`
 *
 * A fraction cannot be computed without the whole-book index, and the index is built in
 * the background after `attach()` (user story 25). So `start: { fraction }` has only two
 * possible implementations, and both are worse than not offering it: wait for the index
 * before rendering the first page (the reader waits for the whole book to be scanned
 * before seeing a word), or render section 0 first and then jump (the very route this
 * field exists to avoid, saving not one mount).
 *
 * The progress a consumer stores is a CFI to begin with — that is exactly why CFI exists —
 * so `{ cfi }` is enough.
 */
export type RendererStart =
  | { readonly cfi: string }
  | { readonly sectionIndex: number; readonly fragment?: string };

export interface RendererOptions {
  readonly settings?: Partial<ReaderSettings>;
  /**
   * Listeners attached **before** the first section renders.
   *
   * By the time `attach()` returns the first section has already laid out, which means
   * that run's `load` and `relocate` were emitted inside `attach()` — attaching with
   * `on()` afterwards misses both. A consumer therefore has two options: read
   * `renderer.location` for the initial state (synchronous, readable at any time), or
   * attach listeners here and receive the complete event sequence.
   *
   * This field exists rather than deferring the initial events, because deferring would
   * put "the order events arrive in" out of step with "the order state actually changed
   * in", and that is the hardest kind of bug to trace.
   */
  readonly on?: RendererListeners;
  /**
   * Where in the first section to render. Omitted, it is the first page of section 0.
   *
   * This field exists rather than having the consumer call `goToCfi()` after `attach()`,
   * and what it saves is **one whole `SectionView` mount** — building the iframe, awaiting
   * `document.fonts.ready`, measuring the page count. Not one reflow. Restoring the
   * reading position happens every time a book is opened, so that wasted work would be
   * paid every time.
   *
   * An unresolvable CFI or an out-of-range `sectionIndex` falls back to the first page of
   * section 0 rather than throwing: a new edition of the book, or progress from a
   * different reader, both arrive here, and the response to them is not to interrupt
   * opening the book.
   */
  readonly start?: RendererStart;
}

export type RendererListeners = {
  readonly [Name in keyof RendererEvents]?: (event: RendererEvents[Name]) => void;
};

export class Renderer {
  readonly book: RenderableBook;

  private readonly container: HTMLElement;
  private readonly emitter = new Emitter<RendererEvents>();
  private readonly restoreContainerStyle: () => void;
  private readonly resizeObserver: ResizeObserver | undefined;

  private currentSettings: ReaderSettings;
  private resources: ResourceUrls;
  private view: SectionView | undefined;
  private sectionIndex = 0;
  private index: ProgressIndex | undefined;
  private destroyed = false;
  /** The last position emitted, used to suppress a `relocate` that changed nothing. */
  private lastEmitted: string | undefined;
  /**
   * Which load this is. Incremented on every `loadSection` call, to recognise **the ones
   * that have gone stale**.
   *
   * It is needed because loading has to await in the middle (mounting the iframe, awaiting
   * fonts) and the consumer does not wait: while the reader drags the margin slider, the
   * `input` event fires once per step, and every step is an `applySettings`. See
   * `loadSection`.
   */
  private loadGeneration = 0;
  /**
   * The chain the enqueued operations are strung onto. See `enqueue()`.
   *
   * The `catch` is deliberate: one failure should not turn every subsequent page turn into
   * a rejected promise. The failure is still passed to the caller **that initiated it**.
   */
  private chain: Promise<void> = Promise.resolve();
  /** The most recent operation for each coalesce key. Compared on enqueue, and anything that is not the latest is skipped entirely. */
  private readonly latest = new Map<string, symbol>();

  private constructor(
    book: RenderableBook,
    container: HTMLElement,
    settings: ReaderSettings,
  ) {
    this.book = book;
    this.container = container;
    this.currentSettings = settings;
    this.resources = new ResourceUrls(book, settings);

    // The iframe is absolutely positioned (the margin comes from the inset), so the
    // container has to be its positioning reference. It is only touched while the container
    // is still static, and the original value is recorded — `destroy()` has to restore it.
    const view = container.ownerDocument.defaultView;
    const originalPosition = container.style.position;
    const originalBackground = container.style.backgroundColor;

    if (view !== null && view.getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    this.applyContainerTheme();

    this.restoreContainerStyle = () => {
      container.style.position = originalPosition;
      container.style.backgroundColor = originalBackground;
    };

    if (view !== null && typeof view.ResizeObserver === "function") {
      this.resizeObserver = new view.ResizeObserver(() => {
        void this.resize();
      });
      this.resizeObserver.observe(container);
    }
  }

  /**
   * Mounts a book on a container element and renders the first section.
   *
   * The whole-book index is **not awaited here**: it has to read through every section,
   * and what the reader wants is the first page as soon as possible. An `indexed` event is
   * emitted once the index is ready, and until then `location.fraction` is `undefined`
   * (user story 25).
   */
  static async attach(
    book: RenderableBook,
    container: HTMLElement,
    options: RendererOptions = {},
  ): Promise<Renderer> {
    const renderer = new Renderer(
      book,
      container,
      withSettings(DEFAULT_SETTINGS, options.settings ?? {}),
    );

    for (const [name, listener] of Object.entries(options.on ?? {})) {
      renderer.emitter.on(
        name as keyof RendererEvents,
        listener as (event: RendererEvents[keyof RendererEvents]) => void,
      );
    }

    const start = renderer.resolveStart(options.start);
    await renderer.loadSection(start.index, start.anchor);
    void renderer.buildIndex();

    return renderer;
  }

  /**
   * Lands `options.start` on a section and an anchor. Falls back to the first page of
   * section 0 when it cannot be recognised.
   *
   * Not enqueued — the queue is empty at this moment, and `attach()` has not returned, so
   * nobody can get in front of it.
   */
  private resolveStart(start: RendererStart | undefined): {
    readonly index: number;
    readonly anchor: SectionAnchor;
  } {
    const beginning = { index: 0, anchor: { kind: "first-page" } as const };
    if (start === undefined) return beginning;

    if ("cfi" in start) {
      const parsed = tryParse(start.cfi);
      if (parsed === undefined) return beginning;

      const index = sectionIndexOf(parsed);
      if (index === undefined || index >= this.book.readingOrder.length) return beginning;

      return { index, anchor: { kind: "cfi", cfi: parsed } };
    }

    const { sectionIndex, fragment } = start;
    if (sectionIndex < 0 || sectionIndex >= this.book.readingOrder.length) return beginning;

    return {
      index: sectionIndex,
      anchor:
        fragment === undefined ? { kind: "first-page" } : { kind: "fragment", id: fragment },
    };
  }

  get settings(): ReaderSettings {
    return this.currentSettings;
  }

  /** The writing mode the current section laid out in. **Sections of one book are not guaranteed to agree.** */
  get writingMode(): WritingMode {
    return this.view?.writingMode ?? "horizontal-tb";
  }

  get location(): RenderLocation {
    return this.describeLocation();
  }

  on<Name extends keyof RendererEvents>(
    name: Name,
    listener: (event: RendererEvents[Name]) => void,
  ): Unsubscribe {
    return this.emitter.on(name, listener);
  }

  /**
   * Turns forward one page, **continuing automatically into the next section** at the end
   * of this one (user story 28).
   *
   * At the end of the book it does nothing — it neither throws nor wraps back to the first
   * page. `location.atEnd` is the fact the consumer should be looking at.
   */
  async next(): Promise<void> {
    return this.enqueue(async () => {
      const view = this.view;
      if (view === undefined) return;

      if (view.page + 1 < view.pageCount) {
        view.goToPage(view.page + 1);
        this.emitRelocate();
        return;
      }

      if (this.sectionIndex + 1 >= this.book.readingOrder.length) return;
      await this.loadSection(this.sectionIndex + 1, { kind: "first-page" });
    });
  }

  /** Turns back one page, continuing to **the last page of the previous section** past the start of this one. */
  async previous(): Promise<void> {
    return this.enqueue(async () => {
      const view = this.view;
      if (view === undefined) return;

      if (view.page > 0) {
        view.goToPage(view.page - 1);
        this.emitRelocate();
        return;
      }

      if (this.sectionIndex === 0) return;
      await this.loadSection(this.sectionIndex - 1, { kind: "last-page" });
    });
  }

  async goToSection(index: number, anchor: SectionAnchor = { kind: "first-page" }): Promise<void> {
    if (index < 0 || index >= this.book.readingOrder.length) return;
    return this.enqueue(() => this.loadSection(index, anchor));
  }

  /**
   * Jumps to the position a TOC entry points at (user story 26).
   *
   * It takes a resolved path rather than a verbatim href — `TocItem.target` gives exactly
   * this shape, and href normalization (`%2c`, `../`) is already done at the `EpubBook`
   * layer. Making Renderer resolve the href again would mean implementing the same
   * normalization a second time, and that is precisely spine's original sin (ADR-0002).
   */
  async goTo(target: { readonly path: string; readonly fragment?: string | undefined }): Promise<void> {
    const index = this.book.readingOrder.findIndex(
      (section) => section.path === target.path,
    );
    if (index === -1) return;

    return this.enqueue(() =>
      this.loadSection(
        index,
        target.fragment === undefined
          ? { kind: "first-page" }
          : { kind: "fragment", id: target.fragment },
      ),
    );
  }

  /** Jumps to a CFI (user story 20). An unrecognisable CFI does nothing. */
  async goToCfi(cfi: string | Cfi): Promise<void> {
    const parsed = typeof cfi === "string" ? tryParse(cfi) : cfi;
    if (parsed === undefined) return;

    const index = sectionIndexOf(parsed);
    if (index === undefined || index >= this.book.readingOrder.length) return;

    return this.enqueue(() => this.loadSection(index, { kind: "cfi", cfi: parsed }));
  }

  /**
   * Jumps to a whole-book progress value (user story 24).
   *
   * Does nothing before the index is built — at that point `location.fraction` is
   * `undefined` too, and the position slider should be disabled anyway.
   */
  async goToFraction(fraction: number): Promise<void> {
    const at = this.locate(fraction);
    if (at === undefined) return;

    return this.enqueue(() =>
      this.loadSection(at.sectionIndex, {
        kind: "characters",
        characters: Math.round(at.charactersIntoSection),
      }),
    );
  }

  /**
   * Which section a whole-book progress value falls in — **without jumping there** (user
   * story 23).
   *
   * While a position slider is being dragged, the chapter title at the landing point has
   * to be shown, and that is a query: the reader has not let go yet, and the screen should
   * not move. `goToFraction()` is the same query plus navigation, and both share this
   * function.
   *
   * `undefined` before the index is built — the same timing as `location.fraction`, and a
   * position slider should be disabled until then anyway.
   *
   * `sectionPath` is given alongside: a consumer maps the TOC back to sections by path
   * (`TocItem.target.path`), and giving only an index would force it to look up
   * `readingOrder` again itself.
   */
  locate(fraction: number): SectionAt | undefined {
    const index = this.index;
    if (index === undefined) return undefined;

    const { sectionIndex, charactersIntoSection } = index.locate(fraction);
    return {
      sectionIndex,
      sectionPath: this.book.readingOrder[sectionIndex]?.path ?? "",
      charactersIntoSection,
    };
  }

  /**
   * Changes the reader settings while staying on the same stretch of text (user stories 19
   * and 46).
   *
   * **The whole section is rebuilt.** The reason is that the interventions themselves are
   * written into the text: removing the book's `!important` and converting absolute font
   * sizes to `rem` (`css.ts`) both happen while the document is still a string, and cannot
   * be applied to an already-parsed DOM. So changing settings necessarily means starting
   * over, and the position is carried back by a CFI — which is exactly why CFI exists, and
   * exactly the behaviour user story 19 asks for.
   */
  async applySettings(patch: Partial<ReaderSettings>): Promise<void> {
    // **The settings themselves apply synchronously; only the rebuild is enqueued.**
    // Settings are cumulative (each call changes only the fields it mentions) while a
    // rebuild is replacing (only the last one counts). Deferring both into the queue
    // together would mean the calls superseded by later ones never even get their patch
    // applied — a reader adjusting the font size and then the margin would silently lose
    // the font size.
    this.currentSettings = withSettings(this.currentSettings, patch);
    this.applyContainerTheme();

    const previousResources = this.resources;
    this.resources = new ResourceUrls(this.book, this.currentSettings);

    await this.enqueue(async () => {
      const cfi = this.currentCfi();
      await this.loadSection(
        this.sectionIndex,
        cfi === undefined ? { kind: "first-page" } : { kind: "cfi", cfi },
      );
    }, "settings");

    // The old addresses are only revoked once the new document is mounted — revoking them
    // early would leave images missing for the instant the settings change.
    previousResources.release();
  }

  /**
   * Re-lays out after the container size changed, staying where the reader was (user story
   * 32).
   *
   * Unlike a settings change, this **does not rebuild the document**: the layout parameters
   * only change the injected stylesheet, and the DOM is untouched. So the position is
   * carried across with a `Range` directly, without even the CFI string round trip — one
   * fewer round trip is one fewer set of edge cases that can fail to line up.
   */
  async resize(): Promise<void> {
    // The coalesce key is kept separate from `applySettings`: when a window drag and a font
    // size slider drag happen at once, each should keep its own last call rather than the
    // two cancelling each other.
    return this.enqueue(() => {
      const view = this.view;
      if (view === undefined || this.destroyed) return Promise.resolve();

      const anchor = view.positionAtPageStart(view.page);
      view.relayout(this.currentSettings);

      if (anchor !== undefined) view.goToPage(view.pageOf(view.rangeAt(anchor)));

      // **This is the route that used to be silent.** No document is rebuilt, so there is no
      // `load`; and staying on the same page of the same CFI means `relocate` is swallowed by
      // its own de-duplication — which is correct, the position really did not move. But every
      // rectangle did, and this is the event that says so.
      this.emitLayout(view);
      this.emitRelocate();
      return Promise.resolve();
    }, "resize");
  }

  /**
   * The rectangles a CFI occupies on screen (user stories 49 and 51).
   *
   * frond supplies only the geometry — colour, style and animation are the consumer's
   * decision (ADR-0002).
   *
   * ## The coordinate system
   *
   * Relative to **the container element's top-left corner**, in CSS pixels, with the
   * reader's margin already added back (the iframe is inset within the container). That is
   * the same system `RendererPointerEvent`'s `x`/`y` are in, so a rectangle and a tap can be
   * compared directly, and an overlay positioned on the container can use these numbers
   * verbatim.
   *
   * ## Positions that are not on screen
   *
   * There are two cases and they answer differently:
   *
   * - **Not in the current section** — an empty array. Nothing is laid out, so there is no
   *   geometry to report.
   * - **In this section but not on the current page** — real rectangles **outside the
   *   container**. Pages are made by scrolling one long multi-column layout, so a position
   *   two pages ahead is simply at a large coordinate (measured: at a container width of
   *   600, a position on page 1 comes back at `x = 632`), and a position behind is negative.
   *
   * The second case is deliberate: which rectangles to draw is a clipping policy and belongs
   * to the consumer (ADR-0002), while reporting the true geometry is the fact frond owns.
   * A consumer that draws them unconditionally paints its highlight outside the page, so the
   * comparison against the container's own size is its job — `location.page` or the
   * container's bounds both serve.
   *
   * These numbers go stale on every layout pass. **`layout` is the event that says so.**
   */
  rectsFor(cfi: string | Cfi): readonly DOMRect[] {
    const view = this.view;
    if (view === undefined) return [];

    const parsed = typeof cfi === "string" ? tryParse(cfi) : cfi;
    if (parsed === undefined) return [];
    if (sectionIndexOf(parsed) !== this.sectionIndex) return [];

    const range = rangeForCfi(view.document, parsed);
    return range === undefined ? [] : view.rectsFor(range);
  }

  /**
   * Drops whatever is selected in the section on screen. A no-op when nothing is selected.
   *
   * ## Why a renderer needs this at all
   *
   * The selection lives in the iframe's document, which is frond's alone — a consumer holds
   * the container, and `container.ownerDocument.getSelection()` answers about the outer page,
   * not about the book. So without this the consumer has no way to undo a selection it did
   * not want, short of reaching into the iframe behind frond's back.
   *
   * And it does have selections it does not want: **phone browsers select a word on a plain
   * tap**, with no long press involved. Chrome for Android's Touch to Search does it, and the
   * selection it makes is a real one — `selectionchange` fires, and `selection` is emitted
   * with a CFI and rectangles, indistinguishable from a reader deliberately choosing a word.
   * Telling the two apart is a policy question (how long the press lasted, where it landed),
   * so the decision stays with the consumer (ADR-0002); what frond owes it is the ability to
   * act on that decision.
   *
   * Clearing raises `selectionchange`, so a `selection` event with an empty `text` follows —
   * the same event any other collapse produces.
   */
  clearSelection(): void {
    this.view?.clearSelection();
  }

  destroy(): void {
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.view?.destroy();
    this.view = undefined;
    this.resources.release();
    this.restoreContainerStyle();
    this.emitter.clear();
  }

  // --- internals ------------------------------------------------------------

  /**
   * Puts an operation onto the sequence.
   *
   * ## Why there is a queue
   *
   * Cross-section operations await in the middle (mounting the iframe, awaiting fonts) and
   * the consumer does not wait. On two rapid "next page" presses at the end of a section,
   * the second one sees a `this.view` that is still the old one with `page` still on the
   * last page, and so loads **the same section** again — `loadGeneration` makes the first
   * clean itself up, and the net result is that two inputs advance one section. Swipe
   * paging is far faster than key presses, so this case is the norm once pointer events are
   * wired in.
   *
   * Once on the sequence, every operation **reads `this.view` when its turn comes**, sees
   * the latest state, and "N presses advance N pages" holds.
   *
   * ## Why there are two enqueue semantics
   *
   * | | Which | Rule |
   * | --- | --- | --- |
   * | Cumulative (no `coalesceKey`) | page turns and jumps | every one should take effect |
   * | Replacing (with `coalesceKey`) | `applySettings`, `resize` | only the last one counts |
   *
   * Making everything cumulative is wrong: while the reader drags the margin slider,
   * `input` fires an `applySettings` per step, and running every step serially multiplies
   * the total latency by N and freezes the slider. ResizeObserver is worse still — one
   * window drag fires dozens. What those two want is "only the last one counts", and that
   * is what `coalesceKey` expresses.
   *
   * The superseded calls **still resolve** (rather than rejecting): what the caller wants is
   * "this setting took effect", and after coalescing, the latest one taking effect means
   * their intent was achieved.
   *
   * `loadGeneration` is not superseded by this — it guards a third thing: a load that lands
   * after `destroy()`.
   */
  private enqueue(work: () => Promise<void>, coalesceKey?: string): Promise<void> {
    let token: symbol | undefined;
    if (coalesceKey !== undefined) {
      token = Symbol(coalesceKey);
      this.latest.set(coalesceKey, token);
    }

    const run = this.chain.then(async () => {
      if (this.destroyed) return;
      if (coalesceKey !== undefined && this.latest.get(coalesceKey) !== token) return;
      await work();
    });

    this.chain = run.then(
      () => undefined,
      () => undefined,
    );

    return run;
  }

  /**
   * The reader's background colour has to be painted on the container too, not only inside
   * the document.
   *
   * The margin is made by insetting the iframe within the container (`section-view.ts`), so
   * that band is **not inside the document** — painting only the document would leave a ring
   * of the consuming page's background around the text in dark mode. Measured, it is a white
   * frame (`docs/evidence/32/`).
   *
   * With no theme the container is left alone: at that point the consumer's own background
   * is the right answer.
   */
  private applyContainerTheme(): void {
    const theme = this.currentSettings.theme;
    this.container.style.backgroundColor = theme === undefined ? "" : theme.background;
  }

  /**
   * Mounts a section and tears down the previous one.
   *
   * ## What has to be torn down is "the one on screen now", not "the one I saw when I started"
   *
   * There are awaits in the middle (mounting the iframe, awaiting `document.fonts.ready`),
   * and **the consumer does not wait**: while the reader drags the margin slider, `input`
   * fires once per step, and every step is an `applySettings`, hence a `loadSection`. So
   * several loads are in flight at once.
   *
   * Recording `this.view` as "the one to tear down" **before** the await would record the
   * same old view in all of them: the first to complete writes back to `this.view`, a later
   * one overwrites it, and the one that was overwritten **is torn down by nobody** — its
   * iframe is still attached to the container. The iframes are absolutely positioned with
   * transparent backgrounds, so the leftovers show around the edges of the current one, and
   * the reader sees "other content from the book stacked underneath while dragging the
   * margin". Measured, six steps of dragging leave six iframes in the container.
   *
   * So: read `this.view` only after the await, and first confirm this is still the latest
   * load — if it is not, tear down what was just mounted and leave, letting the winner take
   * over.
   */
  private async loadSection(index: number, anchor: SectionAnchor): Promise<void> {
    if (this.destroyed) return;

    const section = this.book.readingOrder[index];
    if (section === undefined) return;

    const generation = (this.loadGeneration += 1);
    let view: SectionView;

    try {
      view = await SectionView.mount(
        this.container,
        buildSectionDocument(this.book, section.path, this.currentSettings, this.resources),
        this.currentSettings,
        {
          onLinkActivate: (href) => this.emitLinkActivate(href),
          onSelectionChange: () => this.emitSelection(),
          onPointer: (kind, event) => this.emitter.emit(kind, event),
          onKey: (kind, event) => this.emitter.emit(kind, event),
        },
        section.path,
      );
    } catch (error) {
      this.emitter.emit("error", {
        sectionIndex: index,
        sectionPath: section.path,
        reason:
          error instanceof SectionParseError
            ? "malformed-content-document"
            : "unreadable-section",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    // A stale load cleans itself up: either `destroy()` has already run, or another load has
    // come along since.
    if (this.destroyed || generation !== this.loadGeneration) {
      view.destroy();
      return;
    }

    this.view?.destroy();
    this.view = view;
    this.sectionIndex = index;

    this.emitter.emit("load", {
      sectionIndex: index,
      sectionPath: section.path,
      writingMode: view.writingMode,
    });

    this.applyAnchor(view, anchor);
    // After the anchor, not before: the page the anchor lands on decides what is scrolled
    // into view, and therefore what `rectsFor()` answers. A consumer recomputing its
    // highlight layer on this event would otherwise measure the geometry of page 0.
    this.emitLayout(view);
    this.emitRelocate();
  }

  private applyAnchor(view: SectionView, anchor: SectionAnchor): void {
    switch (anchor.kind) {
      case "first-page":
        view.goToPage(0);
        return;

      case "last-page":
        view.goToPage(view.pageCount - 1);
        return;

      case "fragment": {
        const target = view.elementById(anchor.id);
        // An anchor that points at nothing stops at the start of this section. A TOC
        // pointing at a non-existent id is a shape real books have, and turning it into an
        // error would break tapping the table of contents entirely.
        view.goToPage(target === null ? 0 : view.pageOf(view.rangeOfNode(target)));
        return;
      }

      case "cfi": {
        const range = rangeForCfi(view.document, anchor.cfi);
        // If it will not walk, stop at the start of this section. A new edition of the
        // book, or a CFI from a different reader, both arrive here, and the response to
        // them is not to throw and interrupt the reading flow.
        view.goToPage(range === undefined ? 0 : view.pageOf(range));
        return;
      }

      case "characters": {
        const position = positionAtCharacter(textNodesIn(view.document), anchor.characters);
        view.goToPage(position === undefined ? 0 : view.pageOf(view.rangeAt(position)));
        return;
      }
    }
  }

  /**
   * The whole-book index: read every section once and count characters.
   *
   * Done one section at a time, yielding the thread in between — parsing a 300-section book
   * in one go would freeze the first page, and the first page is already on screen with the
   * reader reading it.
   */
  private async buildIndex(): Promise<void> {
    const counts: number[] = [];
    const parser = new DOMParser();
    const decoder = new TextDecoder();

    for (const section of this.book.readingOrder) {
      if (this.destroyed) return;

      let characters = 0;
      try {
        const parsed = parser.parseFromString(
          decoder.decode(this.book.bytes(section.path)),
          "application/xhtml+xml",
        );
        // A section that will not parse counts as 0 characters. It will be an error event on
        // screen too, and letting one broken section keep the whole index from being built
        // would cost the position slider for the entire book.
        characters = parsed.querySelector("parsererror") === null
          ? countCharacters(parsed)
          : 0;
      } catch {
        characters = 0;
      }

      counts.push(characters);
      await yieldToBrowser();
    }

    if (this.destroyed) return;

    this.index = ProgressIndex.of(counts);
    this.emitter.emit("indexed", { characters: this.index.characters });
    this.emitRelocate();
  }

  private currentCfi(): Cfi | undefined {
    const view = this.view;
    if (view === undefined) return undefined;

    const position = view.positionAtPageStart(view.page);
    if (position === undefined) {
      // A section with not a single character (all images). A CFI pointing at the whole
      // section is still a valid position.
      return { kind: "point", path: [spineSegment(this.sectionIndex)] };
    }

    return cfiForRange(view.rangeAt(position), this.sectionIndex);
  }

  private describeLocation(): RenderLocation {
    const view = this.view;
    const section = this.book.readingOrder[this.sectionIndex];
    const cfi = this.currentCfi();

    return {
      sectionIndex: this.sectionIndex,
      sectionPath: section?.path ?? "",
      page: view?.page ?? 0,
      pageCount: view?.pageCount ?? 1,
      cfi: cfi === undefined ? "" : serializeCfi(cfi),
      fraction: this.currentFraction(),
      atStart: this.sectionIndex === 0 && (view?.page ?? 0) === 0,
      atEnd:
        this.sectionIndex === this.book.readingOrder.length - 1 &&
        (view?.page ?? 0) === (view?.pageCount ?? 1) - 1,
    };
  }

  private currentFraction(): number | undefined {
    const index = this.index;
    const view = this.view;
    if (index === undefined || view === undefined) return undefined;

    const position = view.positionAtPageStart(view.page);
    if (position === undefined) return index.fractionAt(this.sectionIndex, 0);

    return index.fractionAt(
      this.sectionIndex,
      charactersBefore(textNodesIn(view.document), position.node, position.offset),
    );
  }

  /**
   * "The geometry is valid again, recompute."
   *
   * **Deliberately not de-duplicated**, unlike `relocate`. The two guard different things:
   * `relocate` is a position, and repeating an unchanged position makes a consumer believe
   * the reader moved; `layout` is an invalidation, and a layout pass that happens to produce
   * the same page count still moved every rectangle. Suppressing it on "nothing looks
   * different" would silently drop exactly the case this event exists for — `applySettings({
   * margin })` on page 0 keeps the page count and moves every rectangle by the margin's
   * difference.
   */
  private emitLayout(view: SectionView): void {
    this.emitter.emit("layout", {
      writingMode: view.writingMode,
      pageCount: view.pageCount,
    });
  }

  private emitRelocate(): void {
    const location = this.describeLocation();

    // The same position is not emitted twice. Pressing "next page" again at the end of the
    // book changes nothing, and a duplicate relocate would make the consumer think the
    // position moved (syncing progress to the cloud, say).
    //
    // **The signature has to include the CFI.** Without it, a reflow that leaves the page
    // number unchanged while the position really did change (a different viewport fitting
    // different content on the same page) would be swallowed as unchanged — and that is
    // exactly the event the consumer most needs to receive: what gets stored as progress is
    // the CFI, not the page number.
    const signature = [
      location.sectionIndex,
      location.page,
      location.fraction ?? "",
      location.cfi,
    ].join(":");
    if (signature === this.lastEmitted) return;
    this.lastEmitted = signature;

    this.emitter.emit("relocate", location);
  }

  private emitLinkActivate(href: string): void {
    const section = this.book.readingOrder[this.sectionIndex];
    const resolved = resolveHref(href, section?.path ?? "");

    if (resolved.kind === "remote") {
      this.emitter.emit("linkactivate", {
        href,
        sectionIndex: undefined,
        fragment: undefined,
        externalUrl: resolved.url,
      });
      return;
    }

    if (resolved.kind === "outside-container") {
      this.emitter.emit("linkactivate", {
        href,
        sectionIndex: undefined,
        fragment: undefined,
        externalUrl: undefined,
      });
      return;
    }

    const index = this.book.readingOrder.findIndex(
      (candidate) => candidate.path === resolved.path,
    );

    this.emitter.emit("linkactivate", {
      href,
      sectionIndex: index === -1 ? undefined : index,
      fragment: resolved.fragment,
      externalUrl: undefined,
    });
  }

  private emitSelection(): void {
    const view = this.view;
    if (view === undefined) return;

    const range = view.selection();
    if (range === undefined) {
      this.emitter.emit("selection", { cfi: undefined, text: "", rects: [] });
      return;
    }

    this.emitter.emit("selection", {
      cfi: serializeCfi(cfiForRange(range, this.sectionIndex)),
      text: range.toString(),
      // Measured from the live `Range` rather than from the CFI just serialized: the two
      // answer the same question, and this one has not been through a round trip.
      rects: view.rectsFor(range),
    });
  }
}

function tryParse(cfi: string): Cfi | undefined {
  try {
    return parseCfi(cfi);
  } catch {
    return undefined;
  }
}

/** Yields the thread once. `setTimeout(0)` schedules to the next task in all three. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
