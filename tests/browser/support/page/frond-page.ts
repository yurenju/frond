import { parseCfi } from "../../../../packages/frond/src/epub/cfi.ts";
import { rangeForCfi } from "../../../../packages/frond/src/renderer/cfi-dom.ts";
import {
  MemoryBook,
  Renderer,
  type ReaderSettings,
  type RenderableBook,
} from "../../../../packages/frond/src/renderer/index.ts";
import { textNodesIn } from "../../../../packages/frond/src/renderer/text-index.ts";
import type {
  EventRecord,
  FrondHarness,
  MountOptions,
  Rect,
  SectionAtSnapshot,
  SettingsPatch,
  Snapshot,
} from "../harness.ts";

/**
 * The browser side's operating surface.
 *
 * It runs inside the page, so it can see `Renderer`'s actual objects; the spec side only
 * gets serializable snapshots. That division is deliberate — sending a `Renderer`
 * instance across `page.evaluate`'s boundary is impossible, and letting each spec write
 * its own `page.evaluate` to poke at it would scatter "how to measure" across a dozen
 * places, which then drift apart.
 *
 * Beyond the public surface (`src/renderer/index.ts`), this also imports two internal
 * modules (`cfi-dom.ts`, `text-index.ts`). Those are for measurement, not for product:
 * they answer "what text does this CFI point at", and that question should not become a
 * public API for the tests' sake.
 */

const VIEWPORT_ID = "viewport";

let renderer: Renderer | undefined;
let recorded: EventRecord[] = [];
let indexed: Promise<number> | undefined;

