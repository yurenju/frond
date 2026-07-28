/**
 * What `Renderer` requires of "a book", plus one in-memory implementation.
 *
 * ## Why `Renderer` does not consume `EpubBook` directly
 *
 * ADR-0002 explicitly requires frond to **provide its own fake / in-memory
 * implementation and treat it as part of the public API** — a layer above testing its
 * own integration code should not be forced to build doubles. This interface is where
 * that sentence lands: `EpubBook` satisfies it structurally (pinned at the type level
 * by `tests/node/renderer/book.test.ts`), and `MemoryBook` is another implementation
 * that satisfies it.
 *
 * Narrowing the interface buys a second thing, and in this repo that thing is concrete:
 * `Renderer`'s dependencies therefore **exclude decompression and XML parsing**. When
 * the browser tests feed frond into a page, the module graph has no bare specifier to
 * resolve, so the whole test suite needs no bundler
 * (`tests/browser/support/harness.ts`). That is no coincidence — the `EpubBook` layer
 * has nothing to do with rendering to begin with, and would only be dragged in because
 * the types were tied together.
 *
 * ## The types here are structural, not imported from `EpubBook`
 *
 * Importing `Section` and `Resource` directly would make this interface follow every
 * extension of `EpubBook`, and fields `Renderer` never uses (`properties`, the manifest
 * id) would become obligations on the fake. So what is written here is **the few slots
 * rendering actually needs**, with a separate type assertion ensuring `EpubBook` still
 * satisfies it — any drift turns `npm run typecheck` red rather than showing up at
 * runtime.
 */

/** A book that can be rendered. */
export interface RenderableBook {
  /** The reading order. The order is the one the package document declares (CONTEXT.md). */
  readonly readingOrder: readonly RenderableSection[];
  /**
   * The resources the book declares. `Renderer` only takes the media type from here —
   * a content document referencing a resource gives a path, and building a `blob:`
   * requires knowing the type.
   */
  readonly resources: readonly RenderableResource[];
  /**
   * The bytes at some path inside the archive. Obfuscated fonts are already restored at
   * this layer.
   *
   * @throws when the path does not exist or will not decode — **it does not return
   * empty bytes**. Empty bytes show up on screen as a missing image or a page full of
   * tofu, and by then nobody can trace the root cause back to this fetch.
   */
  bytes(path: string): Uint8Array;
}

export interface RenderableSection {
  readonly path: string;
  readonly mediaType: string;
  /**
   * Whether it is on the linear reading progression. `Renderer` **does not filter out**
   * the `false` ones — cover pages and copyright pages really are part of the book, and
   * filtering them out is policy, not fact (ADR-0002).
   */
  readonly linear: boolean;
}

export interface RenderableResource {
  readonly location: RenderableLocation;
  readonly mediaType: string;
}

export type RenderableLocation =
  | { readonly kind: "in-container"; readonly path: string }
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "remote" };

/**
 * An in-memory book — part of the public API (ADR-0002), not a test utility.
 *
 * When a layer above wants to test purely decisional code such as "how the UI should
 * update after a relocate event", it needs a book it can control exactly, not an EPUB
 * file. This is that.
 */
export class MemoryBook implements RenderableBook {
  readonly readingOrder: readonly RenderableSection[];
  readonly resources: readonly RenderableResource[];

  private readonly files: ReadonlyMap<string, Uint8Array>;

  private constructor(
    readingOrder: readonly RenderableSection[],
    resources: readonly RenderableResource[],
    files: ReadonlyMap<string, Uint8Array>,
  ) {
    this.readingOrder = readingOrder;
    this.resources = resources;
    this.files = files;
  }

  bytes(path: string): Uint8Array {
    const bytes = this.files.get(path);
    if (bytes === undefined) {
      throw new Error(`this MemoryBook has no ${path}`);
    }
    return bytes;
  }

  static of(spec: MemoryBookSpec): MemoryBook {
    const encoder = new TextEncoder();
    const files = new Map<string, Uint8Array>();

    const readingOrder = spec.sections.map((section) => {
      files.set(
        section.path,
        typeof section.content === "string"
          ? encoder.encode(section.content)
          : section.content,
      );
      return {
        path: section.path,
        mediaType: section.mediaType ?? XHTML_MEDIA_TYPE,
        linear: section.linear ?? true,
      };
    });

    for (const resource of spec.resources ?? []) {
      files.set(resource.path, resource.bytes);
    }

    const resources: RenderableResource[] = [
      ...readingOrder.map((section) => ({
        location: { kind: "in-container" as const, path: section.path },
        mediaType: section.mediaType,
      })),
      ...(spec.resources ?? []).map((resource) => ({
        location: { kind: "in-container" as const, path: resource.path },
        mediaType: resource.mediaType,
      })),
    ];

    return new MemoryBook(readingOrder, resources, files);
  }
}

const XHTML_MEDIA_TYPE = "application/xhtml+xml";

export interface MemoryBookSpec {
  readonly sections: readonly MemorySectionSpec[];
  readonly resources?: readonly MemoryResourceSpec[];
}

export interface MemorySectionSpec {
  readonly path: string;
  /** XHTML source, or bytes that are already encoded. */
  readonly content: string | Uint8Array;
  readonly mediaType?: string;
  readonly linear?: boolean;
}

export interface MemoryResourceSpec {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}
