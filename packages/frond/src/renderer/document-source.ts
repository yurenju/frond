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
  inlineImports,
  normalisePageBreaks,
  normalisePrefixedWritingMode,
  relativiseFontSizes,
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
  /**
   * 正在解析中的樣式表，用來擋住循環。
   *
   * `@import` 的循環**不走這裡**——那一條由 `expandImports` 自己的 `visiting` 擋，
   * 因為它遞迴的是文字而不是位址。這一格擋的是另一條路：一份樣式表用 `url()`
   * 指向另一份樣式表。
   */
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
  const build: SectionBuild = {
    document: parseXhtml(source, path),
    path,
    settings,
    resources,
  };

  stripScriptedContent(build.document);
  inlineStylesheets(build);
  rewriteInlineStyles(build);
  rewriteResourceReferences(build);
  appendFrondStyles(build);

  const serialised = new XMLSerializer().serializeToString(build.document);
  const url = URL.createObjectURL(
    new Blob([serialised], { type: "application/xhtml+xml" }),
  );

  return {
    url,
    release: () => URL.revokeObjectURL(url),
  };
}

/**
 * 組一節文件的每一步共用的東西。
 *
 * 這四樣一路一起傳，所以它們是一個型別而不是四個參數——多一步改寫時要動的是這個
 * 介面，而不是每一支函式的簽章。
 */
interface SectionBuild {
  readonly document: Document;
  /** 這一節在壓縮檔內的路徑。書裡每一個相對引用都相對於它解析。 */
  readonly path: string;
  readonly settings: ReaderSettings;
  readonly resources: ResourceUrls;
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
 * 拿掉書內所有跑得起來的東西。
 *
 * ADR-0006：frond **不支援** EPUB 的 scripted content，而且那是安全決策不是功能
 * 取捨。iframe 為了讓 parent 收得到事件必須帶 `allow-scripts`（WebKit bug
 * 218086，#7 已重現），於是 sandbox 擋不住書內的腳本——擋得住的只有這一步。
 *
 * 三件事一起拿，少任何一件這道防線就是漏的：
 *
 * 1. **`<script>`**，任何命名空間。用 `getElementsByTagNameNS("*", …)` 而不是
 *    `getElementsByTagName`：SVG 裡的 `<script>` 在另一個命名空間，而 SVG 是
 *    EPUB 內容文件裡完全合法的一部分。
 * 2. **`on*` 事件屬性**。只拿掉 `<script>` 的話，`<body onload="…">` 這條路還開著。
 * 3. **巢狀的瀏覽環境**（`<iframe>` / `<object>` / `<embed>` / `<frame>`）。
 *
 * 第三項最容易漏，而它的後果最嚴重：**巢狀的瀏覽環境會繼承 parent 的 sandbox
 * 旗標**，也就是連同 `allow-scripts` 一起繼承；而 frond 把內容以 `blob:` 供給，
 * 那個來源就是消費端 app 自己的來源。所以一份 `<iframe src="ch2.xhtml">` 或
 * `<object data="x.svg">` 裡的腳本會**以 app 的來源執行**——第 1、2 項在那份
 * 巢狀文件上一次都沒有套用過，因為它們只清理最外層那一份。
 *
 * 拿掉而不是改寫成一個安全的來源：EPUB 3 允許 `<iframe>`，但 frond 不支援
 * scripted content 這件事是 ADR-0006 定的「不會做」而不是「還沒做」，而一個載不
 * 出內容的 iframe 與沒有 iframe 對讀者是同一件事。
 */
function stripScriptedContent(document: Document): void {
  for (const element of [
    ...document.getElementsByTagNameNS("*", "script"),
    ...EMBEDDED_CONTEXTS.flatMap((name) => [
      ...document.getElementsByTagNameNS("*", name),
    ]),
  ]) {
    element.remove();
  }

  for (const element of document.getElementsByTagName("*")) {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on")) {
        element.removeAttributeNode(attribute);
      }
    }
  }
}

/**
 * 會開出一個巢狀瀏覽環境的元素。
 *
 * `<object>` 也在裡面，儘管它常常只是拿來放圖片的：它的 `data` 指向 XHTML 或
 * SVG 時同樣會開出瀏覽環境，而「這一份 `<object>` 裝的是什麼」要載進來才知道。
 */
const EMBEDDED_CONTEXTS = ["iframe", "object", "embed", "frame"];

