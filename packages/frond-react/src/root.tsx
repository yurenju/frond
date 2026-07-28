/**
 * `Root` — owns `Renderer`'s lifecycle and does nothing else.
 *
 * ## It renders no element
 *
 * Not even a `<div>`. This is what "unstyled" means at the layout level: one more wrapper
 * is one more box the consumer has to deal with, and flex/grid layouts are particularly
 * sensitive to an extra level in the middle (`Viewport` and a toolbar are meant to be two
 * items of the same grid, and inserting a level makes them not).
 *
 * The cost is that `Root` and `Viewport` have to pass a DOM element through context —
 * `Viewport` hands its element back once mounted, and `Root` only starts mounting the book
 * on receiving it. That is also why the state machine has an `idle` state.
 *
 * ## Why the listeners go in through `attach()`'s parameters rather than an `on()` after mounting
 *
 * By the time `attach()` returns the first section has already laid out, which means that
 * run's `load` and `relocate` were emitted inside `attach()` (see `RendererOptions.on`'s
 * comment). Attaching afterwards, the consumer would miss the two most important events in
 * the whole book-opening sequence, and the symptom would be "the screen is blank the first
 * time in, and turning one page fixes it".
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Renderer,
  type IndexedEvent,
  type LinkActivateEvent,
  type ReaderSettings,
  type RenderLocation,
  type RenderableBook,
  type RendererErrorEvent,
  type RendererKeyEvent,
  type RendererListeners,
  type RendererPointerEvent,
  type RendererStart,
  type SectionAnchor,
  type SectionLoadEvent,
  type SelectionEvent,
  type WritingMode,
} from "@yurenju/frond/renderer";
import {
  ReaderContext,
  type ReaderHandle,
  type ReaderInternals,
  type ReaderStatus,
} from "./context.ts";

export interface RootProps {
  /**
   * The book to render. `undefined` means no book has been chosen yet — `status` stays at
   * `idle`.
   *
   * Changing book **remounts everything** (`destroy()` the old, `attach()` the new). There
   * is no cheap way to do this, and there should not be: the iframe, the resources' blob
   * URLs and the whole-book index are all tied to one book.
   */
  readonly book: RenderableBook | undefined;
  /**
   * Where in the first section to render. Corresponds to `RendererOptions.start`.
   *
   * **Read exactly once, at mount.** Changing it afterwards does not jump — that is
   * `goToCfi()`'s job. This distinction has to be stated plainly: made controlled, any
   * re-render that recomputes props could pull the reader back to some old position, and
   * that bug looks on screen like "page turning occasionally jumps backwards".
   */
  readonly start?: RendererStart | undefined;
  /**
   * The reader settings. Applied to the current book when they change, **without
   * remounting**.
   *
   * The comparison is field by field and deep rather than by identity, so writing an object
   * literal directly is fine — there is no need to `useMemo` just to avoid re-applying.
   */
  readonly settings?: Partial<ReaderSettings> | undefined;

  readonly onRelocate?: ((event: RenderLocation) => void) | undefined;
  readonly onLoad?: ((event: SectionLoadEvent) => void) | undefined;
  readonly onIndexed?: ((event: IndexedEvent) => void) | undefined;
  readonly onSelection?: ((event: SelectionEvent) => void) | undefined;
  readonly onLinkActivate?: ((event: LinkActivateEvent) => void) | undefined;
  readonly onError?: ((event: RendererErrorEvent) => void) | undefined;
  readonly onPointerDown?: ((event: RendererPointerEvent) => void) | undefined;
  readonly onPointerUp?: ((event: RendererPointerEvent) => void) | undefined;
  readonly onKeyDown?: ((event: RendererKeyEvent) => void) | undefined;
  readonly onKeyUp?: ((event: RendererKeyEvent) => void) | undefined;

  readonly children?: ReactNode;
}

/** The state that changes between renders, collected into one object — saving five consecutive setStates. */
interface Snapshot {
  readonly status: ReaderStatus;
  readonly location: RenderLocation | undefined;
  readonly writingMode: WritingMode | undefined;
  readonly settings: ReaderSettings | undefined;
  readonly failure: RendererErrorEvent | undefined;
}

const IDLE: Snapshot = {
  status: "idle",
  location: undefined,
  writingMode: undefined,
  settings: undefined,
  failure: undefined,
};

