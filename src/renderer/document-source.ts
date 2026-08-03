/**
 * Turning a section's bytes into a document an iframe can load.
 *
 * Content is served as same-origin `blob:` (ADR-0006), and that has one immediate
 * consequence: **`blob:` has no directory structure**. Every relative reference in the
 * book (images, stylesheets, fonts) fails to resolve under `blob:`, so references have to
 * be swapped for resolved addresses while the document is still text. This is not
 * intervening in the book's declarations — the target is still the same resource, only the
 * notation changes.
 *
 * ## Why stylesheets are inlined rather than turned into a blob: `<link>`
 *
 * A `<link>` loads **asynchronously**. Rewritten to blob: it is still asynchronous, so the
 * iframe's load event may precede the styles being applied — and frond measures the total
 * content length to compute the page count immediately after load. What gets measured is an
 * unstyled layout, so the page count is wrong, and only when loading happens to be slow.
 * Inlining into a `<style>` makes styles and document arrive together, and that timing
 * simply does not exist.
 *
 * The order is preserved verbatim (the `<style>` is spliced in wherever the `<link>` was),
 * because the cascade goes by order.
 */

import { resolveHref } from "../epub/resource-path.ts";
import type { RenderableBook } from "./book.ts";
import {
  demoteImportant,
  inlineImports,
  normalisePageBreaks,
  normalisePrefixedWritingMode,
  relativiseFontSizes,
  resolveGenericFamilies,
  rewriteUrls,
} from "./css.ts";
import { LAYOUT_STYLE_ID, READER_STYLE_ID } from "./layout.ts";
import { overriddenProperties, readerStylesheet, type ReaderSettings } from "./settings.ts";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/** Thrown when a content document will not parse, rather than returning a half-right document. */
export class SectionParseError extends Error {
  readonly path: string;

  constructor(path: string, detail: string) {
    super(`${path} is not well-formed XHTML: ${detail}`);
    this.name = "SectionParseError";
    this.path = path;
  }
}

export interface SectionDocument {
  /** The `blob:` address fed to the iframe. */
  readonly url: string;
  /** Revokes the address once this document is done with. Resource addresses are managed by `ResourceUrls`, not here. */
  release(): void;
}

/**
 * The `blob:` addresses of resources inside a book, shared across the whole book.
 *
 * Sharing across sections is necessary rather than an optimisation: when the same image
 * appears in two adjacent sections, separate addresses would make the browser decode it
 * again, and worse, the old one is revoked on the section change — and if the consumer is
 * still holding it (using it for a bookshelf thumbnail, say), that address would suddenly
 * become invalid.
 */
export class ResourceUrls {
  private readonly book: RenderableBook;
  private readonly settings: ReaderSettings;
  private readonly urls = new Map<string, string>();
  /**
   * The stylesheets currently being resolved, used to block cycles.
   *
   * `@import` cycles **do not come through here** — those are blocked by `expandImports`'s
   * own `visiting`, because it recurses over text rather than addresses. What this blocks
   * is a different route: one stylesheet pointing at another with `url()`.
   */
  private readonly resolving = new Set<string>();

  constructor(book: RenderableBook, settings: ReaderSettings) {
    this.book = book;
    this.settings = settings;
  }

