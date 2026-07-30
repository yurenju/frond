import { openContainer, type EpubContainer } from "./container.ts";
import { readCover, type CoverImage } from "./cover.ts";
import { EpubOpenError, EpubResourceError } from "./errors.ts";
import { readFontObfuscation, type FontObfuscation } from "./font-obfuscation.ts";
import {
  parsePackageDocument,
  type BookMetadata,
  type ReadingOrderItem,
} from "./package-document.ts";
import { resolveResources, type Resource } from "./resources.ts";
import { readToc, type NavigationDocument, type Toc, type TocItem } from "./toc.ts";

/**
 * An opened EPUB.
 *
 * The consumer supplies bytes and receives the title, language, readingOrder and
 * cover — decompression, the container format, where the package document is and how
 * hrefs resolve all live in here, so a bookshelf never has to know what an EPUB looks
 * like (#8).
 *
 * **Zero DOM dependency** (ADR-0005): this class and every module beneath it touch
 * neither `document`, nor `DOMParser`, nor any browser object, so it runs in Node and
 * its tests therefore sit at the base of the test pyramid (ADR-0009, Vitest).
 *
 * ## Why `open()` rather than `new EpubBook(bytes)`
 *
 * Getting bytes out of a `File` or `Blob` requires async, and a constructor cannot be
 * async. The factory method makes "holding an instance" and "this book opens" the
 * same thing — there is no such thing as a half-opened `EpubBook`: when it will not
 * open, `open()` throws `EpubOpenError` and the instance never comes into existence.
 */
export class EpubBook {
  readonly metadata: BookMetadata;
  /** The reading order. The order is the one the package document declares. */
  readonly readingOrder: readonly Section[];
  /** The cover image. `undefined` when neither declaration notation finds one — which is not an error (ADR-0010). */
  readonly cover: CoverImage | undefined;
  /**
   * The TOC — a hierarchy of titles paired with locations. Top-level entries are
   * here, sub-entries under their own `children`, to unlimited depth.
   *
   * A book with no navigation document at all gets an empty list here, and that is
   * not an error (ADR-0010).
   */
  readonly toc: readonly TocItem[];
  /**
   * Which navigation document the TOC was read from (user story 15).
   *
   * Having both is the norm and frond uses only one, so this is the only clue a
   * consumer has for investigating "the NCX said something else" — whether to warn the
   * reader is the consumer's call (ADR-0002).
   */
  readonly navigationDocument: NavigationDocument | undefined;
  /**
   * Every resource the manifest declares, in declaration order — images,
   * stylesheets, fonts and content documents all included.
   *
   * Each item's `location` distinguishes **three** cases: available
   * (`in-container`), remote (`remote`, permitted by EPUB 3, not downloaded by
   * frond), and not in the package (`missing`, declared by the book but absent from
   * the archive). The latter two are deliberately not collapsed together: that would
   * leave the consumer unable to tell "this item was never in the package" from "this
   * book is written wrong", and those call for different responses (`resources.ts`).
   */
  readonly resources: readonly Resource[];

  private readonly container: EpubContainer;
  private readonly obfuscation: FontObfuscation;
  private readonly byId: ReadonlyMap<string, Resource>;

  private constructor(
    metadata: BookMetadata,
    readingOrder: readonly Section[],
    cover: CoverImage | undefined,
    toc: Toc,
    resources: ReadonlyMap<string, Resource>,
    container: EpubContainer,
    obfuscation: FontObfuscation,
  ) {
    this.metadata = metadata;
    this.readingOrder = readingOrder;
    this.cover = cover;
    this.toc = toc.items;
    this.navigationDocument = toc.readFrom;
    this.resources = [...resources.values()];
    this.byId = resources;
    this.container = container;
    this.obfuscation = obfuscation;
  }

  /**
   * The bytes at some path inside the archive.
   *
   * This is the route `Renderer` needs while laying out: a Section's XHTML
   * (`section.path`), the images that `<img src>` and `url()` inside a content
   * document resolve to, stylesheets and fonts — all of them come through here.
   *
   * **Keyed by path rather than by manifest id**, because the id is the thing a
   * consumer is least likely to hold: when one content document references another
   * resource it gives a relative href, and resolving that yields a path. For facts
   * that live on the id side (media type, remote or not), see `resources` or
   * `resource()`.
   *
   * IDPF-obfuscated fonts are restored here (`font-obfuscation.ts`). Obfuscation that
   * will not decode throws `EpubResourceError` and **does not hand back broken
   * bytes** — a corrupt font shows up on screen as a page full of tofu, and by then
   * nobody can trace the root cause back to decoding.
   *
   * @throws EpubResourceError the archive has no such path, or that item's obfuscation will not decode
   */
  bytes(path: string): Uint8Array {
    return readBytes(this.container, this.obfuscation, path);
  }