/** `<link rel="stylesheet">` 換成同一個位置上的 `<style>`。 */
function inlineStylesheets({ document, path, settings, resources }: SectionBuild): void {
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
function rewriteInlineStyles({
  document,
  path,
  settings,
  resources,
}: SectionBuild): void {
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
      rewritten = demoteImportant(rewritten, overridden, "declarations");
    }
    if (settings.fontSize !== undefined) {
      rewritten = relativiseFontSizes(rewritten, "declarations");
    }
    rewritten = rewriteUrls(rewritten, (reference) =>
      resources.urlFor(reference, path),
    );

    if (rewritten !== inline) element.setAttribute("style", rewritten);
  }
}

/** `src` / `href` / `poster` / `xlink:href` 換成 `blob:` 位址。 */
function rewriteResourceReferences({ document, path, resources }: SectionBuild): void {
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
function appendFrondStyles({ document, settings }: SectionBuild): void {
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
  // `@import` **最先展開**，理由與 `<link>` 內嵌是同一個（見檔頭），外加一個：
  // 展開之後底下每一個改寫都會看到被 import 進來的那幾條宣告。四本樣本書的
  // `writing-mode` 就長在那裡，少了這一步它們整本排成橫排（`css.ts` 的
  // `inlineImports`）。
  let output = expandImports(css, fromPath, resources, new Set([fromPath]));

  // 前綴與斷點的正規化接著做：它們只補宣告，不動既有的文字，所以放在前面時後面
  // 每一個改寫都會看到補出來的那幾條（例如補出來的 `writing-mode` 也該被算進
  // 「這份樣式表宣告了什麼」）。
  output = normalisePrefixedWritingMode(output);
  output = normalisePageBreaks(output);

  const overridden = overriddenProperties(settings);
  if (overridden.size > 0) output = demoteImportant(output, overridden);
  if (settings.fontSize !== undefined) output = relativiseFontSizes(output);

  return rewriteUrls(output, (reference) => resources.urlFor(reference, fromPath));
}

/**
 * 遞迴展開 `@import`，把每一份被 import 的樣式表就地換成它的內容。
 *
 * ## 為什麼只有 `url()` 在這裡換掉，其餘的改寫留給上面那一輪
 *
 * 相對位址是**唯一一項與「這段文字出自哪一個檔案」有關的改寫**：`a.css` 裡的
 * `url(fonts/x.woff)` 指的是 `a.css` 旁邊那個目錄，展開之後那個基準就消失了。
 * 所以它必須在這裡、以被 import 那一份自己的路徑為基準做完。
 *
 * 其餘的改寫（前綴、斷點、`!important`、字級）與檔案位置無關，留給合併後那一輪
 * 一次做完——每一條宣告因此**恰好被改寫一次**。在這裡也做一遍的話，合併後那一
 * 輪會再看到同樣的宣告，於是補出來的 `writing-mode` 與 `break-*` 會出現兩份。
 * 那不會改變畫面，但會讓「frond 動過什麼」這個問題的答案變得難讀，而那份文字是
 * 查問題時唯一看得到的東西。
 *
 * 展開後的 `blob:` 位址不怕被上一輪的 `rewriteUrls` 再看一次：`blob:` 是絕對
 * URL，`resolveHref` 判它不在封裝內，於是原樣留著（`resource-path.ts`）。
 *
 * @param visiting 正在展開中的路徑。循環（`a.css` import `b.css` import `a.css`）
 *   時那一條 `@import` 原樣留著，而不是無限遞迴下去。
 */
function expandImports(
  css: string,
  fromPath: string,
  resources: ResourceUrls,
  visiting: Set<string>,
): string {
  return inlineImports(css, (reference) => {
    const target = resolveHref(reference, fromPath);
    if (target.kind !== "in-container") return undefined;
    if (visiting.has(target.path)) return undefined;

    let bytes: Uint8Array;
    try {
      bytes = resources.bytesOf(target.path);
    } catch {
      // 書宣告了但壓縮檔裡沒有。與缺一份 `<link>` 的樣式表同一個處置：那一份的
      // 規則沒有了，書仍然讀得完（`resources.ts` 的權衡）。
      return undefined;
    }

    visiting.add(target.path);
    const expanded = expandImports(
      new TextDecoder().decode(bytes),
      target.path,
      resources,
      visiting,
    );
    visiting.delete(target.path);

    return rewriteUrls(expanded, (inner) => resources.urlFor(inner, target.path));
  });
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
