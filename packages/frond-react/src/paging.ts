/**
 * The **policy** of page turning: keyboard and gestures.
 *
 * ## Which side of ADR-0002's line this file is on
 *
 * The consumer's side — and it appears in this package because ADR-0002 draws the line at
 * "frond's core does no policy", not at "policy may have no defaults". The core layer's
 * `Renderer` emits two independent facts (`pointerdown` and `pointerup`, each carrying
 * coordinates), and the inference "this is a leftward swipe, therefore next page" is made
 * here.
 *
 * So the rule is: **it only takes effect when imported explicitly**. Neither hook lives
 * inside any part, and `Root` will not quietly call them for you. A reader that does not
 * call them consumes no gestures at all, exactly like using `Renderer` directly.
 *
 * ```tsx
 * function Paging() {
 *   useKeyboardPaging();
 *   useSwipePaging();
 *   return null;
 * }
 * // <Root …><Paging /><Viewport /></Root>
 * ```
 *
 * If you disagree with the rules here, do not call them and wire `useReader()`'s `next()` /
 * `previous()` up yourself. Both hooks' implementations are short enough to copy wholesale
 * and modify — which is also why they are deliberately written plainly.
 *
 * ## Direction
 *
 * Whether swiping left is the next or the previous page depends on the page progression
 * direction, and **this layer cannot reach that fact**: it is declared in the package
 * document and reported by `EpubBook.metadata.pageProgressionDirection`, while `Renderer`
 * receives the narrow `RenderableBook` interface (ADR-0005).
 *
 * So the default is inferred from the writing mode: vertical is always treated as `rtl` and
 * everything else as `ltr`. **Horizontal RTL languages (Arabic, Hebrew) cannot be
 * inferred** — such books have to pass `direction: "rtl"` explicitly. This is written down
 * here rather than quietly guessed wrong, because the symptom of guessing wrong is "the
 * page turn direction is reversed for the whole book", and the reader will not know that is
 * a configuration problem.
 */

import { useEffect } from "react";
import { useReader } from "./context.ts";

/** The page progression direction. A different thing from the writing mode — see the file header. */
export type PagingDirection = "ltr" | "rtl";

export interface PagingOptions {
  /**
   * The page progression direction. Omitted, it is inferred from the writing mode:
   * `vertical-rl` → `rtl`, everything else → `ltr`.
   *
   * With an `EpubBook` in hand the correct source is
   * `book.metadata.pageProgressionDirection` — it is what the book declares itself, and when
   * EPUB 2 has no such attribute it reports "the book did not say", at which point falling
   * back to the inference here is right.
   */
  readonly direction?: PagingDirection | undefined;
  /** Turns it off. It is here rather than asking the consumer to call the hook conditionally — hooks cannot go inside conditions. */
  readonly enabled?: boolean | undefined;
}

export interface KeyboardPagingOptions extends PagingOptions {
  /**
   * Whether to receive the whole document's keys as well as the ones inside the iframe.
   *
   * On by default. When focus is on a toolbar button, keys never reach the iframe at all,
   * and a reader will not accept "I just clicked that button" as a reason for page turning
   * to stop working.
   */
  readonly global?: boolean | undefined;
}

export interface SwipePagingOptions extends PagingOptions {
  /** How many px of movement counts as a page turn. Anything shorter is treated as a tap and does nothing. */
  readonly threshold?: number | undefined;
}

