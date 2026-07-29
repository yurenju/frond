import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { EpubBook } from "../../packages/frond/src/epub/index.ts";

/**
 * The two public-domain books of ADR-0007's second layer, checked for **being intact** —
 * not for being rendered correctly.
 *
 * That distinction is the whole design of this file. A real book has no correct answer to
 * assert against: nobody wrote down how many pages `草枕` should occupy, and pinning
 * today's number would turn current behaviour into a specification. So this layer's
 * rendering is judged by eye before a PR (`docs/agents/pull-requests.md`) and nothing here
 * looks at geometry.
 *
 * What *does* have a correct answer is whether `scripts/trim-public-books.ts` produced a
 * whole book. The trim removes narration from one and nine chapters from the other, and
 * every removal has to be matched in the package document, the navigation document and the
 * NCX. Get one of those wrong and the book still opens — it just quietly points at
 * resources that are no longer there, and the visual reading it exists for would be a
 * reading of our error handling instead. These assertions are about the trim, and their
 * oracle is the archive itself: every path a book names has to be a path the book carries.
 */

const BOOK_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..", "books", "public");

async function openBook(fileName: string): Promise<EpubBook> {
  const bytes = await readFile(join(BOOK_DIRECTORY, fileName));
  return EpubBook.open(Uint8Array.from(bytes));
}

const KUSAMAKURA = "kusamakura-vertical-japanese.epub";
const ALICE = "alice-in-wonderland-horizontal.epub";

/** Every in-container path the manifest declares. Remote resources are conforming and skipped. */
function declaredPaths(book: EpubBook): readonly string[] {
  return book.resources.flatMap((resource) =>
    resource.location.kind === "in-container" ? [resource.location.path] : [],
  );
}

/** Every in-container path the TOC points at, to any depth. */
function tocTargets(items: EpubBook["toc"]): readonly string[] {
  return items.flatMap((item) => [
    ...(item.target.kind === "in-container" ? [item.target.path] : []),
    ...tocTargets(item.children),
  ]);
}

describe("Kusamakura — vertical Japanese", () => {
  test("opens, and its metadata survived the trim", async () => {
    const book = await openBook(KUSAMAKURA);

    expect(book.metadata.title).toBe("草枕");
    expect(book.metadata.authors).toEqual(["夏目 漱石"]);
    expect(book.metadata.language).toBe("ja-jp");
    expect(book.metadata.epubVersion).toBe("epub3");
    // The reason this book is here at all: vertical Japanese reads right to left, and this
    // is the only one of the two that declares it.
    expect(book.metadata.pageProgressionDirection).toBe("rtl");
  });

  test("all thirteen chapters plus cover and contents are in the reading order", async () => {
    const book = await openBook(KUSAMAKURA);

    // 表紙, 目次, 一 through 十三, 後付 — the trim took no content document.
    expect(book.readingOrder).toHaveLength(16);
  });

  test("the TOC is read out of a nav wrapped in a section", async () => {
    const book = await openBook(KUSAMAKURA);

    // This is the book that found `nav-inside-section` (#35): its `<nav epub:type="toc">`
    // hangs inside a `<section>`, and frond used to read the whole table of contents as
    // empty. The synthetic fixture is what guards the fix; this is here so that the book
    // which produced the evidence cannot silently regress with it.
    expect(book.navigationDocument?.vehicle).toBe("nav");
    expect(book.toc.map((item) => item.label)).toEqual([
      "一", "二", "三", "四", "五", "六", "七",
      "八", "九", "十", "十一", "十二", "十三",
      "この文書について",
    ]);
  });

  test("every resource the manifest declares is in the archive", async () => {
    const book = await openBook(KUSAMAKURA);

    // Where the trim would show: the audio and the SMIL overlays are gone, so a manifest
    // item still declaring one of them would throw here.
    for (const path of declaredPaths(book)) {
      expect(() => book.bytes(path), path).not.toThrow();
    }
  });
});

describe("Alice's Adventures in Wonderland — horizontal English", () => {
  test("opens, and its metadata survived the trim", async () => {
    const book = await openBook(ALICE);

    expect(book.metadata.title).toBe("Alice’s Adventures in Wonderland");
    expect(book.metadata.authors).toEqual(["Lewis Carroll"]);
    expect(book.metadata.language).toBe("en-GB");
    expect(book.metadata.epubVersion).toBe("epub3");
  });

  test("the spine is the trimmed one: front matter, chapters 1-3, back matter", async () => {
    const book = await openBook(ALICE);

    expect(book.readingOrder.map((section) => section.id)).toEqual([
      "titlepage.xhtml",
      "imprint.xhtml",
      "epigraph.xhtml",
      "frontispiece.xhtml",
      "halftitlepage.xhtml",
      "chapter-1.xhtml",
      "chapter-2.xhtml",
      "chapter-3.xhtml",
      "loi.xhtml",
      "colophon.xhtml",
      "uncopyright.xhtml",
    ]);
  });

  test("the TOC lost the nine dropped chapters and kept its nesting", async () => {
    const book = await openBook(ALICE);

    // Standard Ebooks nests the chapters under the half-title rather than listing them at
    // the top level, so this also stands as a real book's version of `nested-toc`.
    const halfTitle = book.toc.find(
      (item) => item.label === "Alice’s Adventures in Wonderland",
    );
    expect(halfTitle?.children.map((child) => child.label)).toEqual([
      "I: Down the Rabbit-Hole",
      "II: The Pool of Tears",
      "III: A Caucus-Race and a Long Tale",
    ]);
  });

  test("every declared resource and every TOC target is in the archive", async () => {
    const book = await openBook(ALICE);

    // The trim dropped nine chapters and the thirty-two illustrations only they used. A
    // manifest item, a TOC entry or a list-of-illustrations link left behind would name a
    // path the archive no longer has, and that is what this catches.
    for (const path of [...declaredPaths(book), ...tocTargets(book.toc)]) {
      expect(() => book.bytes(path), path).not.toThrow();
    }
  });
});
