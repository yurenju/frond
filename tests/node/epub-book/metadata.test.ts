import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../packages/frond/src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import {
  handmadeBook,
  packageDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * metadata — what a book declares about itself. A bookshelf shelves by it, so this
 * group is the "get the title, authors and language" acceptance criterion.
 *
 * ## Page progression direction is not writing mode
 *
 * `page-progression-direction` is about **which way turning pages advances**, is
 * declared in the package document, and is reported by `EpubBook`. **Writing mode
 * (vertical or horizontal) is not here** — it is written in the stylesheet and needs a
 * CSSOM to be judged accurately, so `Renderer` reports it (ADR-0010, CONTEXT.md).
 * Merging the two into one field would give a vertical LTR book and a horizontal RTL
 * book the same answer.
 */

describe("title, language, identifier", () => {
  test("readable from an EPUB 3", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.title).toBe("frond fixture — vertical-japanese");
    expect(book.metadata.language).toBe("ja");
    expect(book.metadata.identifier).toBe("urn:uuid:frond-fixture-vertical-japanese");
  });

  test("readable from an EPUB 2 — including an identifier carrying opf:scheme", async () => {
    // EPUB 2's dc:identifier is written `<dc:identifier opf:scheme="uuid">`. ADR-0010:
    // take it verbatim, without interpreting which kind of identifier it claims to be and
    // without normalizing on that basis.
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.metadata.title).toBe("frond fixture — healthy-epub2");
    expect(book.metadata.language).toBe("ja");
    expect(book.metadata.identifier).toBe("urn:uuid:frond-fixture-healthy-epub2");
  });
});

describe("authors", () => {
  test("multiple authors are all read out in document order", async () => {
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>二人で書いた本</dc:title>
    <dc:language>ja</dc:language>
    <dc:creator opf:role="aut">佐藤 花子</dc:creator>
    <dc:creator opf:role="aut">鈴木 太郎</dc:creator>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.metadata.authors).toEqual(["佐藤 花子", "鈴木 太郎"]);
  });

  test("a book declaring no author gets an empty list, not a throw", async () => {
    // None of the synthetic fixtures has a dc:creator. A book that does not name an
    // author is not a broken book.
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.authors).toEqual([]);
  });
});

describe("page progression direction", () => {
  test("a book declaring rtl is reported as rtl", async () => {
    const book = await EpubBook.open(await readFixture("ppd-rtl-vertical.epub"));

    expect(book.metadata.pageProgressionDirection).toBe("rtl");
  });

  test("an EPUB 3 that does not declare is reported as \"the book did not say\", not ltr", async () => {
    // ADR-0010: collapsing "the book did not say" and "the book said ltr" into one value
    // leaves the consumer unable to tell them apart — and that is exactly the distinction
    // it needs (spine decides from it whether swiping left is the previous or the next
    // page).
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.pageProgressionDirection).toBeUndefined();
  });

  test("EPUB 2 always lands in the \"the book did not say\" slot", async () => {
    // EPUB 2 has no such attribute at all. frond does not invent a default because of
    // that (ADR-0010).
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.metadata.pageProgressionDirection).toBeUndefined();
  });

  test("a book declaring ltr and a book saying nothing are two different answers", async () => {
    const declared = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          readingOrderAttributes: ' page-progression-direction="ltr"',
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );
    const silent = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({}),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(declared.metadata.pageProgressionDirection).toBe("ltr");
    expect(silent.metadata.pageProgressionDirection).toBeUndefined();
  });
});
