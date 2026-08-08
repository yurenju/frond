import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { EpubBook } from "../../../src/epub/index.ts";
import type { AilmentName } from "../../../src/test-fixtures/index.ts";

/**
 * Feeding frond into a browser.
 *
 * ## Why there is no bundler
 *
 * `Renderer`'s module graph contains **not one bare specifier** — it depends only on
 * `src/renderer/` itself and two zero-dependency pure-function modules from `src/epub/`
 * (`cfi.ts`, `resource-path.ts`). The decompression and XML parsing packages live at the
 * `EpubBook` layer, and `Renderer` takes the narrow `RenderableBook` interface rather
 * than `EpubBook` (`src/renderer/book.ts`).
 *
 * That leaves one thing to do to get the source into the page: strip TypeScript's types.
 * Node's built-in `stripTypeScriptTypes` does exactly that, so no bundler has to be
 * introduced — and so no second module-resolution configuration, differing from the real
 * build, has to exist for the tests. When that kind of configuration drifts, the symptom
 * is "tests green but the consumer cannot build".
 *
 * Stripping rather than transpiling costs the ability to use non-erasable syntax in the
 * source (`enum`, `namespace`, constructor parameter properties). That restriction is the
 * same one `tsconfig.json` already accepts so that `node` can run `src/` directly, so
 * nothing new is being constrained.
 *
 * ## Why interception rather than a server
 *
 * The container runs with `--network=none` (`scripts/test-in-container.sh`). Playwright's
 * route interception takes a request before it leaves the browser, so not even loopback
 * is needed — one fewer thing to turn into an irreproducible red test in somebody else's
 * environment.
 */

export const ORIGIN = "http://frond.test";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The id of the container element in the page. */
export const VIEWPORT_ID = "viewport";

/**
 * Teaches this page about `http://frond.test` and opens the shell page.
 *
 * After the call, `window.frond` is ready
 * (`tests/browser/support/page/frond-page.ts`).
 */
export async function openHarness(page: Page): Promise<void> {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/") {
      await route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: shell(),
      });
      return;
    }

    if (url.pathname.startsWith("/book/")) {
      await fulfilBookRequest(route, url);
      return;
    }

    const source = await readSourceFile(url.pathname);
    if (source === undefined) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }

    await route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: source,
    });
  });

  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.frond !== undefined);
}

/**
 * A real font's bytes, wrapped in a `Blob` **by the page** and named by its address.
 *
 * This is the consumer's side of `settings.fontFaces` played out for real: a reader with a
 * font on the device has nothing but `createObjectURL` to hand it over with (#92 measured
 * why — a `blob:` iframe is outside a service worker's control in Chromium, so serving the
 * bytes from a worker leaves Chrome without them offline). Declaring the face with an
 * address the page never fetches would test the string formatting and nothing else.
 *
 * The bytes are a Latin monospace font from the test image rather than one of the CJK
 * faces, and that is deliberate on three counts: it is small enough to hand across
 * `page.evaluate`, it shares not one glyph with the fixtures the geometry assertions are
 * measured on, and monospace is the one Latin face that cannot be mistaken for whatever
 * the engine resolved `serif` to — which is what makes the evidence screenshots readable.
 */
export async function supplyFontToPage(page: Page): Promise<string> {
  const bytes = await readFile(PROBE_FONT_PATH).catch(() => {
    throw new Error(
      `${PROBE_FONT_PATH} is missing. The browser specs run inside the test image ` +
        "(AGENTS.md: `npm run test:container`), and that is where this font comes from.",
    );
  });

  return page.evaluate(
    ([base64, type]) => window.frond.objectUrl(base64 as string, type as string),
    [bytes.toString("base64"), "font/ttf"] as const,
  );
}

/**
 * Where that font is. Part of the base image (`mcr.microsoft.com/playwright:…`, pinned in
 * the `Dockerfile`) rather than of what `Dockerfile` installs — the fonts frond pins are
 * pinned because every geometric number in this suite is measured on them, and this one is
 * measured on nothing.
 */
const PROBE_FONT_PATH = "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf";

