/**
 * The line between `Root` and the other parts.
 *
 * ## What lives here is facts and actions, no policy
 *
 * ADR-0002 assigns facts to frond and policy to the consumer, and `Renderer` is where that
 * line lands in the core layer: `next()` is an action rather than an event handler. This
 * context is where the same line lands in the React layer — it moves the things on
 * `Renderer` that **can only be obtained through React's lifecycle** (which renderer is
 * current, which page we are on, whether it is mounted) into React's data flow, and passes
 * the actions straight through without wrapping a single one into a gesture.
 *
 * Gestures and the keyboard live in `paging.ts`, and have to be imported explicitly to take
 * effect.
 */

import { createContext, useContext } from "react";
import type {
  ReaderSettings,
  RenderLocation,
  Renderer,
  RendererErrorEvent,
  SectionAnchor,
  WritingMode,
} from "@yurenju/frond/renderer";

/**
 * Which state this reader is currently in.
 *
 * `idle` and `loading` are two separate states, not one. The former means "there is nothing
 * to mount yet" (no `book` was given, or `Viewport` is not in the DOM yet), and the latter
 * means "mounting". A consumer usually handles the two differently — the former should show
 * "pick a book" and the latter a spinner — and collapsed into one, that distinction could
 * only be recovered by the consumer comparing props itself.
 */
export type ReaderStatus = "idle" | "loading" | "ready" | "error";

export interface ReaderState {
  /**
   * The `Renderer` underneath. `undefined` before it is mounted.
   *
   * **Exposing it is deliberate.** This layer wraps the lifecycle, not the API surface;
   * methods with nothing to do with React, such as `rectsFor()` and `locate()`, have no
   * reason to be copied out again, and copying them would only create a mirror that drifts
   * along with frond.
   */
  readonly renderer: Renderer | undefined;
  readonly status: ReaderStatus;
  /** The current position. `undefined` before the first `relocate`. */
  readonly location: RenderLocation | undefined;
  /** The writing mode the current section laid out in. **Sections of one book are not guaranteed to agree.** */
  readonly writingMode: WritingMode | undefined;
  /** The fully resolved reader settings — `Renderer`'s authoritative value, not the patch that was passed in. */
  readonly settings: ReaderSettings | undefined;
  /** The most recent rendering failure. It is not cleared when `status` returns to `ready`; it is a record, not a state. */
  readonly failure: RendererErrorEvent | undefined;
}

/**
 * The actions. Each corresponds to the method of the same name on `Renderer`.
 *
 * Before it is mounted they are all no-ops rather than throwing: these get wired to
 * buttons, and a button pressed while loading should not blow up the whole tree.
 */
export interface ReaderActions {
  next(): Promise<void>;
  previous(): Promise<void>;
  goToSection(index: number, anchor?: SectionAnchor): Promise<void>;
  goTo(target: { readonly path: string; readonly fragment?: string | undefined }): Promise<void>;
  goToCfi(cfi: string): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  /**
   * Applies a set of reader settings.
   *
   * When `Root` has a `settings` prop the two coexist, and the rule is "**the prop wins on
   * its next change**": a value set here stays in effect until the `settings` prop itself
   * becomes a different value. In other words the prop is the controlled route and this
   * method is the uncontrolled one, and both are kept.
   */
  applySettings(patch: Partial<ReaderSettings>): Promise<void>;
}

export interface ReaderHandle extends ReaderState, ReaderActions {}

/** `Viewport` uses it to hand its element to `Root`. Not on the public face. */
export interface ReaderInternals {
  readonly setViewport: (element: HTMLElement | null) => void;
}

export const ReaderContext = createContext<(ReaderHandle & ReaderInternals) | undefined>(
  undefined,
);

/**
 * Reads the reader's state and actions. Must be under a `Root`.
 *
 * This is the package's real public face — all five parts are just this plus a set of
 * `data-*` attributes. Drawing something not provided here (a custom position slider, a
 * chapter title bar, a bookmark button) goes through this route, without waiting for us to
 * grow another part.
 */
export function useReader(): ReaderHandle {
  return useReaderInternals();
}

/** The same value, but with `ReaderInternals` visible. For this package's own parts only. */
export function useReaderInternals(): ReaderHandle & ReaderInternals {
  const value = useContext(ReaderContext);
  if (value === undefined) {
    throw new Error("frond-react's parts and useReader() have to be used under a <Root>.");
  }
  return value;
}

/** Presence means true — for attributes like `data-disabled` where only presence matters. */
export function dataAttr(condition: boolean | undefined): "" | undefined {
  return condition === true ? "" : undefined;
}
