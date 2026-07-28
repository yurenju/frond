import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../packages/frond/src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import { handmadeBook, packageDocument, sectionDocument } from "./support/handmade.ts";

/**
 * readingOrder — a book's reading order, the packaging format's `<spine>`
 * (CONTEXT.md).
 *
 * This group guards two things: **the order**, and **which file inside the archive
 * each Section points at**. Get the order wrong and the reader skips chapters; get the
 * path wrong and that slot shows no content — and the latter goes falsely green very
 * easily on synthetic fixtures, because a fixture's href and its archive path look
 * almost identical (both under `EPUB/`). So the comma-in-the-path fixture is fed here
 * too, to pull "copy the href verbatim" and "resolve, then look up" apart.
 */

describe("order", () => {
  test("an EPUB 3's three Sections come in the package document's order", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "EPUB/section-1.xhtml",
      "EPUB/section-2.xhtml",
      "EPUB/section-3.xhtml",
    ]);
  });

  test("EPUB 2's readingOrder is read the same way as EPUB 3's", async () => {
    // The version differences are in the metadata and the navigation vehicle; the
    // readingOrder has the same shape in both.
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "EPUB/section-1.xhtml",
      "EPUB/section-2.xhtml",
      "EPUB/section-3.xhtml",
    ]);
  });

  test("each Section carries the manifest's id and media type", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.readingOrder[0]).toMatchObject({
      id: "section-1",
      path: "EPUB/section-1.xhtml",
      mediaType: "application/xhtml+xml",
    });
  });

  test("the navigation document and the stylesheet are not in the readingOrder", async () => {
    // The manifest lists "which files this book is made of"; the readingOrder takes only
    // the ones an <itemref> points at. Treating the whole manifest as the reading order
    // is the most typical way to get this wrong.
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.readingOrder.map((section) => section.mediaType)).toEqual([
      "application/xhtml+xml",
      "application/xhtml+xml",
      "application/xhtml+xml",
    ]);
  });
});

describe("which file inside the archive a Section points at", () => {
  test("an href with a comma resolves to the literal entry", async () => {
    // toc-href-percent-comma's second Section has a comma in its filename, and the
    // manifest writes it as a literal comma. A comma is a legal character in a URL path,
    // so it is still a comma after resolution — an implementation that pushes the whole
    // href through encodeURIComponent finds no file here.
    const book = await EpubBook.open(await readFixture("toc-href-percent-comma.epub"));

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "EPUB/section-1.xhtml",
      "EPUB/section-2,continued.xhtml",
      "EPUB/section-3.xhtml",
    ]);
  });
});

describe("linear=\"no\"", () => {
  test("stays in the readingOrder, but marked as off the linear progression", async () => {
    // Cover pages and copyright pages are often written linear="no": they are in the
    // book, but should not appear in the page-turning progression. frond supplies facts
    // (ADR-0002) — silently filtering them out would put that slot permanently out of the
    // consumer's reach.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
          readingOrder: `    <itemref idref="cover-page" linear="no"/>
    <itemref idref="section-1"/>`,
        }),
        entries: [
          { path: "OEBPS/cover.xhtml", contents: sectionDocument("表紙") },
          { path: "OEBPS/section-1.xhtml", contents: sectionDocument("朝") },
        ],
      }),
    );

    expect(book.readingOrder.map((section) => section.linear)).toEqual([false, true]);
  });
});