/**
 * Mounts a synthetic fixture and returns the position it lands at.
 *
 * The book is opened with `EpubBook` **on the Node side** and fed into the page file by
 * file. What gets measured is therefore a real book after a real parsing layer — not
 * XHTML hand-written for convenience — while the browser side still needs no
 * decompression and no XML parsing.
 */
export async function mountFixture(
  page: Page,
  fixture: AilmentName,
  options: MountOptions = {},
): Promise<Snapshot> {
  return page.evaluate(
    ([name, mountOptions]) => window.frond.mount(name as string, mountOptions as MountOptions),
    [fixture, options] as const,
  );
}

/**
 * The prefix that names ADR-0007's second layer — the two public-domain books in
 * `tests/books/public/`.
 *
 * A colon rather than a slash: the page asks for `/book/<name>/<kind>`, and a slash inside
 * the name would be read as another path segment.
 */
const PUBLIC_BOOK_PREFIX = "public:";

/**
 * The public-domain books, by the name `mountPublicBook` takes.
 *
 * A closed union rather than a free string: these two are the only real books in the
 * repository, and a typo in an evidence spec should be a type error rather than a 404 that
 * renders as an empty page — an empty page is exactly the kind of thing a visual reading
 * can mistake for a defect in the book.
 */
export type PublicBook = "kusamakura-vertical-japanese" | "alice-in-wonderland-horizontal";

/**
 * Mounts one of the public-domain books (ADR-0007's second layer).
 *
 * These carry no CI assertions — a real book has no correct answer to pin. What they are
 * for is the visual reading before a pull request (`docs/agents/pull-requests.md`), which
 * is the only evidence there is that real books lay out correctly rather than merely that
 * the known ailments have not come back.
 */
export async function mountPublicBook(
  page: Page,
  book: PublicBook,
  options: MountOptions = {},
): Promise<Snapshot> {
  return page.evaluate(
    ([name, mountOptions]) => window.frond.mount(name as string, mountOptions as MountOptions),
    [`${PUBLIC_BOOK_PREFIX}${book}`, options] as const,
  );
}

/** A set of reader settings can be supplied up front when mounting. */
export interface MountOptions {
  readonly settings?: SettingsPatch;
  /** The container's size. Omitted uses the shell page's default. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /**
   * Extra files the book carries, by path — a `<link rel="stylesheet">` target, say.
   *
   * `mountInline` alone gives sections and nothing else, so a book whose stylesheet is *linked*
   * rather than inline could not be expressed, and that is the one shape the transform pipeline
   * treats differently (`document-source.ts`'s ordering comment).
   */
  readonly resources?: Record<string, string>;
  /** Where in the first section to render. Corresponds to `RendererOptions.start`. */
  readonly start?:
    | { readonly cfi: string }
    | { readonly sectionIndex: number; readonly fragment?: string };
  /**
   * A `RendererOptions.resolveLayout` expressed as data: one answer per writing mode.
   *
   * A function cannot cross `page.evaluate`'s boundary, and the shape a consumer really
   * writes is a branch on the writing mode anyway (that is the fact it cannot get any
   * other way), so the page side turns this table back into the function.
   */
  readonly resolveLayout?: {
    readonly "horizontal-tb"?: LayoutPatch;
    readonly "vertical-rl"?: LayoutPatch;
  };
}

/** The two settings `resolveLayout` may answer, in serializable form. */
export interface LayoutPatch {
  readonly margin?: number | { readonly block: number; readonly inline: number };
  readonly columns?: 1 | 2 | "auto";
}

/** One call of the resolver, recorded so a spec can assert on when and with what it ran. */
export interface LayoutCall {
  readonly writingMode: "horizontal-tb" | "vertical-rl";
  readonly viewport: { readonly width: number; readonly height: number };
}

/** A serializable form of `ReaderSettings` — `page.evaluate` can only send plain data across. */
export interface SettingsPatch {
  readonly fontFamily?: string;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly margin?: number | { readonly block: number; readonly inline: number };
  readonly columns?: 1 | 2 | "auto";
  readonly theme?: {
    readonly foreground: string;
    readonly background: string;
    readonly link?: string;
  };
  readonly genericFamilies?: {
    readonly serif?: string;
    readonly sansSerif?: string;
  };
  readonly fontFaces?: readonly {
    readonly family: string;
    readonly src: string;
    readonly weight?: string;
    readonly style?: string;
  }[];
  readonly fontLanguage?: string;
}