/** The shape keys have in common — both the iframe's `RendererKeyEvent` and the native `KeyboardEvent` fit. */
interface KeyLike {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

/**
 * Keyboard page turning.
 *
 * The keys bound:
 *
 *   - **Next page**: `PageDown`, `Space`, `ArrowDown`, and the horizontal arrow that
 *     advances along the reading direction (`ArrowRight` for `ltr`, `ArrowLeft` for `rtl`)
 *   - **Previous page**: `PageUp`, `ArrowUp`, and the horizontal arrow in the opposite
 *     direction
 *
 * `ArrowDown` / `ArrowUp` look inconsistent with the visual direction in a vertical book
 * (vertical pages move left and right), but they keep meaning "next page / previous page"
 * under both writing modes — that is what those two keys mean in every scrolling interface,
 * and what the reader's fingers remember is that meaning, not the layout direction.
 */
export function useKeyboardPaging(options: KeyboardPagingOptions = {}): void {
  const { renderer, next, previous, writingMode } = useReader();
  const { enabled = true, global = true } = options;
  const direction = options.direction ?? (writingMode === "vertical-rl" ? "rtl" : "ltr");

  useEffect(() => {
    if (!enabled || renderer === undefined) return;

    const forwardArrow = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backwardArrow = direction === "rtl" ? "ArrowRight" : "ArrowLeft";

    const act = (event: KeyLike): boolean => {
      // Modifier combinations are always let through. `Cmd+ArrowRight` is a system gesture
      // like "jump to end of line", and intercepting it only makes people think the browser
      // is broken. The same goes for IME composition (`isComposing`).
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false;

      switch (event.key) {
        case "PageDown":
        case "ArrowDown":
        case forwardArrow:
          void next();
          return true;
        case " ":
          // Shift+Space goes back, which is the browser scrolling convention.
          void (event.shiftKey ? previous() : next());
          return true;
        case "PageUp":
        case "ArrowUp":
        case backwardArrow:
          void previous();
          return true;
        default:
          return false;
      }
    };

    const unsubscribe = renderer.on("keydown", (event) => {
      act(event);
    });

    if (!global) return unsubscribe;

    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      // Do not turn pages while the reader is typing (a search box, a note).
      // `isContentEditable` covers WYSIWYG editors, and the other three cover ordinary form
      // controls.
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (
          target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT"
        ) {
          return;
        }
      }

      // preventDefault only after handling. Keys that were not intercepted have to keep their
      // original behaviour, and that includes Tab.
      if (act(event)) event.preventDefault();
    };

    const view = window;
    view.addEventListener("keydown", onDocumentKeyDown);

    return () => {
      unsubscribe();
      view.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [renderer, next, previous, direction, enabled, global]);
}

/**
 * Swipe page turning.
 *
 * The facts come from `Renderer`'s `pointerdown` / `pointerup` — the iframe boundary blocks
 * bubbling, and those two events are the consumer's only channel to pointer activity inside
 * the book (the comments in `events.ts` explain why frond emits raw presses and releases
 * rather than a computed gesture).
 *
 * Two situations do not turn the page, because the reader is doing something else:
 *
 *   - the start lands on **already selected text** — that is adjusting the selection
 *   - the start lands on **a link** — a `linkactivate` will follow, and turning the page
 *     would fight it
 */
export function useSwipePaging(options: SwipePagingOptions = {}): void {
  const { renderer, next, previous, writingMode } = useReader();
  const { enabled = true, threshold = 40 } = options;
  const direction = options.direction ?? (writingMode === "vertical-rl" ? "rtl" : "ltr");

  useEffect(() => {
    if (!enabled || renderer === undefined) return;

    let start: { x: number; y: number } | undefined;

    const unsubscribeDown = renderer.on("pointerdown", (event) => {
      start = event.hasSelection || event.isLink ? undefined : { x: event.x, y: event.y };
    });

    const unsubscribeUp = renderer.on("pointerup", (event) => {
      const from = start;
      start = undefined;
      if (from === undefined) return;

      const dx = event.x - from.x;
      const dy = event.y - from.y;

      // The dominant axis decides whether this is a horizontal or a vertical swipe. With
      // neither axis over the threshold it is a tap — and whether a tap turns the page is a
      // different policy, not in this hook.
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (Math.abs(dx) < threshold) return;
        // Swiping **against** the reading direction is what advances the content: in an ltr
        // book, swiping left is the next page.
        const forward = direction === "rtl" ? dx > 0 : dx < 0;
        void (forward ? next() : previous());
        return;
      }

      if (Math.abs(dy) < threshold) return;
      void (dy < 0 ? next() : previous());
    });

    return () => {
      unsubscribeDown();
      unsubscribeUp();
    };
  }, [renderer, next, previous, direction, enabled, threshold]);
}
