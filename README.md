# frond

A TypeScript EPUB rendering library. Vertical and horizontal writing are equal
citizens, and every layout claim is verified on Chromium, Firefox and WebKit.

[繁體中文](README.zh-TW.md)

![A vertically typeset Chinese book rendered by frond](docs/images/demo-read.png)

**[Try it with your own EPUB →](https://yurenju.github.io/frond/)** Drag a file
in and read it, or switch to the inspect panel and see exactly what frond reads
out of your book. It runs entirely in the page — frond has no download or upload
code path at all.

## Install

```bash
npm install @yurenju/frond
```

What you get is plain ES modules plus `.d.ts` files — no build step on your
side, and no TypeScript needed in your project.

## Status: 0.x, and the API will change

`0.x` means what semver says it means: nothing is promised. frond's API still
moves, and a minor bump can break you — pin an exact version and read the
[release notes](https://github.com/yurenju/frond/releases) before you move. See
[ADR-0008](docs/adr/0008-distribution-and-license.md) for why it ships on npm
anyway.

## Zero runtime dependencies

frond ships no dependencies. Not "few" — none. ZIP reading, XML parsing, CFI and
pagination are all its own code, on top of platform APIs (`DecompressionStream`,
`DOMParser`, blob URLs, `ResizeObserver`).

One consequence is worth stating plainly: **the emitted modules contain no bare
specifiers, so a browser can import them directly.** No bundler, no build step,
no import map.

```html
<div id="viewer" style="height: 100dvh"></div>

<script type="module">
  import { EpubBook } from "./frond/epub/index.js";
  import { Renderer } from "./frond/renderer/index.js";

  const book = await EpubBook.open(await file.arrayBuffer());
  const renderer = await Renderer.attach(book, document.getElementById("viewer"), {
    settings: { fontSize: 20, margin: 32 },
    on: {
      relocate: (at) => console.log(at.page + 1, "of", at.pageCount, at.cfi),
    },
  });

  await renderer.next();
</script>
```

The demo site is the full version of that snippet — see
[`site/app.js`](site/app.js). It is not an example that sits in a folder rotting;
it is deployed on every push to `main`.

## Two layers

frond is split in two, and you can use either half on its own.

| Entry point | Needs DOM | What it gives you |
| --- | --- | --- |
| `@yurenju/frond/epub` | no | `EpubBook.open(bytes)` → metadata, reading order, TOC, cover, manifest resources, raw bytes by path. Plus CFI parsing, serialising and comparison. |
| `@yurenju/frond/renderer` | yes | `Renderer.attach(book, element)` → paging, section navigation, reader settings, writing mode, CFI ↔ position, typed events. |

`EpubBook` has no DOM dependency at all, so it runs in Node — parsing tests do
not need a browser. The inspect panel on the demo site is built out of that half
alone:

![The inspect panel listing what frond read out of a book](docs/images/demo-inspect.png)

`Renderer` does not take an `EpubBook`; it takes a narrow `RenderableBook`
interface that `EpubBook` happens to satisfy. `MemoryBook`, an in-memory
implementation of that interface, is part of the public API on purpose: when you
test the code that reacts to frond's events, you should not have to fake a book
yourself.

Events are a typed emitter, not DOM `CustomEvent`:

```ts
const stop = renderer.on("relocate", (at) => {
  //                                   ^? RenderLocation, not any
  progress.value = at.fraction ?? 0;
});
```

### Input inside the iframe

A section renders inside an iframe, and iframe boundaries stop events from
bubbling — so a listener on your container receives nothing. frond forwards the
raw facts back out: where the pointer went down or up, in **container**
coordinates, plus the two DOM conditions you would otherwise have to reach into
the document to check.

```ts
renderer.on("pointerup", (e) => {
  if (e.hasSelection || e.isLink) return; // the reader is selecting, or tapped a link
  if (e.x > e.width * 0.7) turn("forward"); // tap zones are your decision, not frond's
});

renderer.on("keyup", (e) => {
  if (e.key === "ArrowLeft") turn(book.metadata.pageProgressionDirection === "rtl" ? "forward" : "back");
});
```

`pointerdown` / `pointerup` / `keydown` / `keyup` are deliberately raw. frond
does not pair a down with an up, does not measure swipe distance and does not
decide what a tap in a given region means — that is where gestures start, and
gestures are yours.

### Opening where the reader left off

```ts
const renderer = await Renderer.attach(book, element, {
  start: { cfi: saved.cfi }, // or { sectionIndex, fragment }
  settings: { margin: { block: 16, inline: 64 } },
});
```

`start` renders the right section first instead of laying out section 0 and then
jumping — one iframe mount instead of two. It takes a CFI or a section, not a
fraction: whole-book fractions need the character index, which is built in the
background *after* the first page is on screen.

`margin` accepts a number (equal on all sides) or `{ block, inline }`, resolved
against the writing mode the section actually laid out in. The inline axis is
the one that controls line length — left/right in horizontal writing, **top and
bottom** in vertical.

### Querying without navigating

`goToFraction(f)` jumps. `locate(f)` only answers *where would that land* —
which is what a scrubber needs while the reader is still dragging:

```ts
const at = renderer.locate(0.42); // undefined until the index is built
label.textContent = at ? chapterTitleFor(at.sectionPath) : "";
```

## What frond does not do

This list is the honest part of the README. Most of these are decisions, not
gaps.

- **It does not handle gestures.** `next()` and `previous()` are actions, not
  event handlers. Whether swiping left means forward depends on the book's page
  progression direction and on your product; frond reports the fact and you make
  the call. It does forward the raw pointer and key events out of the iframe,
  because you cannot reach them otherwise — but pairing, thresholds and tap
  zones stay on your side.
- **It does not fetch anything.** `EpubBook.open()` takes bytes. Remote
  resources declared inside a book are reported as remote and left alone.
- **It does not follow links.** Clicking a link inside the book emits an event
  saying where it points. Navigating is your decision.
- **It does not report a page count for the book.** A page is a product of the
  viewport and the reader's font size, not a property of the book. frond reports
  pages within the current section, and a 0–1 fraction for whole-book position.
- **It does not run scripts inside books.** `<script>` elements and `on*`
  attributes are stripped before a section is ever parsed into a document. EPUB 3
  permits scripted content; frond declines it as a security decision, not as a
  missing feature ([ADR-0006](docs/adr/0006-iframe-isolation-no-scripted-content.md)).
- **It does not do DRM**, and it will not.
- **It does not manage a library.** Shelves, collections and sync are yours.
- **It is EPUB only.** No MOBI, FB2, CBZ or PDF. That is why `EpubBook` is a
  concrete type instead of an abstraction over formats.

## Support boundary

EPUB 3 and EPUB 2 are both supported, and frond does not branch on version where
the real world does not: covers declared the EPUB 2 way are found in EPUB 3
books too, because that is what shipping books actually look like.

Where a book says nothing, frond reports "the book did not say" rather than
substituting a default. EPUB 2 has no page progression direction, so
`metadata.pageProgressionDirection` is `undefined` for every EPUB 2 book — that
is different from a book that declared `ltr`, and the difference is yours to
act on. Details in [ADR-0010](docs/adr/0010-epub-2-support-boundary.md).

Not supported in the archive layer: ZIP64, encrypted entries, and compression
methods other than stored and deflate. Across a 34-book sample of commercial
Chinese-language EPUBs (3309 entries) none of these appeared.

## Browsers

Chromium, Firefox and WebKit are tested as equals — a failure in any one of them
is a failure. There is no tier list, because the writing mode this library cares
most about is the one where engines disagree most. Measured differences are
logged in [`docs/browser-quirks.md`](docs/browser-quirks.md).

## Development

Every command goes through `npm run`; the scripts pin the versions and flags.

```bash
npm run typecheck       # tsc --noEmit over src, scripts and tests
npm run test:node       # Vitest — the parsing layer, no browser
npm run test:container  # both runners inside the test image (browsers live there)
npm run build           # emit dist/
npm run site            # build dist/ and assemble the demo site
```

Browser tests only run inside the container: the three engines and the pinned
fonts exist in the test image, not on your machine. See
[`AGENTS.md`](AGENTS.md).

## Licence

MIT. See [LICENSE](LICENSE).

frond is a reimplementation, not a port, and ships no third-party code. The one
piece of upstream material in this repository is the CFI acceptance table in
`tests/node/cfi/foliate-acceptance.test.ts`, taken from
[foliate-js](https://github.com/johnfactotum/foliate-js) (MIT, Copyright (c)
2022 John Factotum). See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