const harness: FrondHarness = {
  async mount(fixture, options: MountOptions): Promise<Snapshot> {
    return attach(await loadBook(fixture), options);
  },

  async mountInline(sections, options: MountOptions): Promise<Snapshot> {
    return attach(
      MemoryBook.of({
        sections: sections.map((content, index) => ({
          path: `inline-${index + 1}.xhtml`,
          content,
        })),
      }),
      options,
    );
  },

  async next(): Promise<Snapshot> {
    await active().next();
    return snapshot();
  },

  async previous(): Promise<Snapshot> {
    await active().previous();
    return snapshot();
  },

  async goToSection(index): Promise<Snapshot> {
    await active().goToSection(index);
    return snapshot();
  },

  async goTo(path, fragment): Promise<Snapshot> {
    await active().goTo({ path, fragment });
    return snapshot();
  },

  async goToCfi(cfi): Promise<Snapshot> {
    await active().goToCfi(cfi);
    return snapshot();
  },

  async goToFraction(fraction): Promise<Snapshot> {
    await active().goToFraction(fraction);
    return snapshot();
  },

  async applySettings(patch): Promise<Snapshot> {
    await active().applySettings(toSettings(patch));
    return snapshot();
  },

  /**
   * **Deliberately not awaited one at a time.** They are all fired first and awaited
   * together, because what is being measured is precisely "the next one arrives before the
   * previous has landed" — awaiting each in turn leaves the queue with a single occupant.
   */
  async rapidNext(times): Promise<Snapshot> {
    const renderer = active();
    const turns: Promise<void>[] = [];
    for (let index = 0; index < times; index += 1) turns.push(renderer.next());
    await Promise.all(turns);
    return snapshot();
  },

  async rapidApplySettings(patches): Promise<Snapshot> {
    const renderer = active();
    await Promise.all(patches.map((patch) => renderer.applySettings(toSettings(patch))));
    return snapshot();
  },

  locate(fraction): SectionAtSnapshot | null {
    return active().locate(fraction) ?? null;
  },

  frameBox(): Rect {
    const container = document.getElementById(VIEWPORT_ID);
    const frame = container?.querySelector("iframe");
    if (!(frame instanceof HTMLIFrameElement)) return { x: 0, y: 0, width: 0, height: 0 };

    return {
      x: frame.offsetLeft,
      y: frame.offsetTop,
      width: frame.clientWidth,
      height: frame.clientHeight,
    };
  },

  async resize(width, height): Promise<Snapshot> {
    const container = document.getElementById(VIEWPORT_ID);
    if (container === null) throw new Error("the shell page has no container element");

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    await active().resize();
    return snapshot();
  },

  snapshot,

  async waitForIndex(): Promise<number> {
    if (indexed === undefined) throw new Error("no book has been mounted yet");
    return indexed;
  },

  textAt(cfi, length): string | null {
    const document = contentDocument();
    if (document === undefined) return null;

    const range = rangeForCfi(document, parseCfi(cfi));
    if (range === undefined) return null;

    const nodes = textNodesIn(document);
    const startIndex = nodes.indexOf(range.startContainer as Text);
    if (startIndex === -1) return null;

    let text = (nodes[startIndex]?.data ?? "").slice(range.startOffset);
    for (let index = startIndex + 1; text.length < length && index < nodes.length; index += 1) {
      text += nodes[index]?.data ?? "";
    }

    return text.slice(0, length);
  },

  rectsFor(cfi): readonly Rect[] {
    return active()
      .rectsFor(cfi)
      .map((rect) => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
  },

  containerSize(): { width: number; height: number } {
    const container = document.getElementById(VIEWPORT_ID);
    return {
      width: container?.clientWidth ?? 0,
      height: container?.clientHeight ?? 0,
    };
  },

  computed(selector, property): string {
    const document = contentDocument();
    if (document === undefined) return "";

    const element = document.querySelector(selector);
    if (element === null) return "";

    const view = document.defaultView;
    if (view === null) return "";

    return view.getComputedStyle(element).getPropertyValue(property);
  },

  html(): string {
    return contentDocument()?.documentElement.outerHTML ?? "";
  },

  scrollOffset(): number {
    const document = contentDocument();
    if (document === undefined) return 0;

    return active().writingMode === "vertical-rl"
      ? document.documentElement.scrollTop
      : document.documentElement.scrollLeft;
  },

  events(): readonly EventRecord[] {
    return recorded;
  },

  selectText(selector): void {
    const document = contentDocument();
    if (document === undefined) return;

    const element = document.querySelector(selector);
    if (element === null) return;

    const range = document.createRange();
    range.selectNodeContents(element);

    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  },

  clickLink(selector): void {
    const document = contentDocument();
    if (document === undefined) return;

    const element = document.querySelector(selector);
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  },

  destroy(): void {
    renderer?.destroy();
    renderer = undefined;
  },
};

Object.defineProperty(window, "frond", { value: harness, configurable: true });

/** Mounts a book. Shared by `mount` and `mountInline` — they differ only in where the book comes from. */
async function attach(book: RenderableBook, options: MountOptions): Promise<Snapshot> {
  renderer?.destroy();
  recorded = [];

  const container = document.getElementById(VIEWPORT_ID);
  if (container === null) throw new Error("the shell page has no container element");

  if (options.viewport !== undefined) {
    container.style.width = `${options.viewport.width}px`;
    container.style.height = `${options.viewport.height}px`;
  }

  let resolveIndexed = (_characters: number): void => {};
  indexed = new Promise<number>((resolve) => {
    resolveIndexed = resolve;
  });

  const record =
    (name: string) =>
    (payload: unknown): void => {
      recorded.push({ name, payload: JSON.parse(JSON.stringify(payload)) });
    };

  // Hooked up through `options.on` rather than `on()` after attaching: the first section's
  // load and relocate are emitted inside attach, and a listener added afterwards misses
  // them.
  renderer = await Renderer.attach(book, container, {
    settings: toSettings(options.settings),
    start: options.start,
    on: {
      relocate: record("relocate"),
      load: record("load"),
      layout: record("layout"),
      linkactivate: record("linkactivate"),
      error: record("error"),
      selection: record("selection"),
      pointerdown: record("pointerdown"),
      pointerup: record("pointerup"),
      keydown: record("keydown"),
      keyup: record("keyup"),
      indexed: (event) => {
        record("indexed")(event);
        resolveIndexed(event.characters);
      },
    },
  });

  return snapshot();
}

function active(): Renderer {
  if (renderer === undefined) throw new Error("no book has been mounted yet");
  return renderer;
}

function snapshot(): Snapshot {
  const current = active();
  const location = current.location;

  return {
    writingMode: current.writingMode,
    sectionIndex: location.sectionIndex,
    sectionPath: location.sectionPath,
    page: location.page,
    pageCount: location.pageCount,
    cfi: location.cfi,
    fraction: location.fraction ?? null,
    atStart: location.atStart,
    atEnd: location.atEnd,
  };
}

function contentDocument(): Document | undefined {
  const frame = document.querySelector(`#${VIEWPORT_ID} iframe`);
  if (!(frame instanceof HTMLIFrameElement)) return undefined;
  return frame.contentDocument ?? undefined;
}

/**
 * The plain object the spec sends over is already a partial setting, passed straight
 * down.
 *
 * **Do not fill it out into a complete setting here**: `applySettings` means "replace
 * only the fields mentioned", and filling it out would reset the unmentioned fields to
 * their defaults — so in a spec with two `applySettings` calls in a row, the second would
 * silently undo the first.
 */
function toSettings(patch: SettingsPatch | undefined): Partial<ReaderSettings> {
  return patch === undefined ? {} : (patch as Partial<ReaderSettings>);
}

/**
 * Fetches a book file by file from the harness's routes and assembles a `MemoryBook`.
 *
 * The book was opened with `EpubBook` on the Node side, so what arrives here is **a real
 * book after a real parsing layer** — obfuscated fonts already restored, hrefs already
 * normalized — while this browser side needs no decompression and no XML parsing.
 */
async function loadBook(fixture: string): Promise<RenderableBook> {
  const manifest = (await (await fetch(`/book/${fixture}/manifest.json`)).json()) as {
    readingOrder: Array<{ path: string; mediaType: string; linear: boolean }>;
    resources: Array<{ path: string; mediaType: string }>;
  };

  const bytesFor = async (path: string): Promise<Uint8Array> =>
    new Uint8Array(
      await (await fetch(`/book/${fixture}/bytes?path=${encodeURIComponent(path)}`)).arrayBuffer(),
    );

  const sectionPaths = new Set(manifest.readingOrder.map((section) => section.path));

  const sections = await Promise.all(
    manifest.readingOrder.map(async (section) => ({
      path: section.path,
      mediaType: section.mediaType,
      linear: section.linear,
      content: await bytesFor(section.path),
    })),
  );

  const resources = await Promise.all(
    manifest.resources
      .filter((resource) => !sectionPaths.has(resource.path))
      .map(async (resource) => ({
        path: resource.path,
        mediaType: resource.mediaType,
        bytes: await bytesFor(resource.path),
      })),
  );

  return MemoryBook.of({ sections, resources });
}
