/**
 * The browser side's operating surface.
 *
 * It runs inside the page, so it can see the real React tree and the real `Renderer`; the
 * spec side gets only serializable values plus ordinary DOM assertions.
 *
 * ## Why the books are `MemoryBook`s rather than synthetic fixtures
 *
 * What these tests measure is **the layer frond-react adds** — mounting, unmounting,
 * changing books, changing settings, the `data-*` attributes — rather than whether frond
 * lays a book out correctly (that is `tests/browser/renderer/`'s business, and those use
 * books parsed for real).
 *
 * `MemoryBook` is part of the public API (ADR-0002), so this doubles as a demonstration
 * of how a consumer should test their own integration layer: without an EPUB file.
 */

import { StrictMode, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import * as Reader from "@yurenju/frond-react";
import { MemoryBook, type ReaderSettings, type RenderableBook } from "@yurenju/frond/renderer";
import type {
  LocationSnapshot,
  MountConfig,
  ReactHarness,
  SettingsPatch,
} from "../harness.ts";

/** Enough paragraphs for a section to lay out over several pages — otherwise `atEnd` is true from page one. */
function prose(marker: string): string {
  const paragraph = `<p>${marker}　この文章は折り返しと改ページを起こすためだけに置かれている。`
    .concat("いろはにほへとちりぬるを".repeat(24))
    .concat("</p>");

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${marker}</title></head>
<body>${paragraph.repeat(8)}</body></html>`;
}

const BOOKS: Record<"one" | "two", RenderableBook> = {
  one: MemoryBook.of({
    sections: [
      { path: "one-a.xhtml", content: prose("one-a") },
      { path: "one-b.xhtml", content: prose("one-b") },
    ],
  }),
  two: MemoryBook.of({
    sections: [{ path: "two-a.xhtml", content: prose("two-a") }],
  }),
};

// --- One external store for React to read ----------------------------------
//
// `useSyncExternalStore` rather than stashing `setState` in a module variable. The latter
// means writing a module-level variable during render, which under StrictMode (where
// render runs twice) is the easiest way there is to fool yourself — and StrictMode is
// precisely what these tests are here to verify.

let config: MountConfig = { book: null };
const subscribers = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function publish(next: MountConfig): void {
  config = next;
  for (const listener of subscribers) listener();
}

// --- Observation ------------------------------------------------------------

let loadCount = 0;
let childClickCount = 0;
let location: LocationSnapshot | null = null;

/**
 * The `Renderer` instances that have appeared. **Its size is "how many times a book was
 * mounted".**
 *
 * A set rather than a counter, because StrictMode mounts, unmounts and remounts every
 * effect — a counter would jump to 2 there, while that "remount" still used the same
 * `Renderer`. Only identity separates the two things that need separating ("the effect
 * ran twice" and "something really attached again").
 *
 * It is also why the `load` event count cannot serve as this metric: changing a reader
 * setting rebuilds the document, so `load` fires again too — and that is not a remount.
 */
const seenRenderers = new Set<unknown>();

function toSettings(patch: SettingsPatch | undefined): Partial<ReaderSettings> | undefined {
  return patch as Partial<ReaderSettings> | undefined;
}

function App(): ReactNode {
  const current = useSyncExternalStore(subscribe, () => config);
  const book = current.book === null ? undefined : BOOKS[current.book];

  return (
    <Reader.Root
      book={book}
      settings={toSettings(current.settings)}
      onLoad={() => {
        loadCount += 1;
      }}
      onRelocate={(event) => {
        location = {
          sectionIndex: event.sectionIndex,
          sectionPath: event.sectionPath,
          page: event.page,
          pageCount: event.pageCount,
          atStart: event.atStart,
          atEnd: event.atEnd,
        };
      }}
    >
      <Observer />
      {current.keyboard === true ? <Paging /> : null}
      <Reader.Viewport className="viewport" data-testid="viewport" />
      <Toolbar asChild={current.asChild === true} />
      <Reader.Progress data-testid="progress" />
    </Reader.Root>
  );
}

/** Records every `Renderer` that appears. It draws nothing itself. */
function Observer(): ReactNode {
  const { renderer } = Reader.useReader();

  useEffect(() => {
    if (renderer !== undefined) seenRenderers.add(renderer);
  }, [renderer]);

  return null;
}

/**
 * Policy hangs on a component that draws nothing.
 *
 * This is exactly the shape `paging.ts`'s header comment recommends — written out here
 * because it doubles as this package's usage example, and an example is best when it is
 * the one the tests actually run.
 */
function Paging(): ReactNode {
  Reader.useKeyboardPaging();
  return null;
}

function Toolbar({ asChild }: { readonly asChild: boolean }): ReactNode {
  if (!asChild) {
    return (
      <>
        <Reader.PreviousTrigger data-testid="previous">Previous page</Reader.PreviousTrigger>
        <Reader.NextTrigger data-testid="next">Next page</Reader.NextTrigger>
      </>
    );
  }

  // The child carries its own `onClick` and its own `className` — both should coexist with
  // the part's own rather than be overwritten (`slot.tsx`'s merge rules).
  return (
    <>
      <Reader.PreviousTrigger asChild>
        <button type="button" data-testid="previous" className="mine">
          Previous page
        </button>
      </Reader.PreviousTrigger>
      <Reader.NextTrigger asChild>
        <button
          type="button"
          data-testid="next"
          className="mine"
          onClick={() => {
            childClickCount += 1;
          }}
        >
          Next page
        </button>
      </Reader.NextTrigger>
    </>
  );
}

// --- Mounting ---------------------------------------------------------------

let root: ReactRoot | undefined;

/**
 * Waits for React to flush this update, and for `Renderer`'s asynchronous book-mounting
 * work to finish.
 *
 * Two `requestAnimationFrame`s plus a microtask flush is not a guarantee — the real
 * waiting is done by the spec side's `expect(locator).toHaveAttribute(…)` polling. This
 * only makes `mount()` usually return with something to look at, saving a wait line at
 * the top of every spec.
 */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function viewportElement(): HTMLElement | null {
  return document.querySelector("[data-frond-part='viewport']");
}

const harness: ReactHarness = {
  async mount(next: MountConfig): Promise<void> {
    if (root !== undefined) {
      root.unmount();
      root = undefined;
    }

    loadCount = 0;
    childClickCount = 0;
    location = null;
    seenRenderers.clear();
    config = next;

    const container = document.getElementById("root");
    if (container === null) throw new Error("the shell page has no #root");

    root = createRoot(container);
    root.render(next.strict === true ? <StrictMode><App /></StrictMode> : <App />);

    await settled();
  },

  async update(next: MountConfig): Promise<void> {
    publish(next);
    await settled();
  },

  async unmount(): Promise<void> {
    root?.unmount();
    root = undefined;
    await settled();
  },

  iframeCount(): number {
    return viewportElement()?.querySelectorAll("iframe").length ?? 0;
  },

  loadCount(): number {
    return loadCount;
  },

  attachCount(): number {
    return seenRenderers.size;
  },

  location(): LocationSnapshot | null {
    return location;
  },

  computed(selector: string, property: string): string {
    const frame = viewportElement()?.querySelector("iframe");
    if (!(frame instanceof HTMLIFrameElement)) return "";

    const document = frame.contentDocument;
    const view = document?.defaultView;
    if (document == null || view === null || view === undefined) return "";

    const element = document.querySelector(selector);
    if (element === null) return "";

    return view.getComputedStyle(element).getPropertyValue(property);
  },

  childClickCount(): number {
    return childClickCount;
  },
};

Object.defineProperty(window, "reactHarness", { value: harness });