  /**
   * The address a relative reference resolves to.
   *
   * Returning `undefined` means no swap is needed: `data:` URIs and absolute addresses
   * pointing outside the book work as they are, and a reference that points at nothing is
   * easier to investigate left verbatim than rewritten to an empty address.
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
      // Declared by the book but absent from the archive. The whole book still reads
      // through to the end (`resources.ts`'s trade-off); the missing item keeps its
      // reference verbatim, and on screen it is a broken image.
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
      // The `Uint8Array` goes straight into a Blob. The `bytes.slice()` is necessary: a
      // `Uint8Array` may be a window onto a large buffer, and a Blob would take the whole
      // buffer.
      blob = new Blob([bytes.slice()], { type: mediaType });
    }

    const url = URL.createObjectURL(blob);
    this.urls.set(path, url);
    return url;
  }

  /**
   * A resource's raw bytes.
   *
   * Stylesheets have to be inlined (see the file header) rather than swapped for an
   * address, so this route is necessary. It goes through here rather than letting callers
   * reach `book` themselves, so that "take a resource" has exactly one entry point at this
   * layer — and therefore only one way of handling a missing file.
   *
   * @throws passes on whatever `RenderableBook` throws when the path does not exist or will not decode
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
    // A file the manifest never declared. The book is non-conforming, but that is no reason
    // to refuse to render — guess from the extension; the cost of guessing wrong is the
    // browser not recognising that item, which is the same as giving it no type at all.
    return guessMediaType(path);
  }

  /** Revokes them all. `Renderer.destroy()` calls it. */
  release(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

/**
 * Assembles one section's document.
 *
 * @throws SectionParseError the content document is not well-formed XHTML
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
  // **`rewriteInlineStyles` goes first, and the order is load-bearing.** It walks every
  // `<style>` in the document, and `inlineStylesheets` *creates* `<style>` elements out of
  // `<link rel="stylesheet">` — already transformed. Run the other way round, every linked
  // stylesheet in the book is transformed **twice**.
  //
  // Twice was survivable for as long as every rewrite happened to be idempotent, and it was
  // never free: a book declaring `-epub-writing-mode: vertical-rl` came out carrying
  // `writing-mode: vertical-rl` twice over, because the prefix rule matched again on the second
  // pass and appended a second copy.
  //
  // `resolveGenericFamilies` is where it stopped being survivable. That rewrite keeps the
  // generic keyword as the last resort, so after one pass the value **still contains the
  // keyword** — and a second pass substitutes the whole stack again, in front of it. What the
  // book gets is the reader's stack twice, with `serif` sitting in the middle of the list where
  // nothing after it can ever be reached.
  rewriteInlineStyles(build);
  inlineStylesheets(build);
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
 * What every step of assembling a section's document shares.
 *
 * These four travel together throughout, so they are one type rather than four parameters —
 * adding another rewrite means changing this interface rather than every function's
 * signature.
 */
interface SectionBuild {
  readonly document: Document;
  /** This section's path inside the archive. Every relative reference in the book resolves against it. */
  readonly path: string;
  readonly settings: ReaderSettings;
  readonly resources: ResourceUrls;
}

function parseXhtml(source: string, path: string): Document {
  const parsed = new DOMParser().parseFromString(source, "application/xhtml+xml");

  // All three return a document containing a parsererror rather than throwing
  // (`fixture-parsing.spec.ts` has demonstrated this once in each of the three).
  const failure = parsed.querySelector("parsererror");
  if (failure !== null) {
    throw new SectionParseError(path, failure.textContent?.trim() ?? "parse failed");
  }
  if (parsed.documentElement === null) {
    throw new SectionParseError(path, "no root element");
  }

  return parsed;
}

/**
 * Empties everything inside the book that could run.
 *
 * ADR-0006: frond **does not support** EPUB scripted content, and that is a security
 * decision rather than a feature trade-off. The iframe has to carry `allow-scripts` for the
 * parent to receive events (WebKit bug 218086, reproduced in #7), so the sandbox cannot
 * stop scripts inside the book — this step is the only thing that can.
 *
 * Three things are dealt with together, and missing any one leaves the defence with a hole:
 *
 * 1. **`<script>`**, in any namespace. Using `getElementsByTagNameNS("*", …)` rather than
 *    `getElementsByTagName`: a `<script>` inside SVG is in a different namespace, and SVG
 *    is an entirely legal part of an EPUB content document.
 * 2. **`on*` event attributes**. Emptying only `<script>` leaves `<body onload="…">` open.
 * 3. **Nested browsing contexts** (`<iframe>` / `<object>` / `<embed>` / `<frame>`).
 *
 * The third is the easiest to miss and has the worst consequence: **a nested browsing
 * context inherits the parent's sandbox flags**, `allow-scripts` included; and frond serves
 * content as `blob:`, whose origin is the consuming app's own origin. So a script inside an
 * `<iframe src="ch2.xhtml">` or an `<object data="x.svg">` would **run with the app's
 * origin** — items 1 and 2 having never once been applied to that nested document, since
 * they only clean the outermost one.
 *
 * They are emptied rather than rewritten to a safe origin: EPUB 3 permits `<iframe>`, but
 * frond not supporting scripted content is a "will not do" set by ADR-0006 rather than a
 * "not yet", and to the reader an iframe whose content will not load is the same as no
 * iframe.
 *
 * ## Emptied, not removed — because a CFI is a sibling ordinal
 *
 * `element.remove()` would be the obvious spelling and is the wrong one. `childAt` in
 * `epub/cfi-tree.ts` numbers an element by its position **among its siblings**, so removing one
 * takes two off the index of everything after it. The damage runs both ways and is silent
 * either way: frond's own CFIs stop meaning what other readers think they mean, and a CFI
 * written elsewhere resolves inside frond to a **different sentence** rather than failing.
 * Progress and annotations are stored as CFIs, so that is the whole of what breaks (#65).
 */
function stripScriptedContent(document: Document): void {
  for (const script of [...document.getElementsByTagNameNS("*", "script")]) {
    emptyInPlace(script);
  }

  for (const name of EMBEDDED_CONTEXTS) {
    for (const context of [...document.getElementsByTagNameNS("*", name)]) {
      emptyInPlace(context);

      // Removal used to take the box away along with the element. These four are replaced
      // elements: an `<iframe>` with no `src` still lays out at its default 300x150, which
      // would put a hole in the text where the book had none. A style attribute is used
      // rather than a rule in frond's own sheet because no stylesheet of the book's can
      // outrank it, however it is written.
      //
      // **It has to survive `rewriteInlineStyles`, which runs after this step and rewrites
      // every style attribute in the document.** It does today because `display` is not one
      // of the properties `overriddenProperties` collects (`settings.ts`) — those are
      // typography and theme. Should `display` ever join them, `demoteImportant` would drop
      // the `!important` here and a book could take the hiding back.
      context.setAttribute("style", "display: none !important");

      // Belt to `emptyInPlace`'s braces, and only `<iframe>` honours the attribute. With no
      // `src` it still gets an `about:blank`, same-origin and inheriting `allow-scripts`;
      // nothing in the book can reach that document once items 1 and 2 above have run, but
      // an empty `sandbox` is the strictest setting there is and costs nothing to write.
      if (name === "iframe") context.setAttribute("sandbox", "");
    }
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
 * Strips an element down to its name and its position: no attributes, no children.
 *
 * That is what makes the remaining element inert. A `<script>` is prepared once, when the
 * document is parsed; with neither `src` nor text there is nothing to prepare. An
 * `<iframe>` / `<object>` / `<embed>` addresses a document through `src` / `data` /
 * `srcdoc`, and an `<object>` falls back to its children — all four are gone. Nothing is
 * added back afterwards either: `rewriteResourceReferences` only rewrites attributes that
 * are **already there**, and this step runs before it.
 */
function emptyInPlace(element: Element): void {
  for (const attribute of [...element.attributes]) {
    element.removeAttributeNode(attribute);
  }
  element.replaceChildren();
}

/**
 * The elements that open a nested browsing context.
 *
 * `<object>` is included even though it is often only used to hold an image: when its
 * `data` points at XHTML or SVG it opens a browsing context just the same, and knowing what
 * a given `<object>` holds requires loading it.
 */
const EMBEDDED_CONTEXTS = ["iframe", "object", "embed", "frame"];

/** `<link rel="stylesheet">` is replaced by a `<style>` at the same position. */
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
      // The stylesheet's file is missing. The book still reads through to the end, just
      // unstyled — the `<link>` is left in place so the document still looks like what it
      // originally was (`resources.ts`'s trade-off: a missing file is only fatal on the
      // readingOrder).
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

/** `<style>` content and `style="…"` attributes go through the same rewrites. */
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
      // **This is the case that decides whether the reader can win.** No position in the
      // cascade beats an !important written in a style attribute — however many
      // !important declarations an external stylesheet carries, they do nothing.
      rewritten = demoteImportant(rewritten, overridden, "declarations");
    }
    if (settings.fontSize !== undefined) {
      rewritten = relativiseFontSizes(rewritten, "declarations");
    }
    if (settings.genericFamilies !== undefined) {
      rewritten = resolveGenericFamilies(rewritten, settings.genericFamilies, "declarations");
    }
    rewritten = rewriteUrls(rewritten, (reference) =>
      resources.urlFor(reference, path),
    );

    if (rewritten !== inline) element.setAttribute("style", rewritten);
  }
}

/** `src` / `href` / `poster` / `xlink:href` are swapped for `blob:` addresses. */
function rewriteResourceReferences({ document, path, resources }: SectionBuild): void {
  for (const element of document.getElementsByTagName("*")) {
    const name = element.localName.toLowerCase();

    // Hyperlinks are **not** rewritten. Rewritten to blob:, following one would navigate
    // the iframe to another document, throwing away the whole rendering state. Links are
    // handled in `section-view.ts`: prevent the default behaviour and emit "which link the
    // reader activated" as a fact, leaving the decision to navigate to the consumer
    // (ADR-0002).
    if (name === "a") continue;

    for (const attribute of ["src", "poster", "data"]) {
      const value = element.getAttribute(attribute);
      if (value === null) continue;
      const url = resources.urlFor(value, path);
      if (url !== undefined) element.setAttribute(attribute, url);
    }

    // SVG's `<image>` uses xlink:href, and newer versions use href. Both are recognised.
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

/** `srcset` is a comma-separated list of "address descriptor" pairs. */
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
 * frond's own two stylesheets go at the very end of `<head>`.
 *
 * The end is necessary: with equal priority the cascade goes by order, and the reader's
 * settings have to beat the book's declarations. The pagination one carries `!important`
 * throughout and is frond's own floor anyway, so order does not matter to it, but keeping
 * the two together reads more clearly.
 *
 * The layout one is **empty** at this point: its content cannot be computed until the
 * document is loaded into the iframe and the writing mode is measured
 * (`section-view.ts`). The element is put in place first, and later only its
 * `textContent` is replaced — replacing content does not re-parse the document, and so
 * does not wipe out the reader's scroll position.
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

/** Every rewrite a book's stylesheet goes through, in a fixed order. */
function transformBookStylesheet(
  css: string,
  fromPath: string,
  settings: ReaderSettings,
  resources: ResourceUrls,
): string {
  // `@import` is **expanded first**, for the same reason as inlining `<link>` (see the file
  // header), plus one more: after expansion every rewrite below sees the declarations that
  // were imported in. The `writing-mode` of the four sample books lives right there, and
  // without this step they lay out horizontally from cover to cover (`css.ts`'s
  // `inlineImports`).
  let output = expandImports(css, fromPath, resources, new Set([fromPath]));

  // Prefix and break normalization come next: they only add declarations without touching
  // the existing text, so putting them early means every rewrite after them sees the ones
  // that were added (an added `writing-mode`, for instance, should also count towards "what
  // this stylesheet declares").
  output = normalisePrefixedWritingMode(output);
  output = normalisePageBreaks(output);

  // Substituting for the generic families belongs with the two rewrites above rather than
  // with the two below: like them it translates what the book asked for into a form that
  // survives this platform, and unlike them it does not depend on the reader having
  // overridden anything else (`settings.ts`'s `genericFamilies`).
  if (settings.genericFamilies !== undefined) {
    output = resolveGenericFamilies(output, settings.genericFamilies);
  }

  const overridden = overriddenProperties(settings);
  if (overridden.size > 0) output = demoteImportant(output, overridden);
  if (settings.fontSize !== undefined) output = relativiseFontSizes(output);

  return rewriteUrls(output, (reference) => resources.urlFor(reference, fromPath));
}

/**
 * Recursively expands `@import`, replacing each imported stylesheet in place with its
 * content.
 *
 * ## Why only `url()` is rewritten here, and the rest is left to the pass above
 *
 * Relative addresses are **the only rewrite that depends on which file this text came
 * from**: `url(fonts/x.woff)` inside `a.css` refers to the directory beside `a.css`, and
 * after expansion that basis is gone. So it has to be done here, against the imported
 * file's own path.
 *
 * The other rewrites (prefixes, breaks, `!important`, font size) have nothing to do with
 * file position and are left to the merged pass to do in one go — so every declaration is
 * rewritten **exactly once**. Doing them here too would mean the merged pass sees the same
 * declarations again, and the added `writing-mode` and `break-*` would appear twice. That
 * would not change the screen, but it would make the answer to "what did frond touch" hard
 * to read, and that text is the only thing visible when investigating a problem.
 *
 * Expanded `blob:` addresses are safe from the pass above's `rewriteUrls` seeing them
 * again: `blob:` is an absolute URL, `resolveHref` judges it outside the package, and it is
 * left verbatim (`resource-path.ts`).
 *
 * @param visiting the paths currently being expanded. On a cycle (`a.css` imports `b.css`
 *   imports `a.css`) that `@import` is left verbatim rather than recursing forever.
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
      // Declared by the book but absent from the archive. Handled the same way as a missing
      // `<link>` stylesheet: that file's rules are gone, and the book still reads through to
      // the end (`resources.ts`'s trade-off).
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
 * Guesses from the extension when the manifest declares no media type.
 *
 * Only the few that actually affect browser behaviour are listed. An unguessable extension
 * returns an empty string — `Blob` accepts that, the browser sniffs by content, and that is
 * the same as giving no type at all.
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