export function Root(props: RootProps): ReactNode {
  const { book, children } = props;

  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [renderer, setRenderer] = useState<Renderer | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>(IDLE);

  // Event handlers and `start` / `settings` are read from here rather than going into the
  // mounting effect's dependency array. In it, every arrow function the consumer writes as a
  // handler would remount the book — and "remounting the book" means rebuilding the iframe,
  // waiting on fonts again and re-measuring the page count, which the reader sees as the
  // screen flashing and going back to the first page.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  /** The last patch passed to `applySettings`. The controlled route uses it to block re-applying. */
  const appliedSettings = useRef<Partial<ReaderSettings> | undefined>(undefined);

  useEffect(() => {
    if (book === undefined || viewport === null) {
      setRenderer(undefined);
      setSnapshot(IDLE);
      return;
    }

    setSnapshot({ ...IDLE, status: "loading" });

    // `attach()` is async, and StrictMode runs the cleanup before it resolves. Without this
    // flag, that mount's iframe would stay in the DOM forever — held by nobody and destroyed
    // by nobody, with two books stacked on screen.
    let cancelled = false;
    let attached: Renderer | undefined;

    const listeners: RendererListeners = {
      relocate: (event) => {
        setSnapshot((current) => ({ ...current, location: event }));
        latest.current.onRelocate?.(event);
      },
      load: (event) => {
        setSnapshot((current) => ({
          ...current,
          writingMode: event.writingMode,
          // The previous section was broken and this one laid out — `status` should follow it
          // back to `ready`. `failure` is not cleared: it is a record of what happened, not
          // the current state.
          status: current.status === "error" ? "ready" : current.status,
        }));
        latest.current.onLoad?.(event);
      },
      indexed: (event) => latest.current.onIndexed?.(event),
      selection: (event) => latest.current.onSelection?.(event),
      linkactivate: (event) => latest.current.onLinkActivate?.(event),
      error: (event) => {
        setSnapshot((current) => ({ ...current, status: "error", failure: event }));
        latest.current.onError?.(event);
      },
      pointerdown: (event) => latest.current.onPointerDown?.(event),
      pointerup: (event) => latest.current.onPointerUp?.(event),
      keydown: (event) => latest.current.onKeyDown?.(event),
      keyup: (event) => latest.current.onKeyUp?.(event),
    };

    const initialSettings = latest.current.settings;
    appliedSettings.current = initialSettings;

    void Renderer.attach(book, viewport, {
      on: listeners,
      settings: initialSettings ?? {},
      ...(latest.current.start === undefined ? {} : { start: latest.current.start }),
    }).then(
      (instance) => {
        if (cancelled) {
          instance.destroy();
          return;
        }
        attached = instance;
        setRenderer(instance);
        setSnapshot((current) => ({
          ...current,
          status: current.status === "error" ? "error" : "ready",
          location: instance.location,
          writingMode: instance.writingMode,
          settings: instance.settings,
        }));
      },
      (reason: unknown) => {
        if (cancelled) return;
        // A wholesale `attach()` failure (as opposed to one section failing to render) has no
        // `error` event to receive — that event's shape is tied to "which section broke", and
        // here not even the first section has been mounted.
        //
        // `reason` borrows `unreadable-section`: `RendererFailure` is frond's closed list, and
        // this layer has no standing to add a member to it. Failing to obtain section 0's
        // content really is what it describes, and `message` carries the real cause.
        setSnapshot((current) => ({
          ...current,
          status: "error",
          failure: {
            sectionIndex: 0,
            sectionPath: "",
            reason: "unreadable-section",
            message: reason instanceof Error ? reason.message : String(reason),
          },
        }));
      },
    );

    return () => {
      cancelled = true;
      attached?.destroy();
      attached = undefined;
      setRenderer(undefined);
      setSnapshot(IDLE);
    };
  }, [book, viewport]);

  // Controlled reader settings. The dependency array holds props.settings' identity, so this
  // effect runs on almost every render — what actually blocks re-applying is the deep
  // comparison below.
  const settingsProp = props.settings;
  useEffect(() => {
    if (renderer === undefined) return;
    if (sameSettings(appliedSettings.current, settingsProp)) return;

    appliedSettings.current = settingsProp;
    void renderer.applySettings(settingsProp ?? {}).then(() => {
      setSnapshot((current) => ({ ...current, settings: renderer.settings }));
    });
  }, [renderer, settingsProp]);

  const value = useMemo<ReaderHandle & ReaderInternals>(() => {
    const act = async (run: (instance: Renderer) => Promise<void>): Promise<void> => {
      if (renderer === undefined) return;
      await run(renderer);
    };

    return {
      renderer,
      status: snapshot.status,
      location: snapshot.location,
      writingMode: snapshot.writingMode,
      settings: snapshot.settings,
      failure: snapshot.failure,
      setViewport,

      next: () => act((instance) => instance.next()),
      previous: () => act((instance) => instance.previous()),
      goToSection: (index: number, anchor?: SectionAnchor) =>
        act((instance) =>
          anchor === undefined ? instance.goToSection(index) : instance.goToSection(index, anchor),
        ),
      goTo: (target) => act((instance) => instance.goTo(target)),
      goToCfi: (cfi: string) => act((instance) => instance.goToCfi(cfi)),
      goToFraction: (fraction: number) => act((instance) => instance.goToFraction(fraction)),
      applySettings: (patch: Partial<ReaderSettings>) =>
        act(async (instance) => {
          await instance.applySettings(patch);
          setSnapshot((current) => ({ ...current, settings: instance.settings }));
        }),
    };
  }, [renderer, snapshot]);

  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>;
}

/**
 * Whether two settings patches are the same thing.
 *
 * Compared rather than checked by identity, so that `<Root settings={{ fontSize }} />`
 * works — that is what everyone writes the first time, and an identity check would send an
 * `applySettings` on every render, meaning a re-layout on every render.
 *
 * The depth stops at two levels because `ReaderSettings` only has two (`margin` and `theme`
 * are objects and the rest are scalars). A general-purpose deep comparison would be
 * redundant here, and it would make "what this type looks like" disappear from the code.
 */
function sameSettings(
  a: Partial<ReaderSettings> | undefined,
  b: Partial<ReaderSettings> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ReaderSettings>;
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  const entries = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of entries) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}
