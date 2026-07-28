/**
 * `Viewport` — the element the book lays out inside.
 *
 * ## This is the boundary of appearance, and a harder boundary than it looks
 *
 * frond renders each section inside an iframe (ADR-0006), so **outside CSS cannot reach
 * in**. What this element can change is itself: how large, what shape, what shadow, what
 * corner radius, how much space beside it. Font size, line height, margin and theme inside
 * the book all go through `Root`'s `settings` — that route enforces ADR-0003's authority
 * order (reader settings > frond's corrections > the book's declarations), and bypassing it
 * means bypassing that order.
 *
 * This is not a limitation, it is the shape of the package: `Viewport` is a **box**, not a
 * sheet of paper.
 *
 * ## You have to supply the size
 *
 * No width or height is set here. `Renderer` measures this element's box, and that box is a
 * product of the layout — a grid item, `aspect-ratio`, `100dvh` minus a toolbar are all
 * reasonable, and picking one for you would be making a layout decision on the consumer's
 * behalf. When the height collapses to 0 the screen is blank, which is the most common
 * first problem here, so the default styles in `styles.css` do supply a set of values.
 */

import {
  forwardRef,
  useCallback,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { dataAttr, useReaderInternals } from "./context.ts";
import { Slot } from "./slot.tsx";

export interface ViewportProps extends ComponentPropsWithoutRef<"div"> {
  /** Renders no `<div>` of its own, merging the props into the single child. See `slot.tsx`. */
  readonly asChild?: boolean;
}

export const Viewport = forwardRef<HTMLDivElement, ViewportProps>(function Viewport(
  { asChild = false, ...rest },
  forwardedRef,
): ReactNode {
  const { status, writingMode, location, setViewport } = useReaderInternals();

  /**
   * **The identity has to be stable.**
   *
   * When a ref callback becomes a new function, React calls the old one with `null` first
   * and then the new one with the node. Written as an inline arrow function that happens
   * **on every render**, so `Root` receives a `setViewport(null)` followed by a
   * `setViewport(node)`.
   *
   * That pair falls in one batch and the final value equals the original, so React bails out
   * — today it happens not to remount the book. But the safety of that path rests on "the
   * two calls land in the same batch", which is not something we control; the moment they do
   * not, the symptom is the iframe being rebuilt on every render.
   *
   * `useCallback` shuts that whole path down: the ref is only called on a real mount and
   * unmount.
   */
  const attachRef = useCallback(
    (node: HTMLDivElement | null) => {
      // Two parties want this node: `Root` (to `attach()` with) and the consumer's own ref.
      setViewport(node);
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef !== null) forwardedRef.current = node;
    },
    [setViewport, forwardedRef],
  );

  const Component = asChild ? Slot : "div";

  return (
    <Component
      {...rest}
      ref={attachRef}
      data-frond-part="viewport"
      data-state={status}
      // The writing mode is **the result of how the book laid out**, not a setting — so it
      // only appears here as an attribute, with no corresponding prop to set. Layout
      // differences such as two columns when horizontal and one when vertical hang their CSS
      // off it.
      data-writing-mode={writingMode}
      data-at-start={dataAttr(location?.atStart)}
      data-at-end={dataAttr(location?.atEnd)}
    />
  );
});