  /** Finds a resource by manifest id. `undefined` when the manifest never declared that id. */
  resource(id: string): Resource | undefined {
    return this.byId.get(id);
  }

  /**
   * Opens a book. Throws `EpubOpenError` on failure, with `reason` saying which kind
   * of breakage it was.
   */
  static async open(source: EpubSource): Promise<EpubBook> {
    const container = await openContainer(await toBytes(source));
    const packageDocument = parsePackageDocument(
      container.text(container.packageDocumentPath),
      container.packageDocumentPath,
    );
    const resources = resolveResources(packageDocument.manifest, container);
    const toc = readToc(packageDocument, resources, container);
    const obfuscation = readFontObfuscation(
      container,
      packageDocument.metadata.identifier,
    );

    return new EpubBook(
      packageDocument.metadata,
      readReadingOrder(packageDocument.readingOrder, resources),
      // The cover goes through the same function as `bytes()`, not down a second
      // "roughly equivalent" route — the same path in the same book can only have one
      // answer.
      readCover(resources, packageDocument.coverMetaId, (path) =>
        readBytes(container, obfuscation, path),
      ),
      toc,
      resources,
      container,
      obfuscation,
    );
  }
}

/**
 * The forms a book's bytes may arrive in.
 *
 * `File` is a subtype of `Blob`, so all three inputs (`File` / `Blob` /
 * `ArrayBuffer`) are covered by this union. `Uint8Array` is accepted alongside them:
 * that is what reading a file in Node gives you, and making the caller wrap it in a
 * `Blob` first would just be awkward.
 */
export type EpubSource = Blob | ArrayBuffer | Uint8Array;

/**
 * A single item in the readingOrder, corresponding to one XHTML content document
 * (CONTEXT.md).
 *
 * Deliberately not called a chapter: chapters are a TOC concept, and they are not
 * one-to-one with Sections.
 */
export interface Section {
  /** The manifest id. */
  readonly id: string;
  /** The path inside the archive, with the href already resolved by URL rules. */
  readonly path: string;
  readonly mediaType: string;
  /**
   * Whether it is on the linear reading progression (`false` for
   * `<itemref linear="no">`).
   *
   * Non-linear items **stay in this list** — cover pages and copyright pages really
   * are part of the book, and filtering them out is policy, not fact (ADR-0002).
   */
  readonly linear: boolean;
}

function readReadingOrder(
  items: readonly ReadingOrderItem[],
  resources: ReadonlyMap<string, Resource>,
): readonly Section[] {
  return items.map((item) => {
    const resource = resources.get(item.idref);
    if (resource === undefined) {
      throw new EpubOpenError(
        "unknown-reading-order-item",
        `readingOrder points at an id the manifest does not have: ${item.idref}`,
      );
    }
    if (resource.location.kind === "remote") {
      // A content document has to be inside the package — a remote resource can be
      // conforming in the manifest, but not in the readingOrder.
      throw new EpubOpenError(
        "resource-outside-container",
        `readingOrder's ${item.idref} is not inside the package`,
      );
    }
    if (resource.location.kind === "missing") {
      // **A missing file is only fatal here** (`resources.ts`). One gap on the
      // readingOrder means the reader is genuinely missing a stretch of content, and
      // nobody discovers that hole until they turn to it — precisely the "silent
      // failure or half-open state" this issue set out to prevent.
      throw new EpubOpenError(
        "missing-resource",
        `readingOrder's ${item.idref} points at ${resource.location.path}, which does not exist in the archive`,
      );
    }

    return {
      id: resource.id,
      path: resource.location.path,
      mediaType: resource.mediaType,
      linear: item.linear,
    };
  });
}

/**
 * Takes the bytes of a resource — the one shared by `bytes()` and the cover.
 *
 * Lifted to a module-level function rather than left as a method, because the cover
 * has to be read **before the instance exists** (inside `open()`). Writing it twice
 * would fork the two routes on error type: calling `container.bytes()` directly throws
 * `EpubOpenError` on a missing file, and that is the error type of the opening stage.
 */
function readBytes(
  container: EpubContainer,
  obfuscation: FontObfuscation,
  path: string,
): Uint8Array {
  if (!container.has(path)) {
    throw new EpubResourceError("missing-resource", `the archive has no ${path}`);
  }
  return obfuscation.restore(path, container.bytes(path));
}

async function toBytes(source: EpubSource): Promise<Uint8Array> {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return new Uint8Array(await source.arrayBuffer());
}
