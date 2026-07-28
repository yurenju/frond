/**
 * frond-react's demo page.
 *
 * ## The three things it demonstrates are all switchable live
 *
 * 1. **How the parts compose** — `Root` / `Viewport` / the two Triggers / `Progress` laid
 *    out in the single `App()` function below, with no further layer of abstraction.
 * 2. **The default styles are optional** — the switch in the toolbar toggles a `<link>`'s
 *    `disabled`. Turned off, the parts fall back to the browser's native appearance, which
 *    is exactly what "without the import it does not exist at all" means.
 * 3. **Policy is optional** — another switch decides whether the keyboard and swipe paging
 *    hooks are called. Turned off, arrow keys and swipes do nothing at all, and only the
 *    buttons turn pages.
 *
 * The second and third are switches rather than sentences in the documentation because they
 * are the two design claims this package is most likely to be read as platitudes. "Styling is
 * optional" reads like a nicety; a switch that visibly changes things does not.
 *
 * ## There is only one Root
 *
 * The toolbar, the table of contents, the book and the status line are all descendants of
 * one `<Reader.Root>`. That is not for convenience — **one `Root` is one `Renderer`, which
 * is one book mounted on screen**, and opening two would give two iframes. `Root` renders no
 * element of its own (not even a `<div>`), so wrapping the whole page adds no layer of box
 * and the layout is still entirely decided by the CSS here.
 *
 * ## This file is documentation too
 *
 * The "this is what using it looks like" code block on the page and the `<Reader.Root>`
 * section below are the same thing. Copy it across and modify it, without reading an API
 * reference first.
 */

import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Reader from "@yurenju/frond-react";
import { EpubBook } from "@yurenju/frond/epub";
import type { TocItem } from "@yurenju/frond/epub";

// --- opening a book ---------------------------------------------------------

interface OpenBook {
  readonly book: EpubBook;
  readonly title: string;
}

function useOpener(): {
  readonly opened: OpenBook | undefined;
  readonly failure: string | undefined;
  open(file: File): void;
} {
  const [opened, setOpened] = useState<OpenBook | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const open = useCallback((file: File) => {
    setFailure(undefined);
    void (async () => {
      try {
        const book = await EpubBook.open(await file.arrayBuffer());
        setOpened({ book, title: book.metadata.title ?? file.name });
      } catch (reason) {
        setOpened(undefined);
        setFailure(reason instanceof Error ? reason.message : String(reason));
      }
    })();
  }, []);

  return { opened, failure, open };
}

// --- the whole page ---------------------------------------------------------

function App() {
  const { opened, failure, open } = useOpener();
  const [fontSize, setFontSize] = useState(20);
  const [styled, setStyled] = useState(true);
  const [paging, setPaging] = useState(true);

  useDefaultStylesheet(styled);

  if (opened === undefined) {
    return <Dropzone failure={failure} onFile={open} />;
  }

  return (
    <Reader.Root book={opened.book} settings={{ fontSize, margin: 32 }}>
      {/* Policy: whether keyboard and swipe input is consumed. Without this component, not one gesture is. */}
      {paging ? <Paging /> : null}

      <div className="workspace-bar">
        <p className="book-title" data-testid="book-title">
          {opened.title}
        </p>

        <TableOfContents toc={opened.book.toc} />

        <label>
          Font size
          <input
            type="range"
            min={12}
            max={40}
            step={1}
            value={fontSize}
            data-testid="font-size"
            onChange={(event) => setFontSize(event.currentTarget.valueAsNumber)}
          />
        </label>

        {/*
          Two switches. What they toggle is not an appearance option but two of this
          package's design claims — the difference is visible the moment you flip them, which
          is more convincing than a paragraph of text.
        */}
        <label className="switch">
          <input
            type="checkbox"
            checked={styled}
            data-testid="toggle-styles"
            onChange={(event) => setStyled(event.currentTarget.checked)}
          />
          Default styles
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={paging}
            data-testid="toggle-paging"
            onChange={(event) => setPaging(event.currentTarget.checked)}
          />
          Keyboard and swipe paging
        </label>

        <label className="file-button small">
          Another book
          <input
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file !== undefined) open(file);
            }}
          />
        </label>
      </div>

      <div className="reader-stage">
        <Reader.PreviousTrigger className="page-turn" aria-label="Previous page" data-testid="previous">
          ‹
        </Reader.PreviousTrigger>
        <Reader.Viewport className="reader-viewport" data-testid="viewport" />
        <Reader.NextTrigger className="page-turn" aria-label="Next page" data-testid="next">
          ›
        </Reader.NextTrigger>
      </div>

      <Reader.Progress className="reader-progress" data-testid="progress" />
      <StatusLine />
    </Reader.Root>
  );
}

