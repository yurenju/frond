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
 * 瀏覽器那一側的操作面。
 *
 * 它跑在頁面裡，所以它看得到 `Renderer` 實際的物件；spec 那一側只拿得到可序列化
 * 的快照。這個分工是刻意的——把 `Renderer` 的實例往 `page.evaluate` 的邊界外送
 * 是不可能的，而每支 spec 各自寫一段 `page.evaluate` 去戳它，會讓「怎麼量」散在
 * 十幾個地方，然後彼此漂開。
 *
 * 這裡除了公開面（`src/renderer/index.ts`）之外也 import 了兩支內部模組
 * （`cfi-dom.ts`、`text-index.ts`）。那是量測用的，不是產品用的：它們回答「這個
 * CFI 指到的文字是什麼」，而那個問題不該為了測試而變成公開 API。
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
   * **刻意不逐次 await。** 全部發出去之後才一起等，因為要測的正是「前一次還沒
   * 落地就來了下一次」——逐次 await 的話佇列裡永遠只有一個人。
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
    if (container === null) throw new Error("外殼頁面沒有容器元素");

    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    await active().resize();
    return snapshot();
  },

  snapshot,

  async waitForIndex(): Promise<number> {
    if (indexed === undefined) throw new Error("還沒掛任何一本書");
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

/** 掛一本書。`mount` 與 `mountInline` 共用——差別只在書從哪裡來。 */
async function attach(book: RenderableBook, options: MountOptions): Promise<Snapshot> {
  renderer?.destroy();
  recorded = [];

  const container = document.getElementById(VIEWPORT_ID);
  if (container === null) throw new Error("外殼頁面沒有容器元素");

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

  // 從 `options.on` 掛而不是 attach 之後再 `on()`：第一節的 load 與 relocate
  // 是在 attach 裡面送的，事後掛就收不到了。
  renderer = await Renderer.attach(book, container, {
    settings: toSettings(options.settings),
    start: options.start,
    on: {
      relocate: record("relocate"),
      load: record("load"),
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
  if (renderer === undefined) throw new Error("還沒掛任何一本書");
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
 * spec 送過來的純物件就是一份局部設定，原樣往下傳。
 *
 * **不要在這裡補成完整的設定**：`applySettings` 的語意是「只換提到的那幾項」，
 * 補完之後沒提到的欄位會被打回預設值，於是 spec 裡連續兩次 `applySettings` 的
 * 第二次會靜默地取消第一次。
 */
function toSettings(patch: SettingsPatch | undefined): Partial<ReaderSettings> {
  return patch === undefined ? {} : (patch as Partial<ReaderSettings>);
}

/**
 * 從 harness 的路由把一本書逐檔取回來，組成 `MemoryBook`。
 *
 * 書在 Node 那一側用 `EpubBook` 開好，所以這裡拿到的是**實際的書經過實際的解析層
 * 之後**的內容——混淆字型已經還原、href 已經正規化——而瀏覽器這一側不需要解壓
 * 與 XML 解析。
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
