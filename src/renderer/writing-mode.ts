/**
 * Detecting the writing mode.
 *
 * **This belongs to `Renderer`, not `EpubBook`** (ADR-0010, #21): it is declared in the
 * stylesheet, deciding it requires the CSSOM, and `EpubBook` is the zero-DOM layer.
 *
 * ## Why string matching will not do
 *
 * Three measured facts, each of which alone is enough to make string matching miss a
 * book (`docs/browser-quirks.md`):
 *
 * 1. **The declaration may be on `<body>`** rather than `<html>`. Books produced by
 *    InDesign are exactly this shape, and a library reading only `documentElement`
 *    judges them horizontal (spine walked into this).
 * 2. **There may be no space after the colon.** 《入境大廳》 writes
 *    `-epub-writing-mode:vertical-rl`, and matching `"writing-mode: vertical-rl"`
 *    misses the entire book.
 * 3. **All three browsers accept the legacy `tb-rl` syntax**, and normalize the
 *    computed value to `vertical-rl`. String matching would have to recognise every
 *    historical spelling itself; the CSSOM does not.
 *
 * The prefixed case (`-epub-` / `-webkit-`) is **not handled here**: Firefox never
 * receives that declaration at all, so its computed value is horizontal and reading the
 * CSSOM will not reveal it either. That case is repaired while the document is still
 * text (`css.ts`'s `normalisePrefixedWritingMode`), so what arrives here is already a
 * repaired document. For why the two are kept separate, see ADR-0003's table of
 * examples: one is frond not reading enough, the other is the browser not doing what
 * the book said.
 */

import type { WritingMode } from "./geometry.ts";

export type WritingModeReading =
  | { readonly kind: "read"; readonly writingMode: WritingMode }
  /**
   * Could not be read. **Not "and therefore horizontal"** — see below.
   */
  | { readonly kind: "unreadable" };

/**
 * Reads the writing mode out of a document that is **already displayed**.
 *
 * ## Why "could not read" is kept apart from "horizontal"
 *
 * Firefox returns an **empty string** rather than the initial value on a
 * `display: none` iframe (the second entry already reproduced in
 * `docs/browser-quirks.md`). It does not raise an error, and it does not give a
 * plausible-looking wrong answer — so an implementation treating the empty string as
 * `horizontal-tb` has the symptom "vertical books occasionally lay out entirely
 * horizontally", with the root cause in one failed read, and the two are a long way
 * apart.
 *
 * **frond's design never creates that precondition**: it does not preload hidden
 * iframes, and by the time the writing mode is read that document is already on
 * screen. So `unreadable` is a defence rather than a path that gets taken —
 * `section-view.ts` turns it into a `WritingModeUnreadableError`, making it a visible
 * failure.
 *
 * The reason for two cases rather than just returning `horizontal-tb` is that this path
 * will be opened one day: preloading the next section (in a hidden iframe) is a very
 * natural optimisation, and whoever does it will not know what they walked into.
 */
export function readWritingMode(document: Document): WritingModeReading {
  const view = document.defaultView;
  if (view === null) return { kind: "unreadable" };

  const root = document.documentElement;
  const rootMode = view.getComputedStyle(root).writingMode;
  const body = document.body;
  const bodyMode = body === null ? "" : view.getComputedStyle(body).writingMode;

  if (rootMode === "" && bodyMode === "") return { kind: "unreadable" };

  // **Both have to be looked at.** In a book that declares it on `<body>` (the InDesign
  // shape), `<html>` keeps the initial value `horizontal-tb` — a perfectly
  // normal-looking answer, so an implementation reading only `documentElement` raises
  // no error and merely lays an entire vertical book out horizontally.
  if (isVertical(bodyMode) || isVertical(rootMode)) {
    return { kind: "read", writingMode: "vertical-rl" };
  }

  return { kind: "read", writingMode: "horizontal-tb" };
}

/**
 * Whether the computed value is vertical.
 *
 * `vertical-rl` and `vertical-lr` both count — **frond v1 always lays out as
 * `vertical-rl`** (CONTEXT.md: vertical Chinese and Japanese are always
 * `vertical-rl`). Not one `vertical-lr` book appears in the sample, and pretending to
 * support it would make the pagination direction the opposite of the direction actually
 * laid out, which is harder to diagnose than explicitly treating it as `vertical-rl`.
 * When one really turns up it warrants an issue, not one more branch here.
 *
 * `sideways-rl` / `sideways-lr` fall into this same case.
 */
function isVertical(computed: string): boolean {
  return computed.startsWith("vertical") || computed.startsWith("sideways");
}
