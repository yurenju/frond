/**
 * 把一節的位元組變成一份 iframe 載得起來的文件。
 *
 * 內容以同源的 `blob:` 供給（ADR-0006），而這件事有一個立即的後果：**`blob:` 沒有
 * 目錄結構**。書裡每一個相對引用（圖片、樣式表、字型）在 `blob:` 底下都解析不到，
 * 所以引用要在文件還是文字的時候換成解析後的位址。這不是介入書的宣告——指向的還是
 * 同一份資源，換的只是寫法。
 *
 * ## 為什麼樣式表是內嵌而不是換成 blob: 的 `<link>`
 *
 * `<link>` 是**非同步**載入的。換成 blob: 之後它照樣非同步，於是 iframe 的 load
 * 事件可能早於樣式套用——而 frond 在 load 之後立刻量內容總長來算頁數。量到的會是
 * 沒有套樣式的版面，頁數因此是錯的，而且只在載入比較慢的時候錯。內嵌成 `<style>`
 * 讓樣式與文件同時到位，這個時序就不存在了。
 *
 * 順序原樣保留（`<link>` 在哪一個位置，`<style>` 就插在哪一個位置），因為層疊看
 * 順序。
 */

import { resolveHref } from "../epub/resource-path.ts";
import type { RenderableBook } from "./book.ts";
import {
  demoteImportant,
  demoteImportantInDeclarations,
  normalisePageBreaks,
  normalisePrefixedWritingMode,
  relativiseFontSizes,
  relativiseFontSizesInDeclarations,
  rewriteUrls,
} from "./css.ts";
import { LAYOUT_STYLE_ID, READER_STYLE_ID } from "./layout.ts";
import { overriddenProperties, readerStylesheet, type ReaderSettings } from "./settings.ts";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** 內容文件解不開時丟這個，而不是回一份半對的文件。 */
export class SectionParseError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path} 不是良構的 XHTML：${detail}`);
    this.name = "SectionParseError";
    this.path = path;
  }
}

export interface SectionDocument {
  /** 餵給 iframe 的 `blob:` 位址。 */
  readonly url: string;
  /** 這一份文件用完之後要收回的位址。資源的位址由 `ResourceUrls` 管，不在這裡。 */
  release(): void;
}

/**
 * 書內資源的 `blob:` 位址，一本書共用一份。
 *
 * 跨節共用是必要的而不是最佳化：同一張圖在相鄰兩節裡出現時，各建各的位址會讓
 * 瀏覽器重新解碼一次，而更糟的是舊的那個在換節時被收回——如果消費端還握著它
 * （例如拿去做書櫃縮圖），那個位址會突然失效。
 */
export class ResourceUrls {
  private readonly book: RenderableBook;
  private readonly settings: ReaderSettings;
  private readonly urls = new Map<string, string>();
  /** 正在解析中的樣式表，用來擋住 `@import` 的循環。 */
  private readonly resolving = new Set<string>();

  constructor(book: RenderableBook, settings: ReaderSettings) {
    this.book = book;
    this.settings = settings;
  }

  /**
   * 一個相對引用解析後的位址。
   *
   * 回 `undefined` 表示不必換：`data:` 與指向書外的絕對位址本來就用得動，而
   * 指不到東西的引用留著原樣比換成一個空位址好查。
   */
  urlFor(reference: string, fromPath: string): string | undefined {
    const resolved = resolveHref(reference, fromPath);
    if (resolved.kind !== "in-container") return undefined;

    return this.urlForPath(resolved.path);
  }

  urlForPath(path: string): string | undefined {
    const existing = this.urls.get(path);
    if (existing !== undefined) return existing;
    if (this.resolving.has(path)) return undefined;

    let bytes: Uint8Array;
    try {
      bytes = this.book.bytes(path);
    } catch {
      // 書宣告了但壓縮檔裡沒有。整本書仍然讀得完（`resources.ts` 的權衡），
      // 缺的那一項留著原樣的引用，畫面上是一張破圖。
      return undefined;
    }

    const mediaType = this.mediaTypeOf(path);
    let blob: Blob;

    if (isStylesheet(mediaType)) {
      this.resolving.add(path);
      const css = transformBookStylesheet(
        new TextDecoder().decode(bytes),
        path,
        this.settings,
        this,
      );
      this.resolving.delete(path);
      blob = new Blob([css], { type: mediaType });
    } else {
      // `Uint8Array` 直接進 Blob。`bytes.slice()` 是必要的：`Uint8Array` 可能是
      // 一個大 buffer 上的視窗，而 Blob 會收下整個 buffer。
      blob = new Blob([bytes.slice()], { type: mediaType });
    }

    const url = URL.createObjectURL(blob);
    this.urls.set(path, url);
    return url;
  }

  /**
   * 一份資源的原始位元組。
   *
   * 樣式表要內嵌（見檔頭）而不是換成位址，所以這一條路是必要的。走這裡而不是讓
   * 呼叫端自己拿 `book`，是為了讓「取一份資源」在這一層只有一個入口——缺檔的
   * 處置因此只有一種寫法。
   *
   * @throws 路徑不存在或解不開時，原樣把 `RenderableBook` 丟的錯往上送
   */
  bytesOf(path: string): Uint8Array {
    return this.book.bytes(path);
  }

  mediaTypeOf(path: string): string {
    for (const resource of this.book.resources) {
      if (resource.location.kind !== "remote" && resource.location.path === path) {
        return resource.mediaType;
      }
    }
    // manifest 沒有宣告的檔案。書不合規，但那不是拒絕渲染的理由——照副檔名猜，
    // 猜錯的代價是瀏覽器不認得那一項，與完全不給它是一樣的。
    return guessMediaType(path);
  }

  /** 全部收回。`Renderer.destroy()` 呼叫它。 */
  release(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

/**
 * 組出一節的文件。
 *
 * @throws SectionParseError 內容文件不是良構的 XHTML
 */
export function buildSectionDocument(
  book: RenderableBook,
  path: string,
  settings: ReaderSettings,
  resources: ResourceUrls,
): SectionDocument {
  const source = new TextDecoder().decode(book.bytes(path));
  const document = parseXhtml(source, path);

  stripScriptedContent(document);
  inlineStylesheets(document, path, settings, resources);
  rewriteInlineStyles(document, path, settings, resources);
  rewriteResourceReferences(document, path, resources);
  appendFrondStyles(document, settings);

  const serialised = new XMLSerializer().serializeToString(document);
  const url = URL.createObjectURL(
    new Blob([serialised], { type: "application/xhtml+xml" }),
  );

  return {
    url,
    release: () => URL.revokeObjectURL(url),
  };
}

function parseXhtml(source: string, path: string): Document {
  const parsed = new DOMParser().parseFromString(source, "application/xhtml+xml");

  // 三家都是回一份帶 parsererror 的文件而不是丟例外（`fixture-parsing.spec.ts`
  // 已經在三家各證明過一次）。
  const failure = parsed.querySelector("parsererror");
  if (failure !== null) {
    throw new SectionParseError(path, failure.textContent?.trim() ?? "解析失敗");
  }
  if (parsed.documentElement === null) {
    throw new SectionParseError(path, "沒有根元素");
  }

  return parsed;
}

/**
 * 拿掉書內的腳本。
 *
 * ADR-0006：frond **不支援** EPUB 的 scripted content，而且那是安全決策不是功能
 * 取捨。iframe 為了讓 parent 收得到事件必須帶 `allow-scripts`（WebKit bug
 * 218086，#7 已重現），於是 sandbox 擋不住書內的腳本——擋得住的只有這一步。
 *
 * `on*` 事件屬性一起拿掉：只拿掉 `<script>` 的話，`<body onload="…">` 這條路仍然
 * 是開的。
 */
function stripScriptedContent(document: Document): void {
  for (const script of [...document.getElementsByTagName("script")]) {
    script.remove();
  }

  for (const element of document.getElementsByTagName("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttributeNode(attribute);
      }
    }
  }
}

/** `<link rel="stylesheet">` 換成同一個位置上的 `<style>`。 */
function inlineStylesheets(
  document: Document,
  path: string,
  settings: ReaderSettings,
  resources: ResourceUrls,
): void {
  for (const link of [...document.getElementsByTagName("link")]) {
    const rel = link.getAttribute("rel")?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("stylesheet")) continue;

    const href = link.getAttribute("href");
    if (href === null) continue;

    const target = resolveHref(href, path);
    if (target.kind !== "in-container") continue;

    let bytes: Uint8Array;
    try {
      bytes = resources.bytesOf(target.path);
    } catch {
      // 樣式表缺檔。書仍然讀得完，只是沒有樣式——把 `<link>` 留著，讓那份文件
      // 看起來仍然是它原本的樣子（`resources.ts` 的權衡：缺檔只在 readingOrder
      // 上才致命）。
      continue;
    }

    const style = document.createElementNS(XHTML_NAMESPACE, "style");
    style.setAttribute("type", "text/css");
    const media = link.getAttribute("media");
    if (media !== null) style.setAttribute("media", media);
    style.textContent = transformBookStylesheet(
      new TextDecoder().decode(bytes),
      target.path,
      settings,
      resources,
    );

    link.replaceWith(style);
  }
}

/** `<style>` 的內容與 `style="…"` 屬性走同一套改寫。 */
function rewriteInlineStyles(
  document: Document,
  path: string,
  settings: ReaderSettings,
  resources: ResourceUrls,
): void {
  for (const style of [...document.getElementsByTagName("style")]) {
    style.textContent = transformBookStylesheet(
      style.textContent ?? "",
      path,
      settings,
      resources,
    );
  }

  const overridden = overriddenProperties(settings);
  for (const element of document.getElementsByTagName("*")) {
    const inline = element.getAttribute("style");
    if (inline === null || inline === "") continue;

    let rewritten = inline;
    if (overridden.size > 0) {
      // **這一格是讀者能不能贏的關鍵。** 層疊規則裡沒有任何位置贏得了寫在
      // style 屬性裡的 !important——外部樣式表寫再多 !important 都沒有用。
      rewritten = demoteImportantInDeclarations(rewritten, overridden);
    }
    if (settings.fontSize !== undefined) {
      rewritten = relativiseFontSizesInDeclarations(rewritten);
    }
    rewritten = rewriteUrls(rewritten, (reference) =>
      resources.urlFor(reference, path),
    );

    if (rewritten !== inline) element.setAttribute("style", rewritten);
  }
}

/** `src` / `href` / `poster` / `xlink:href` 換成 `blob:` 位址。 */
function rewriteResourceReferences(
  document: Document,
  path: string,
  resources: ResourceUrls,
): void {
  for (const element of document.getElementsByTagName("*")) {
    const name = element.localName.toLowerCase();

    // 超連結**不換**。換成 blob: 之後點下去會把 iframe 導航到另一份文件，而那
    // 會把整個渲染狀態丟掉。連結的處置在 `section-view.ts`：擋下預設行為，把
    // 「讀者按了哪一個連結」當成事實送出去，跳不跳由消費端決定（ADR-0002）。
    if (name === "a") continue;

    for (const attribute of ["src", "poster", "data"]) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const url = resources.urlFor(value, path);
      if (url !== undefined) element.setAttribute(attribute, url);
    }

    // SVG 的 `<image>` 走 xlink:href，新版走 href。兩種都認。
    for (const [namespace, attribute] of [
      [XLINK_NAMESPACE, "href"],
      [null, "href"],
    ] as const) {
      if (name !== "image" && name !== "use") continue;
      const value =
        namespace === null
          ? element.getAttribute(attribute)
          : element.getAttributeNS(namespace, attribute);
      if (value === null || value.startsWith("#")) continue;

      const url = resources.urlFor(value, path);
      if (url === undefined) continue;

      if (namespace === null) element.setAttribute(attribute, url);
      else element.setAttributeNS(namespace, attribute, url);
    }

    const srcset = element.getAttribute("srcset");
    if (srcset !== null) {
      element.setAttribute("srcset", rewriteSrcset(srcset, path, resources));
    }
  }
}

/** `srcset` 是「位址 描述子」以逗號分隔的清單。 */
function rewriteSrcset(
  srcset: string,
  path: string,
  resources: ResourceUrls,
): string {
  return srcset
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (trimmed === "") return candidate;

      const [reference, ...descriptors] = trimmed.split(/\s+/);
      if (reference === undefined) return candidate;

      const url = resources.urlFor(reference, path);
      return [url ?? reference, ...descriptors].join(" ");
    })
    .join(", ");
}

/**
 * frond 自己那兩份樣式表掛在 `<head>` 的最後面。
 *
 * 最後面是必要的：層疊在優先權相同時比順序，而讀者設定要贏過書的宣告。分頁那份
 * 全部帶 `!important` 又是 frond 自己的地板，順序對它不重要，但兩份放一起讀起來
 * 比較清楚。
 *
 * 版面那一份此刻是**空的**：它的內容要等文件載進 iframe、量到書寫方向之後才算得
 * 出來（`section-view.ts`）。先把元素放好，之後只要換 `textContent`——換內容不會
 * 重新解析文件，也就不會把讀者的捲動位置洗掉。
 */
function appendFrondStyles(document: Document, settings: ReaderSettings): void {
  const head = document.head ?? document.documentElement;

  const reader = document.createElementNS(XHTML_NAMESPACE, "style");
  reader.setAttribute("id", READER_STYLE_ID);
  reader.textContent = readerStylesheet(settings);
  head.append(reader);

  const layout = document.createElementNS(XHTML_NAMESPACE, "style");
  layout.setAttribute("id", LAYOUT_STYLE_ID);
  head.append(layout);
}

/** 書的樣式表要走的每一個改寫，順序固定。 */
function transformBookStylesheet(
  css: string,
  fromPath: string,
  settings: ReaderSettings,
  resources: ResourceUrls,
): string {
  // 前綴與斷點的正規化先做：它們只補宣告，不動既有的文字，所以放在最前面時後面
  // 每一個改寫都會看到補出來的那幾條（例如補出來的 `writing-mode` 也該被算進
  // 「這份樣式表宣告了什麼」）。
  let output = normalisePrefixedWritingMode(css);
  output = normalisePageBreaks(output);

  const overridden = overriddenProperties(settings);
  if (overridden.size > 0) output = demoteImportant(output, overridden);
  if (settings.fontSize !== undefined) output = relativiseFontSizes(output);

  return rewriteUrls(output, (reference) => resources.urlFor(reference, fromPath));
}

function isStylesheet(mediaType: string): boolean {
  return mediaType.split(";")[0]?.trim().toLowerCase() === "text/css";
}

/**
 * manifest 沒有宣告 media type 時照副檔名猜。
 *
 * 只放實際會影響瀏覽器行為的那幾種。猜不到時回空字串——`Blob` 收得下，瀏覽器會
 * 依內容嗅探，而那與完全不給型別是同一件事。
 */
function guessMediaType(path: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return extension === undefined ? "" : (EXTENSION_MEDIA_TYPES.get(extension) ?? "");
}

const EXTENSION_MEDIA_TYPES = new Map([
  ["css", "text/css"],
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["otf", "font/otf"],
  ["png", "image/png"],
  ["svg", "image/svg+xml"],
  ["ttf", "font/ttf"],
  ["webp", "image/webp"],
  ["woff", "font/woff"],
  ["woff2", "font/woff2"],
  ["xhtml", "application/xhtml+xml"],
]);
