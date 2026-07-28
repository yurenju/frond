/**
 * `@yurenju/frond-react`'s public face.
 *
 * ```tsx
 * import * as Reader from "@yurenju/frond-react";
 *
 * <Reader.Root book={book} settings={{ fontSize: 18 }}>
 *   <Reader.Viewport className="page" />
 *   <Reader.PreviousTrigger>Previous</Reader.PreviousTrigger>
 *   <Reader.Progress className="bar" />
 *   <Reader.NextTrigger>Next</Reader.NextTrigger>
 * </Reader.Root>
 * ```
 *
 * ## What this layer is and is not
 *
 * **It is**: `Renderer`'s lifecycle wired into React (mounting, unmounting, changing book,
 * changing settings), and its state turned into `data-*` attributes that CSS can hang off.
 *
 * **It is not**: a second API for frond. `useReader().renderer` hands the underlying
 * `Renderer` straight over, because methods with nothing to do with React such as
 * `rectsFor()` and `locate()` have no reason to have a mirror here — that mirror would only
 * fall behind with every extension of frond.
 *
 * ## Styling
 *
 * Every part carries a `data-frond-part="…"`, and beyond that there is **no styling at
 * all**. There are two routes to an appearance, and they can be mixed:
 *
 *   1. Write your own CSS. `className` is passed all the way down to the underlying
 *      element, and the `data-*` attributes reflect state.
 *   2. `import "@yurenju/frond-react/styles.css"` for a serviceable set of defaults. All of
 *      it sits inside `:where()` at specificity 0, so any rule of yours beats it.
 *
 * **Typography inside the book does not go through here.** The book renders inside an
 * iframe (ADR-0006) and outside CSS cannot reach it; font size, line height, margin and
 * theme all go through `Root`'s `settings`, and that route enforces ADR-0003's authority
 * order.
 */

export { Root } from "./root.tsx";
export type { RootProps } from "./root.tsx";

export { Viewport } from "./viewport.tsx";
export type { ViewportProps } from "./viewport.tsx";

export { NextTrigger, PreviousTrigger } from "./triggers.tsx";
export type { TriggerProps } from "./triggers.tsx";

export { Progress } from "./progress.tsx";
export type { ProgressProps } from "./progress.tsx";

export { useReader } from "./context.ts";
export type { ReaderActions, ReaderHandle, ReaderState, ReaderStatus } from "./context.ts";

// Policy. It only takes effect when imported explicitly — for the reason see `paging.ts`'s
// file header.
export { useKeyboardPaging, useSwipePaging } from "./paging.ts";
export type {
  KeyboardPagingOptions,
  PagingDirection,
  PagingOptions,
  SwipePagingOptions,
} from "./paging.ts";

// `Slot` is exported too. `asChild` is a capability this package exposes, and a consumer
// passing that set of props down between its own parts needs the same merge rules — writing
// a second copy by hand makes mistakes like event handlers being overwritten rather than
// chained very hard to trace.
export { Slot } from "./slot.tsx";
export type { SlotProps } from "./slot.tsx";