/**
 * One measurement.
 *
 * `fraction` uses `null` rather than `undefined`: crossing `page.evaluate`'s boundary
 * makes an `undefined` field disappear entirely, so "the index is not built yet" and
 * "this field does not exist" would become the same thing.
 */
export interface Snapshot {
  readonly writingMode: "horizontal-tb" | "vertical-rl";
  readonly sectionIndex: number;
  readonly sectionPath: string;
  readonly page: number;
  readonly pageCount: number;
  readonly cfi: string;
  /** The range CFI covering the current page. `null` for a section with no text. */
  readonly pageRange: string | null;
  readonly fraction: number | null;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

/**
 * What one implementation makes of a whole section.
 *
 * Every character rather than a sample, because the failures worth catching are off-by-one at
 * a seam — the first character after an inline tag, the last before a comment, the join
 * between two text nodes — and choosing which positions to check means guessing where the
 * seams are, which is the same guess that put the bug there.
 */
export interface AddressedSection {
  /** The section's text, flattened by the whole-book index's traversal. */
  readonly text: string;
  /** The CFI of each single character, serialized. */
  readonly cfis: readonly string[];
  /** The characters each of those CFIs resolves back to. `[-1, -1]` when it will not resolve. */
  readonly resolved: readonly (readonly [number, number])[];
}

/** The page side's operating surface. Implemented in `tests/browser/support/page/frond-page.ts`. */
export interface FrondHarness {
  mount(fixture: string, options: MountOptions): Promise<Snapshot>;
  /**
   * Mounts a `MemoryBook` from hand-written XHTML, without going through any committed
   * fixture.
   *
   * This serves "will this content be handled correctly" questions — a book carrying
   * scripts, for instance. That kind of content should not become a committed fixture:
   * ADR-0007's discipline is one file per ailment, and "the book contains a script" is not
   * a layout ailment but a security property; making it a file would only add a special
   * case to every test that sweeps the fixture directory.
   *
   * This is also exactly what ADR-0002's requirement for frond to ship its own in-memory
   * implementation is for.
   */
  mountInline(sections: readonly string[], options: MountOptions): Promise<Snapshot>;
  next(): Promise<Snapshot>;
  previous(): Promise<Snapshot>;
  goToSection(index: number): Promise<Snapshot>;
  goTo(path: string, fragment?: string): Promise<Snapshot>;
  goToCfi(cfi: string): Promise<Snapshot>;
  goToFraction(fraction: number): Promise<Snapshot>;
  applySettings(patch: SettingsPatch): Promise<Snapshot>;
  resize(width: number, height: number): Promise<Snapshot>;
  /** Lays out again without touching the container size — the "an input to the resolver changed" route. */
  relayout(): Promise<Snapshot>;
  /** Every `resolveLayout` call since the mount, in order. */
  layoutCalls(): readonly LayoutCall[];
  /**
   * Presses "next page" N times, **without waiting for the previous one to land**.
   *
   * Simulates fast swiping: a consumer does not await `next()`'s promise. This is the only
   * way to measure the "N presses advance N pages" invariant — awaiting each in turn leaves
   * the queue with a single occupant, and measures nothing.
   */
  rapidNext(times: number): Promise<Snapshot>;
  /** Fires `applySettings` N times in a row without waiting — simulates dragging a slider. */
  rapidApplySettings(patches: readonly SettingsPatch[]): Promise<Snapshot>;
  /** Which section a whole-book progress falls in. `null` while the index is not built yet. */
  locate(fraction: number): SectionAtSnapshot | null;
  /** The iframe element's position and size within the container — for verifying margins. */
  frameBox(): Rect;
  snapshot(): Snapshot;
  /** Waits for the whole-book index and returns the book's character count. */
  waitForIndex(): Promise<number>;
  /** The `length` characters following the position a CFI points at. `null` when the position cannot be reached. */
  textAt(cfi: string, length: number): string | null;
  /**
   * The text a **range** CFI covers, measured by the same flattening the whole-book index
   * uses rather than by `Range.toString()`.
   *
   * The two differ: `toString()` includes the whitespace between blocks, which the index
   * skips. Measuring the way the index does is what lets a test add up the pages of a section
   * and compare the total against the section's own text.
   */
  textInRange(cfi: string): string | null;
  /**
   * Addresses **every character** of a section the way a browser does: `DOMParser`, the DOM
   * types, and the shipped `cfi-dom.ts`.
   *
   * Its counterpart runs with no browser anywhere near it (`ContentDocument`, in
   * `src/epub/content-document.ts`), and comparing the two is what
   * `cfi-cross-implementation.spec.ts` exists for — the claim that one addressing walk can
   * serve both a browser and a Worker is not something reasoning settles, because the
   * question is what a real XML parser does with real markup.
   *
   * **No way to ask for fewer characters**, deliberately. A one-off scan across the whole
   * commercial shelf wanted sampling and got it by editing this for the duration
   * (AGENTS.md's `scan:books`; that spec does not stay in the repository, and neither does
   * this knob). An option nothing committed exercises is one more way for what is run to
   * drift from what is read.
   */
  addressEveryCharacter(xml: string, sectionIndex: number): AddressedSection;
  /** A CFI's rectangles in the container's coordinate system. */
  rectsFor(cfi: string): readonly Rect[];
  /** The container's current size — needed to decide whether a rectangle is on screen. */
  containerSize(): { readonly width: number; readonly height: number };
  /** The computed style of a selector inside the current section's iframe. */
  computed(selector: string, property: string): string;
  /**
   * Wraps base64 bytes in a `Blob` and returns its address — the consumer's half of
   * `settings.fontFaces`, done where a consumer would do it: **outside the book**.
   */
  objectUrl(base64: string, type: string): string;
  /**
   * Whether the book's own document can actually load a face by that name.
   *
   * Asked of the iframe's `FontFaceSet` rather than of the injected CSS text, because the
   * question is not whether the rule was written but whether the bytes arrived: an
   * `@font-face` whose address the book's document cannot reach fails silently, and the
   * reader sees the fallback face with nothing reported anywhere.
   */
  faceLoads(family: string): Promise<boolean>;
  /** The outerHTML of the current section's iframe document — for inspecting rewrites. */
  html(): string;
  /**
   * The text of the book's own `<style>` elements, excluding the two frond appends.
   *
   * `html()` cannot answer "how many times was the book's stylesheet rewritten", because frond's
   * own layout sheet declares some of the same properties — a count over the whole document
   * measures both and can only be read by eye.
   */
  bookStylesheets(): readonly string[];
  /** The document coordinate of the first character drawn on this section's current page. */
  scrollOffset(): number;
  /** The names and payloads of the events received, in order. */
  events(): readonly EventRecord[];
  /** Selects a run of text inside the iframe, for the selection event tests. */
  selectText(selector: string): void;
  /**
   * Selects everything from the first element to the second, the way a drag across several
   * paragraphs does. Passing the same selector twice selects that one element whole.
   */
  selectAcross(startSelector: string, endSelector: string): void;
  /** Drops the selection through the renderer's own API, rather than by reaching into the iframe. */
  clearSelection(): void;
  /** Makes the page's `pointerdown` listener call `preventTapDefault()` on every press from now on. */
  preventTapDefaultOnPress(on: boolean): void;
  /**
   * What became of the `touchend` that ended the last press. `null` before the first one.
   *
   * A test cannot read this from the outside: `defaultPrevented` belongs to an event that is
   * gone by the time the tap has returned.
   */
  touchEndDefaultPrevented(): boolean | null;
  /** Clicks a link, for the linkactivate tests. */
  clickLink(selector: string): void;
  destroy(): void;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A serializable form of `Renderer.locate()`. */
export interface SectionAtSnapshot {
  readonly sectionIndex: number;
  readonly sectionPath: string;
  readonly charactersIntoSection: number;
}

export interface EventRecord {
  readonly name: string;
  readonly payload: unknown;
}

declare global {
  // eslint-disable-next-line no-var
  var frond: FrondHarness;

  interface Window {
    readonly frond: FrondHarness;
  }
}

/** The shell page. The container's size matches `playwright.config.ts`'s viewport. */
function shell(): string {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <title>frond harness</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #fff; }
      #${VIEWPORT_ID} { width: 800px; height: 600px; position: relative; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="${VIEWPORT_ID}"></div>
    <script type="module" src="/tests/browser/support/page/frond-page.ts"></script>
  </body>
</html>`;
}

/**
 * Reads one source file and strips its types.
 *
 * Only `.ts` under `src/` and `tests/` is allowed through. The restriction is not a
 * security measure (this is a local test runner) but a way to give "what the page can
 * load" a definite boundary — a mistyped path gets a 404 rather than an unexpected file.
 */
async function readSourceFile(pathname: string): Promise<string | undefined> {
  if (!pathname.endsWith(".ts")) return undefined;

  const absolute = resolve(REPO_ROOT, `.${pathname}`);
  const inside = relative(REPO_ROOT, absolute);
  if (inside.startsWith("..") || !ALLOWED_ROOTS.has(inside.split(sep)[0] ?? "")) {
    return undefined;
  }

  try {
    return stripTypeScriptTypes(await readFile(absolute, "utf8"), { mode: "strip" });
  } catch {
    return undefined;
  }
}

const ALLOWED_ROOTS = new Set(["src", "tests"]);

const FIXTURE_DIRECTORY = join(REPO_ROOT, "tests", "fixtures");
const PUBLIC_BOOK_DIRECTORY = join(REPO_ROOT, "tests", "books", "public");

/**
 * Where a mountable book's bytes are. A public-domain book is named with a `public/`
 * prefix, and everything else is a synthetic fixture.
 *
 * One namespace rather than two mount functions: the page side asks for `/book/<name>/…`
 * and should not have to know which layer of ADR-0007 the book came from, and a prefix
 * keeps the two directories from being able to shadow each other by name.
 */
function pathFor(name: string): string {
  return name.startsWith(PUBLIC_BOOK_PREFIX)
    ? join(PUBLIC_BOOK_DIRECTORY, `${name.slice(PUBLIC_BOOK_PREFIX.length)}.epub`)
    : join(FIXTURE_DIRECTORY, `${name}.epub`);
}

/** Opened books are kept, so remounting with different settings within one spec need not reopen. */
const openedBooks = new Map<string, Promise<EpubBook>>();

function bookFor(name: string): Promise<EpubBook> {
  const existing = openedBooks.get(name);
  if (existing !== undefined) return existing;

  const opening = readFile(pathFor(name)).then((bytes) => EpubBook.open(bytes));
  openedBooks.set(name, opening);
  return opening;
}

async function fulfilBookRequest(
  route: Parameters<Parameters<Page["route"]>[1]>[0],
  url: URL,
): Promise<void> {
  // `/book/<name>/manifest.json` or `/book/<name>/bytes?path=…`
  const [, , name, kind] = url.pathname.split("/");
  if (name === undefined || kind === undefined) {
    await route.fulfill({ status: 404, body: "" });
    return;
  }

  const book = await bookFor(name);

  if (kind === "manifest.json") {
    await route.fulfill({
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        readingOrder: book.readingOrder.map((section) => ({
          path: section.path,
          mediaType: section.mediaType,
          linear: section.linear,
        })),
        resources: book.resources
          .filter((resource) => resource.location.kind === "in-container")
          .map((resource) => ({
            path: resource.location.kind === "in-container" ? resource.location.path : "",
            mediaType: resource.mediaType,
          })),
      }),
    });
    return;
  }

  const path = url.searchParams.get("path");
  if (path === null) {
    await route.fulfill({ status: 400, body: "" });
    return;
  }

  try {
    await route.fulfill({
      contentType: "application/octet-stream",
      body: Buffer.from(book.bytes(path)),
    });
  } catch {
    await route.fulfill({ status: 404, body: "" });
  }
}
