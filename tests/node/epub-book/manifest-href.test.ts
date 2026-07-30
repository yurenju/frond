import { describe, expect, test } from "vitest";
import { EpubBook, EpubOpenError } from "../../../src/epub/index.ts";
import {
  handmadeBook,
  packageDocument,
  sectionDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * A manifest `href` resolves against the package document by **URL rules**.
 *
 * This group guards a path that **misreports good books**: a comment on #8 records a
 * book from the Kobo channel whose OPF sits at `OEBPS/content.opf` and whose manifest
 * contains `href="../js/kobo.js"`, with `js/kobo.js` genuinely present at the package
 * root. That is a conforming book. An implementation that concatenates strings would
 * look for the literal ZIP entry name `OEBPS/../js/kobo.js`, fail to find it, and judge
 * a good book to be "an OPF pointing at a file that does not exist".
 *
 * A committed fixture playing this shape comes from #23 (that axis is running in
 * parallel). Until it lands, the resolution rule is guarded here with a handmade book;
 * once the fixture arrives an end-to-end case can be added.
 */

/** The shape of that Kobo book: the OPF in `OEBPS/`, the resources at the package root. */
function koboShapedBook(): Uint8Array {
  return handmadeBook({
    packageDocumentPath: "OEBPS/content.opf",
    packageDocument: packageDocument({
      manifest: `    <item id="js-kobo.js" href="../js/kobo.js" media-type="application/javascript"/>
    <item id="section-1" href="../text/section-1.xhtml" media-type="application/xhtml+xml"/>`,
      readingOrder: `    <itemref idref="section-1"/>`,
    }),
    entries: [
      { path: "js/kobo.js", contents: "var kobo = {};\n" },
      { path: "text/section-1.xhtml", contents: sectionDocument("朝") },
    ],
  });
}

describe("an href with ../ walking up to the package root", () => {
  test("this book opens — it conforms", async () => {
    const book = await EpubBook.open(koboShapedBook());

    expect(book.metadata.title).toBe("手で組んだ本");
  });

  test("the Section resolves to the file at the package root", async () => {
    const book = await EpubBook.open(koboShapedBook());

    // String concatenation would give `OEBPS/../text/section-1.xhtml`, which is not the
    // name of any entry.
    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "text/section-1.xhtml",
    ]);
  });
});

describe("resolving outside the package root", () => {
  test("is non-conformance, not \"file not found\"", async () => {
    // `URL` swallows surplus `..` at the root (resolving to `/evil.png`), so this case
    // also guards "having swallowed it, do not pretend it landed inside the package".
    const archive = handmadeBook({
      packageDocumentPath: "OEBPS/content.opf",
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="escapee" href="../../evil.png" media-type="image/png"/>`,
      }),
      entries: HEALTHY_ENTRIES,
    });

    await expect(EpubBook.open(archive)).rejects.toThrow(EpubOpenError);
    await expect(EpubBook.open(archive)).rejects.toMatchObject({
      reason: "resource-outside-container",
    });
  });
});

describe("remote resources", () => {
  test("a manifest pointing at another origin does not stop the book opening", async () => {
    // EPUB 3 allows remote resources (audio and video declaring
    // properties="remote-resources"). frond does not download them at this cut, but
    // treating one as "a pointer to a file that does not exist" would stop a conforming
    // book from opening.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="narration" href="https://example.invalid/narration.mp3" media-type="audio/mpeg" properties="remote-resources"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "OEBPS/section-1.xhtml",
    ]);
  });
});

describe("container.xml's full-path is a URL too", () => {
  test("an encoded full-path still finds the package document", async () => {
    // full-path goes through the same resolution as a manifest href — if only one side
    // remembers that a book may percent-encode its paths, the other breaks on the very
    // same book.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocumentPath: "OEBPS 本体/content.opf",
        container: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS%20%E6%9C%AC%E4%BD%93/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
        packageDocument: packageDocument({}),
        entries: [
          { path: "OEBPS 本体/section-1.xhtml", contents: sectionDocument("朝") },
        ],
      }),
    );

    expect(book.readingOrder[0]?.path).toBe("OEBPS 本体/section-1.xhtml");
  });
});

describe("percent-encoding", () => {
  test("encoded characters in an href decode back to the literal in the ZIP entry name", async () => {
    // A ZIP entry name is raw bytes, not a URL. The href writes `%20`; the entry name has
    // a space.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="text/%E6%9C%9D%20one.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          { path: "OEBPS/text/朝 one.xhtml", contents: sectionDocument("朝") },
        ],
      }),
    );

    expect(book.readingOrder[0]?.path).toBe("OEBPS/text/朝 one.xhtml");
  });
});
