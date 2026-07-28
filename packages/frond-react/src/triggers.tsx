/**
 * The two page-turn buttons.
 *
 * ## "Previous/next page" is a fact; "swipe left" is policy
 *
 * Pressing these two parts calls `previous()` and `next()`, and that is backwards and
 * forwards along the **reading order** — independent of both the page progression direction
 * and the writing mode. In an `rtl` vertical book, "next page" is still the next page; it
 * is merely drawn on the left of the screen. What ADR-0002 refuses is frond deciding things
 * like "swiping left means next page", not refusing to acknowledge that the reading order
 * has a direction.
 *
 * So these two buttons do not cross that line, and `useSwipePaging()` is the thing on the
 * other side of it — it lives in `paging.ts` and has to be imported explicitly.
 *
 * ## Layout order is policy too
 *
 * Which button is drawn on the left is not decided here. An `rtl` book usually wants "next
 * page" on the left, but that is the consumer's CSS — `Viewport`'s `data-writing-mode` and
 * `EpubBook.metadata.pageProgressionDirection` are the grounds for deciding, and both are
 * available.
 */

import { forwardRef, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from "react";
import { dataAttr, useReader } from "./context.ts";
import { Slot } from "./slot.tsx";

export interface TriggerProps extends ComponentPropsWithoutRef<"button"> {
  /** Renders no `<button>` of its own, merging the props into the single child. See `slot.tsx`. */
  readonly asChild?: boolean;
}

/**
 * Builds two parts differing only in direction.
 *
 * Factoring it out is not about saving ten lines, it is about making "the two buttons behave
 * perfectly symmetrically" something the code structure guarantees — written separately,
 * the future change that only patches one of them would turn nothing red.
 */
function createTrigger(
  part: string,
  displayName: string,
  pick: (handle: ReturnType<typeof useReader>) => {
    readonly act: () => Promise<void>;
    readonly atBoundary: boolean;
  },
) {
  const Trigger = forwardRef<HTMLButtonElement, TriggerProps>(function Trigger(
    { asChild = false, onClick, disabled, ...rest },
    forwardedRef,
  ): ReactNode {
    const handle = useReader();
    const { act, atBoundary } = pick(handle);

    // All three cases mean "cannot be pressed right now": the consumer said disabled, it is
    // not mounted yet, or we are already at the boundary.
    const isDisabled = disabled === true || handle.renderer === undefined || atBoundary;

    const Component = asChild ? Slot : "button";

    return (
      <Component
        // `type="button"` comes before the spread so the consumer can override it. Without
        // it, this button becomes a submit inside any `<form>` — that is the native
        // `<button>` default, and the symptom is the whole page reloading on a page turn.
        type="button"
        {...rest}
        ref={forwardedRef}
        disabled={isDisabled}
        data-frond-part={part}
        data-disabled={dataAttr(isDisabled)}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          if (event.defaultPrevented || isDisabled) return;
          void act();
        }}
      />
    );
  });

  Trigger.displayName = displayName;
  return Trigger;
}

export const NextTrigger = createTrigger("next-trigger", "NextTrigger", (handle) => ({
  act: handle.next,
  atBoundary: handle.location?.atEnd ?? false,
}));

export const PreviousTrigger = createTrigger("previous-trigger", "PreviousTrigger", (handle) => ({
  act: handle.previous,
  atBoundary: handle.location?.atStart ?? false,
}));
