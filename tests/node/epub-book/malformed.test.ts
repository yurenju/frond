import { describe, expect, test } from "vitest";
import { EpubBook, EpubOpenError, type EpubOpenFailure } from "../../../packages/frond/src/epub/index.ts";
import {
  handmadeBook,
  pack,
  packageDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * Broken books — **an explicit error, rather than a silent failure or a half-open
 * state** (#8).
 *
 * Assertions are made against `reason` rather than the literal message: the message is
 * for humans and gets rewritten with the wording; `reason` is part of the public API,
 * and a bookshelf uses it to tell "this file is not a book at all" (reject outright)
 * from "this book's packaging is broken" (worth telling the reader about).
 *
 * None of these shapes can be produced as a committed fixture — the fixture generator
 * only writes conforming books (ADR-0007) — so the books in this group are assembled
 * byte by byte by hand.
 */

async function reasonOf(archive: Uint8Array): Promise<EpubOpenFailure> {
  try {
    await EpubBook.open(archive);
  } catch (error) {
    if (error instanceof EpubOpenError) {
      // The message is checked non-empty alongside: reason is for code, but a human
      // still has to be able to see what happened.
      expect(error.message).not.toBe("");
      return error.reason;
    }
    throw error;
  }
  throw new Error("This book opened, and it should not have");
}

describe("the container layer", () => {
  test("not a zip", async () => {
    // A half-finished download, the wrong file, or simply a piece of plain text.
    const notAZip = new TextEncoder().encode("This is not an archive, just some text.");

    expect(await reasonOf(notAZip)).toBe("not-a-zip");
  });

  test("empty bytes are also \"not a zip\"", async () => {
    expect(await reasonOf(new Uint8Array(0))).toBe("not-a-zip");
  });

  test("missing META-INF/container.xml", async () => {
    // A ZIP with no container could be anything — a .cbz, a .docx, a folder the author
    // zipped up themselves.
    const archive = handmadeBook({
      container: null,
      packageDocument: packageDocument({}),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("missing-container");
  });

  test("container.xml is not well-formed XML", async () => {
    const archive = handmadeBook({
      container: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0"><rootfiles>`,
      packageDocument: packageDocument({}),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("malformed-container");
  });

  test("container.xml does not say where the package document is", async () => {
    const archive = handmadeBook({
      container: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles/>
</container>
`,
      packageDocument: packageDocument({}),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("malformed-container");
  });

  test("the package document container.xml points at is not in the archive", async () => {
    const archive = pack([
      { path: "mimetype", contents: "application/epub+zip" },
      {
        path: "META-INF/container.xml",
        contents: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
      },
      ...HEALTHY_ENTRIES,
    ]);

    expect(await reasonOf(archive)).toBe("missing-package-document");
  });
});

describe("the package document", () => {
  test("not well-formed XML", async () => {
    const archive = handmadeBook({
      packageDocument: `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0"><metadata><dc:title>閉じていない`,
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("malformed-package-document");
  });

  test("no <manifest>", async () => {
    const archive = handmadeBook({
      packageDocument: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>manifest のない本</dc:title>
  </metadata>
  <spine/>
</package>
`,
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("malformed-package-document");
  });

  test("no version declared — this is what OEBPS 1.2 and OEB 1.0 look like", async () => {
    // ADR-0010 puts packaging formats older than EPUB 2 outside the line: not read, and
    // rejected at open time with an explicit error.
    const archive = handmadeBook({
      packageDocument: packageDocument({}).replace(' version="3.0"', ""),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("unsupported-package-version");
  });

  test("the declared version is outside the supported range", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({ version: "1.2" }),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("unsupported-package-version");
  });

  test("version=\"3\" without the decimal point is still EPUB 3", async () => {
    // The criterion is the **major version**, not the `"3."` prefix: comparing by prefix
    // would wrongly reject this form, and what ADR-0010 puts outside the line is
    // packaging formats older than EPUB 2, not a book missing a decimal point.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({ version: "3" }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.metadata.epubVersion).toBe("epub3");
  });
});

describe("the OPF points at a file that does not exist", () => {
  /**
   * A missing file is **only fatal on the readingOrder**.
   *
   * The measured basis (the 33 commercial books in the sample, see `resources.ts`):
   * under a "refuse to open if any manifest entry is missing" rule, 33/33 still open —
   * not one book is caught by it; whereas removing any single resource that is not on
   * the readingOrder makes 33/33 fail to open at all, across an exposed surface of 1467
   * entries. Zero benefit, a blast radius of 1467 — and ADR-0010 sets which way that
   * trade-off falls: what the reader wants is for the book to open.
   */
  test("a content document on the readingOrder is missing, and the whole book is refused", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="section-2" href="section-2.xhtml" media-type="application/xhtml+xml"/>`,
        readingOrder: `    <itemref idref="section-1"/>
    <itemref idref="section-2"/>`,
      }),
      // section-2 is declared, but only section-1 is in the archive.
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("missing-resource");
  });

  test("a resource missing off the readingOrder still lets the book open", async () => {
    // A book missing a decorative illustration is still readable end to end. Refusing
    // the whole book would let one image decide whether the reader gets to read.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="missing" href="images/どこにもない.png" media-type="image/png"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "OEBPS/section-1.xhtml",
    ]);
  });

  test("a cover is declared but the image is not in the package: the book opens, just without a cover", async () => {
    // "Found a declaration" and "got the image" are two different things. A bookshelf
    // missing one thumbnail should not also fail to take the book in.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.cover).toBeUndefined();
    expect(book.readingOrder).toHaveLength(1);
  });

  test("a manifest href that resolves outside the package root is still refused on the spot", async () => {
    // This is not the same thing as a missing file: escaping the package root is
    // non-conforming, and it is the shape of a path traversal — and not one book in the
    // sample does it, so relaxing it has no measured benefit at all.
    const archive = handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="escapee" href="../../外に出た.png" media-type="image/png"/>`,
      }),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("resource-outside-container");
  });

  test("the readingOrder points at an id the manifest does not have", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({
        readingOrder: `    <itemref idref="section-1"/>
    <itemref idref="section-2"/>`,
      }),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("unknown-reading-order-item");
  });
});