/**
 * Policy hangs off a component that draws nothing.
 *
 * Hooks cannot go inside conditions, so the shape of "it can be turned off" is
 * "conditionally render a component that holds them" — which is also the notation
 * `paging.ts`'s file header recommends.
 */
function Paging() {
  Reader.useKeyboardPaging();
  Reader.useSwipePaging();
  return null;
}

/** The status line. What it demonstrates is `useReader()` — everything the parts do not provide comes from there. */
function StatusLine() {
  const { location, writingMode, status } = Reader.useReader();

  if (status !== "ready" || location === undefined) {
    return (
      <p className="reader-status" data-testid="status">
        {status === "error" ? "This section will not render" : "Laying out…"}
      </p>
    );
  }

  return (
    <p className="reader-status" data-testid="status">
      <span data-testid="status-writing-mode">
        {writingMode === "vertical-rl" ? "Vertical" : "Horizontal"}
      </span>
      <span data-testid="status-page">
        Page {location.page + 1} / {location.pageCount}
      </span>
      <span data-testid="status-fraction">
        {location.fraction === undefined
          ? "Building the index…"
          : `Book progress ${(location.fraction * 100).toFixed(1)}%`}
      </span>
      <code data-testid="status-cfi">{location.cfi}</code>
    </p>
  );
}

/**
 * The table of contents.
 *
 * It is the page's own `<select>` rather than a part, because "whether the table of contents
 * is a dropdown, a sidebar or a drawer" is policy (ADR-0002). frond supplies the fact — where
 * `TocItem.target` points — and jumping there is one line of `goTo()`.
 */
function TableOfContents({ toc }: { readonly toc: readonly TocItem[] }) {
  const { goTo, status } = Reader.useReader();

  const flat: { readonly label: string; readonly depth: number; readonly item: TocItem }[] = [];
  const walk = (items: readonly TocItem[], depth: number): void => {
    for (const item of items) {
      flat.push({ label: item.label, depth, item });
      walk(item.children, depth + 1);
    }
  };
  walk(toc, 0);

  if (flat.length === 0) return null;

  return (
    <select
      className="toc"
      aria-label="Table of contents"
      data-testid="toc"
      disabled={status !== "ready"}
      value=""
      onChange={(event) => {
        const chosen = flat[Number(event.currentTarget.value)];
        const target = chosen?.item.target;

        // `target` is a union, not two optional fields. A TOC pointing at an external link
        // (`remote`) or outside the package (the book is written wrong) are both shapes that
        // really occur, and the response to them is not to navigate — here, nothing happens.
        if (target?.kind === "in-container") {
          void goTo({ path: target.path, fragment: target.fragment });
        }
      }}
    >
      <option value="">Contents…</option>
      {flat.map((entry, index) => (
        <option key={index} value={index}>
          {"　".repeat(entry.depth)}
          {entry.label}
        </option>
      ))}
    </select>
  );
}

/**
 * The default stylesheet switch.
 *
 * What it toggles is a `<link>`'s `disabled` rather than importing the CSS into the bundle —
 * the latter would make it "always in effect", and what this page demonstrates is precisely
 * that it can have no effect at all.
 */
function useDefaultStylesheet(enabled: boolean): void {
  useEffect(() => {
    const link = document.getElementById("frond-react-styles");
    if (link instanceof HTMLLinkElement) link.disabled = !enabled;
  }, [enabled]);
}

function Dropzone({
  failure,
  onFile,
}: {
  readonly failure: string | undefined;
  onFile(file: File): void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={dragging ? "dropzone is-hovered" : "dropzone"}
      data-testid="dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file !== undefined) onFile(file);
      }}
    >
      <p className="dropzone-headline">Drop an EPUB here</p>
      <p className="dropzone-sub">or</p>
      <label className="file-button">
        Choose a file
        <input
          type="file"
          accept=".epub,application/epub+zip"
          data-testid="file-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file !== undefined) onFile(file);
          }}
        />
      </label>
      {failure === undefined ? null : (
        <p className="error" data-testid="open-error">
          This book will not open: {failure}
        </p>
      )}
    </div>
  );
}

const container = document.getElementById("app");
if (container === null) throw new Error("there is no #app on the page");

// StrictMode is deliberate. It mounts, unmounts and remounts every effect, which is exactly
// where a thin wrapper is most likely to go wrong — the demo site keeping it on means every
// deploy walks that path.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
