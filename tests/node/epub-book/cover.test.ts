import { describe, expect, test } from "vitest";
import { PNG } from "pngjs";
import { EpubBook } from "../../../packages/frond/src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import {
  handmadeBook,
  packageDocument,
  sectionDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * The cover image — where a bookshelf's thumbnails come from.
 *
 * Both forms of declaration have to work, and **without dispatching on version**
 * (ADR-0010): one EPUB 3 in the sample declares its cover only with
 * `<meta name="cover">`, and a version-dispatching implementation would leave that book
 * with no cover. The rule is to look for `properties="cover-image"` first, and only
 * then for `<meta name="cover">`.
 */

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

describe("the two routes to a declaration", () => {
  test("EPUB 3's properties=\"cover-image\"", async () => {
    const book = await EpubBook.open(await readFixture("cover-image-property.epub"));

    expect(book.cover?.foundBy).toBe("cover-image-property");
    expect(book.cover?.path).toBe("EPUB/images/cover.png");
    expect(book.cover?.mediaType).toBe("image/png");
  });

  test("EPUB 2's <meta name=\"cover\">", async () => {
    const book = await EpubBook.open(await readFixture("cover-meta-name-epub2.epub"));

    expect(book.cover?.foundBy).toBe("meta-name");
    expect(book.cover?.path).toBe("EPUB/images/cover.png");
    expect(book.cover?.mediaType).toBe("image/png");
  });

  test("an EPUB 3 declaring its cover only the old way is still found", async () => {
    // ADR-0010's evidence: one EPUB 3 in the sample has only <meta name="cover"> for its
    // cover. There is no committed fixture for this shape yet, so one is assembled by
    // hand here.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>旧い書き方の本</dc:title>
    <dc:language>ja</dc:language>
    <meta name="cover" content="cover-image"/>`,
          manifest: `    <item id="cover-image" href="images/cover.png" media-type="image/png"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          { path: "OEBPS/images/cover.png", contents: PNG_SIGNATURE },
          { path: "OEBPS/section-1.xhtml", contents: sectionDocument("朝") },
        ],
      }),
    );

    expect(book.metadata.epubVersion).toBe("epub3");
    expect(book.cover?.foundBy).toBe("meta-name");
    expect(book.cover?.path).toBe("OEBPS/images/cover.png");
  });
});

describe("finding a declaration is not the same as getting the image", () => {
  test("falls back to <meta name=\"cover\"> when properties points at a remote resource", async () => {
    // ADR-0010's rule is "look for A, and if that fails, look for B". Treating "found a
    // declaration pointing at a remote resource" as "found the cover" would leave a book
    // that wrote both forms with no cover — even though its old form points at exactly
    // the image inside the package.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>表紙が二か所にある本</dc:title>
    <dc:language>ja</dc:language>
    <meta name="cover" content="local-cover"/>`,
          manifest: `    <item id="remote-cover" href="https://example.invalid/cover.png" media-type="image/png" properties="cover-image remote-resources"/>
    <item id="local-cover" href="images/cover.png" media-type="image/png"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          { path: "OEBPS/images/cover.png", contents: PNG_SIGNATURE },
          ...HEALTHY_ENTRIES,
        ],
      }),
    );

    expect(book.cover?.foundBy).toBe("meta-name");
    expect(book.cover?.path).toBe("OEBPS/images/cover.png");
  });
});

describe("the cover's bytes are reachable", () => {
  test.for(["cover-image-property.epub", "cover-meta-name-epub2.epub"])(
    "%s's cover is a real PNG",
    async (fileName: string) => {
      // A bookshelf wants the image itself, not a path — a path is useless to the
      // consumer, which only has this book's bytes. The dimensions come from the fixture
      // generator's cover (a 100×160 upright rectangle), and using them as the expected
      // value catches the "grabbed a body plate instead" mistake (plates are 96×128).
      const book = await EpubBook.open(await readFixture(fileName));
      const decoded = PNG.sync.read(Buffer.from(book.cover!.bytes));

      expect(decoded.width).toBe(100);
      expect(decoded.height).toBe(160);
    },
  );
});

describe("having no cover is not an error", () => {
  test("a book with neither form reports \"no cover\"", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.cover).toBeUndefined();
  });

  test("a <meta name=\"cover\"> pointing at a missing id is also just no cover", async () => {
    // A book whose packaging declaration and contents disagree is the norm (ADR-0010),
    // and what the reader wants is for the book to open. A book that mis-points its
    // cover is still readable end to end, so this reports "no cover" rather than
    // throwing.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>表紙を指しそこねた本</dc:title>
    <dc:language>ja</dc:language>
    <meta name="cover" content="どこにもない-id"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.cover).toBeUndefined();
  });
});
