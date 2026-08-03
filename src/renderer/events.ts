/**
 * Typed events (ADR-0005).
 *
 * The DOM's `EventTarget` is deliberately **not used**: `CustomEvent.detail` is `any` in
 * TypeScript, and "not having to guess fields against an `any`" (user story 35) is half
 * the reason this project exists. Custom elements and `CustomEvent` would throw that half
 * away, which is why ADR-0005 chose a class plus a typed emitter.
 *
 * `on()` returns an unsubscribe function rather than requiring the caller to hold onto
 * the same listener reference for an `off()`. In practice the most common way to get the
 * latter wrong is passing in a fresh arrow function to unsubscribe, and that raises no
 * error — it silently unsubscribes nothing, and listeners then accumulate with every
 * remount.
 */

import type { WritingMode } from "./geometry.ts";

/** The complete description of a position. This is what every `relocate` carries. */
export interface RenderLocation {
  readonly sectionIndex: number;
  /** This section's path inside the archive. */
  readonly sectionPath: string;
  /** Which page within this section, counting from 0. */
  readonly page: number;
  /** How many pages this section has. **Meaningful only within this section** — a whole-book page count is not a stable quantity. */
  readonly pageCount: number;
  /** The current position's CFI, already serialized as `epubcfi(…)`. */
  readonly cfi: string;
  /**
   * **What is on the screen right now**, as a range CFI covering this page from its first
   * character to its last.
   *
   * `cfi` above is a **point**: where the reader is. This is the **stretch** they can see,
   * and the two are different questions. A consumer asking "explain the passage I am looking
   * at" needs this one, and no amount of arithmetic recovers it from the point — a page is a
   * product of layout, so its extent depends on the viewport and the type size, and only the
   * renderer is holding those.
   *
   * That is also why it is worth carrying on every `relocate` rather than offering a method
   * to ask later: the extent is knowable **while this page is on screen** and not afterwards.
   * A consumer that stores it as the reader turns pages can answer the question offline, from
   * a different device, or in a Worker (which can turn the range back into text with
   * `ContentDocument`); one that means to ask later has nothing to ask.
   *
   * `undefined` for a section with no text at all — a range needs two positions, and an
   * image-only section offers none. `cfi` still falls back to a point at the whole section.
   */
  readonly pageRange: string | undefined;
  /**
   * Whole-book progress, 0 to 1. **`undefined` until the whole-book index is built**
   * (user story 25) — a position slider should be disabled until then, rather than drawn
   * with a wrong value.
   */
  readonly fraction: number | undefined;
  /** Already on the first page of the book. */
  readonly atStart: boolean;
  /** Already on the last page of the book. */
  readonly atEnd: boolean;
}

export interface SectionLoadEvent {
  readonly sectionIndex: number;
  readonly sectionPath: string;
  /**
   * The writing mode this section actually laid out in.
   *
   * **Sections of one book are not guaranteed to agree**, which is why this hangs here
   * rather than on `Renderer`. It is decided by the CSSOM rather than by string matching
   * (ADR-0010, docs/browser-quirks.md).
   */
  readonly writingMode: "horizontal-tb" | "vertical-rl";
}

/**
 * The geometry has been laid out again — **every rectangle measured before this moment is
 * stale**.
 *
 * This is the signal `rectsFor()` needs a companion for: it answers "which rectangles does
 * this range occupy", and without this event nothing answers "when do those rectangles stop
 * being true". A consumer drawing its own highlight layer subscribes to exactly one thing —
 * this — and recomputes.
 *
 * It is emitted on all three routes that change the geometry: a section finished loading,
 * `applySettings()` finished rebuilding, and `resize()` finished re-laying out. Sending it
 * on all three is the point: the consumer should not have to know which of frond's internal
 * routes it was, only that the geometry is valid again.
 *
 * **`load` is not replaced by it.** `load` answers "a new section is up" and `layout`
 * answers "the geometry is valid now"; those are two questions, and only the second one is
 * asked by a resize — `resize()` does not rebuild the document, so no `load` is emitted, and
 * a `relocate` need not be either (the reader stays on page 0 of the same CFI, and
 * `relocate`'s de-duplication correctly swallows that). Before this event existed, a resize
 * moved every rectangle and sent no signal at all.
 */
export interface LayoutEvent {
  /** The writing mode this layout ran in. */
  readonly writingMode: WritingMode;
  /** How many pages the current section now has. */
  readonly pageCount: number;
}

/** The whole-book index is built, and `fraction` has a value from this moment on. */
export interface IndexedEvent {
  /** The whole book's character count. 0 means this book has not a single character — which is not an error. */
  readonly characters: number;
}

