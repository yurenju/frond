/**
 * `Progress` — how far through the book we are.
 *
 * ## Why it is read-only rather than a draggable position slider
 *
 * Everything drag-to-position needs is available from this package
 * (`useReader().goToFraction()`), but **the slider itself should not come from us**: it is
 * a general-purpose control, the consumer most likely already has one (their own design
 * system, Radix's `Slider`, or simply `<input type="range">`), and whatever we wrote would
 * inevitably lose to it on keyboard operation, touch target size and RTL.
 *
 * So this covers only "show the progress", and dragging is left to the consumer:
 *
 * ```tsx
 * const { location, goToFraction } = useReader();
 * <input type="range" min={0} max={1} step={0.001}
 *        value={location?.fraction ?? 0}
 *        disabled={location?.fraction === undefined}
 *        onChange={(e) => void goToFraction(e.currentTarget.valueAsNumber)} />
 * ```
 *
 * ## `fraction` is undefined for a while
 *
 * The whole-book index is built in the background after `attach()` (frond's user story 25),
 * and until then there is no whole-book progress to speak of. That case is drawn here as
 * `data-state="indeterminate"` rather than 0 — drawn as 0, the reader would see "I am at the
 * very start of the book", and that would be a lie.
 */

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useReader } from "./context.ts";
import { Slot } from "./slot.tsx";

export interface ProgressProps extends ComponentPropsWithoutRef<"div"> {
  /** Renders no `<div>` of its own, merging the props into the single child. See `slot.tsx`. */
  readonly asChild?: boolean;
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { asChild = false, style, ...rest },
  forwardedRef,
): ReactNode {
  const { location } = useReader();
  const fraction = location?.fraction;

  const Component = asChild ? Slot : "div";

  return (
    <Component
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      {...(fraction === undefined ? {} : { "aria-valuenow": fraction })}
      {...rest}
      ref={forwardedRef}
      data-frond-part="progress"
      data-state={fraction === undefined ? "indeterminate" : "loaded"}
      style={{
        // The progress goes out as a custom property rather than setting `width` directly.
        // The difference is that the consumer can then decide whether it is a bar, an arc, a
        // `scaleX`, or not drawn at all — setting `width` would have chosen "a bar" for them.
        ...(fraction === undefined ? {} : { ["--frond-progress" as string]: String(fraction) }),
        ...style,
      }}
    />
  );
});