/**
 * The reader activated a link inside the content.
 *
 * frond **does not navigate itself**: turning pages and jumping chapters are policy, and
 * the consumer decides (ADR-0002). What is given here is the fact — which section and
 * which anchor in the book that link points at. The one thing frond does itself is
 * prevent the browser's default behaviour, because letting the iframe navigate there
 * would throw away the whole rendering state.
 */
export interface LinkActivateEvent {
  /** The href, copied verbatim. */
  readonly href: string;
  /** The readingOrder index of the section it points at. `undefined` when it points outside the book. */
  readonly sectionIndex: number | undefined;
  /** The part after `#`, already decoded. */
  readonly fragment: string | undefined;
  /** The absolute address, when resolution puts it outside this book (an external link). */
  readonly externalUrl: string | undefined;
}

export interface RendererErrorEvent {
  readonly sectionIndex: number;
  readonly sectionPath: string;
  readonly reason: RendererFailure;
  readonly message: string;
}

export type RendererFailure =
  /** The content document is not well-formed XML, and the browser refuses to render it at all. */
  | "malformed-content-document"
  /** The content document's bytes cannot be taken. */
  | "unreadable-section";

/**
 * The reader's selection changed (user story 48).
 *
 * `cfi` is the CFI of a **range**, not a point — it is what an annotation stores. It is
 * `undefined` when the selection is cleared, rather than no event being sent: the
 * consumer needs that to dismiss a floating toolbar, and "no event" cannot express it.
 */
export interface SelectionEvent {
  readonly cfi: string | undefined;
  /** The selected text. An empty string when the selection is cleared. */
  readonly text: string;
  /**
   * Where the selection is on screen, in the container's coordinate system — the same
   * system as `rectsFor()` and `RendererPointerEvent`.
   *
   * A floating toolbar has to be placed against these, so this field saves the consumer a
   * round trip that computes what frond already has: it holds the `Range` at this moment,
   * and the alternative is parsing back the CFI it has just serialized and walking the DOM
   * a second time to recover the same rectangles.
   *
   * Empty when the selection is cleared. **These go stale on the next `layout`**, exactly
   * as `rectsFor()`'s do.
   */
  readonly rects: readonly DOMRect[];
}

/**
 * One pointer press or release inside the iframe.
 *
 * ## Why raw down/up rather than a gesture event carrying `dx`/`dy`
 *
 * The iframe boundary blocks bubbling, so the consumer receives no pointer event at all
 * on the container — that is a gap at the fact layer, and frond should fill it. But the
 * way to fill it cannot be "frond works out how far you swiped for you": the moment frond
 * starts pairing down with up, handling multi-touch and deciding how many pixels count as
 * a swipe, it is consuming gestures, and ADR-0002 explicitly refuses that.
 *
 * So what is sent here is two independent facts: at some moment, at some point in
 * container coordinates, a pointer went down (or up), and these two DOM conditions held
 * at that instant. "This is a leftward swipe, therefore next page" belongs to the
 * consumer.
 *
 * `linkactivate` is the precedent for the same shape: frond does not navigate itself, it
 * only says where that link points.
 *
 * ## Ordering relative to `linkactivate`
 *
 * On a press over a link, `pointerdown` → `pointerup` → `linkactivate` are sent in that
 * order. Which means that at the moment `pointerup` arrives it is not yet known whether a
 * `linkactivate` will follow — `isLink` exists for exactly this case: to let links take
 * precedence over page turns, look at it rather than waiting for the next event.
 */
export interface RendererPointerEvent {
  /**
   * The position in the container's coordinate system.
   *
   * The reader's margin offset is already added back (the iframe is inset within the
   * container), putting it in the same coordinate system as the rectangles `rectsFor()`
   * returns — the consumer's floating UI is drawn on the container, so the two can be
   * compared directly.
   */
  readonly x: number;
  readonly y: number;
  /** The container's current visible size. Tap zones need it to work out proportions. */
  readonly width: number;
  readonly height: number;
  /**
   * `PointerEvent.pointerType` — `"mouse"`, `"touch"`, `"pen"`, or whatever else the engine
   * calls the device. Passed through rather than narrowed to a union: the spec lets a device
   * report a name frond has never heard of, and a union would have to throw that away.
   *
   * A consumer needs it because the same press means different things from a finger and from
   * a mouse. Tapping the edge of a phone screen is the only way to turn the page there; the
   * identical click on a desktop competes with placing the caret and with double-click to
   * select a word — where a keyboard and on-screen buttons are available anyway.
   */
  readonly pointerType: string;
  /** There is an uncollapsed selection inside the iframe at this instant. Not turning the page mid-selection needs this. */
  readonly hasSelection: boolean;
  /** The event landed inside an `a[href]`. */
  readonly isLink: boolean;
}

/**
 * A pointer press, which carries one thing a release cannot: the press has not finished
 * yet, so what the browser will make of it is still open.
 *
 * ## Why the press needs a say at all
 *
 * A phone browser selects a word out of a plain tap on text, with no long press involved
 * — Chrome for Android's Touch to Search, which then raises a search bar over the book.
 * A reader tapping the edge to turn the page gets that bar, and no page turn is worth it.
 *
 * Undoing it afterwards does not work. The selection can be dropped through
 * `clearSelection()`, but the browser's own bar is not part of the document and no page
 * script can take it back down; by the time the consumer knows a tap happened, the bar is
 * already up. So the only moment where anything can be done is before the browser decides,
 * and this event is that moment.
 *
 * ## Why frond does not decide it
 *
 * Which presses the browser should not act on is policy: it depends on where the tap zones
 * are, on whether that consumer turns pages by tapping at all, and on the device (ADR-0002).
 * frond supplies the moment and the mechanism; the consumer supplies the "which".
 */
export interface RendererPointerDownEvent extends RendererPointerEvent {
  /**
   * Cancels the browser's own action for **this press**: the `click` it would produce, and
   * with it the tap-selects-a-word behaviour above.
   *
   * frond does that by preventing the default of the `touchend` that ends the press. Which
   * mechanism to use was decided by measurement rather than by reading the documentation.
   * Chrome names unselectable text as a condition Touch to Search does not fire on, and
   * making the document unselectable for the press only made the bar **rarer** — 21% of
   * taps raised it anyway, against 72% with nothing at all. Cancelling the touch stopped it
   * outright, 0 times in 15, on an Android phone (#80).
   *
   * Four things follow:
   *
   * - It has to be called **synchronously** in the `pointerdown` listener. Later is after
   *   the browser has already decided.
   * - **The press loses its `click`**, and frond's link handling is built on that click, so
   *   `linkactivate` does not fire for a press that asked. `isLink` says whether that is
   *   about to matter, and a consumer whose tap zones lie over body text should read it.
   * - **Only a touch has this default to cancel.** For a mouse press the call does nothing.
   * - It says nothing about any other press. The answer is carried by the finger that asked,
   *   so a second finger on the screen neither takes it nor loses its own, and each press
   *   asks again.
   *
   * Selection is left alone, deliberately: a long press still selects, and a selection
   * already in progress survives a press that asked.
   *
   * Calling it more than once during one press does nothing the first call did not.
   */
  preventTapDefault(): void;
}

/**
 * One key press inside the iframe.
 *
 * While focus is inside the iframe, the outer document's `keyup` receives nothing — which
 * is why arrow-key page turning stops working entirely once frond is wired in.
 *
 * Both `keydown` and `keyup` are sent. Only `keydown` can answer "hold the arrow key to
 * keep turning pages" for the consumer (`keyup` fires once per hold), and the same goes
 * for avoiding IME composition.
 */
export interface RendererKeyEvent {
  /** `KeyboardEvent.key` — the character or key name with modifiers and keyboard layout already applied. */
  readonly key: string;
  /** `KeyboardEvent.code` — the physical key position, independent of layout. */
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  /** IME composition in progress. Arrow keys during composition move between candidates, not pages. */
  readonly isComposing: boolean;
}

export interface RendererEvents {
  relocate: RenderLocation;
  selection: SelectionEvent;
  load: SectionLoadEvent;
  layout: LayoutEvent;
  indexed: IndexedEvent;
  linkactivate: LinkActivateEvent;
  error: RendererErrorEvent;
  pointerdown: RendererPointerDownEvent;
  pointerup: RendererPointerEvent;
  keydown: RendererKeyEvent;
  keyup: RendererKeyEvent;
}

export type Listener<Payload> = (event: Payload) => void;

/** Unsubscribes. Calling it twice is safe. */
export type Unsubscribe = () => void;

/**
 * The type parameter is bounded by `object` rather than `Record<string, unknown>`.
 *
 * The latter looks more precise but in fact shuts out every `interface`: an interface has
 * no index signature, so even `RendererEvents` itself would not pass. Working around it
 * with a type alias merely shifts the restriction onto everyone who defines events.
 */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<Name extends keyof Events>(
    name: Name,
    listener: Listener<Events[Name]>,
  ): Unsubscribe {
    const existing = this.listeners.get(name) ?? new Set<Listener<never>>();
    existing.add(listener as Listener<never>);
    this.listeners.set(name, existing);

    return () => {
      existing.delete(listener as Listener<never>);
    };
  }

  emit<Name extends keyof Events>(name: Name, event: Events[Name]): void {
    // Copy before iterating: a listener unsubscribing inside its own callback is a common
    // pattern (a one-shot listener), and mutating the same set while iterating it would
    // skip the listeners after it.
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      (listener as Listener<Events[Name]>)(event);
    }
  }

  /** Removes them all. `Renderer.destroy()` uses it, to stop events being sent after teardown. */
  clear(): void {
    this.listeners.clear();
  }
}
