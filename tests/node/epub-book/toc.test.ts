import { describe, expect, test } from "vitest";
import { EpubBook, type TocItem } from "../../../src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import {
  handmadeBook,
  packageDocument,
  sectionDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * The TOC — a hierarchy of titles paired with locations (CONTEXT.md).
 *
 * This group feeds **both navigation vehicles**: EPUB 3's `nav.xhtml` and EPUB 2's
 * `toc.ncx`. The two express hierarchy and location differently (an `<ol>` nested
 * inside the `<li>` versus a navPoint nested in a navPoint; one `<a>` carrying both
 * label and location versus `navLabel` and `content` being two child elements), so
 * every ailment has to be run once per vehicle — an implementation that is green on
 * only one of them breaks on half the real books (ADR-0010: the bad TOCs in the sample
 * are precisely the ones living on an NCX).
 */

/** Flattens the tree into document order, for "was this entry read at all" questions. */
function flatten(items: readonly TocItem[]): readonly TocItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children)]);
}

/** Which path inside the archive a TOC entry points at. undefined when it points outside the package. */
function pathOf(item: TocItem): string | undefined {
  return item.target.kind === "in-container" ? item.target.path : undefined;
}

/** A matched pair of fixtures: one shape, two vehicles. */
const VEHICLES = [
  { vehicle: "nav", fileName: "nested-toc.epub" },
  { vehicle: "ncx", fileName: "nested-toc-epub2.epub" },
] as const;

describe("nesting", () => {
  test.for(VEHICLES)(
    "$fileName's second level hangs under the right parent",
    async ({ fileName }: (typeof VEHICLES)[number]) => {
      const book = await EpubBook.open(await readFixture(fileName));

      // A navigation document that puts its sub-list in as a sibling is still
      // well-formed and browsers still draw it, but that tree is flat — so what has to
      // be asked about is the shape, not the entry count.
      expect(book.toc.map((item) => item.label)).toEqual([
        "朝の光",
        "坂の道",
        "夜の駅",
      ]);
      expect(book.toc.map((item) => item.children.map((child) => child.label))).toEqual([
        ["朝の光・一", "朝の光・二"],
        ["坂の道・一", "坂の道・二"],
        [],
      ]);
    },
  );

  test.for(VEHICLES)(
    "$fileName's depth is not flattened",
    async ({ fileName }: (typeof VEHICLES)[number]) => {
      const book = await EpubBook.open(await readFixture(fileName));

      expect(flatten(book.toc)).toHaveLength(7);
      expect(book.toc).toHaveLength(3);
    },
  );

  test("depth is not capped at one level", async () => {
    // The fixtures play the shape measured on real books (two levels), and the
    // implementation should not hard-code "two". There is no fixture for a three-level
    // book, so one is assembled by hand here.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/nav.xhtml",
            contents: navigationDocument(`<ol>
  <li><a href="section-1.xhtml">一階</a>
    <ol>
      <li><a href="section-1.xhtml#b">二階</a>
        <ol><li><a href="section-1.xhtml#c">三階</a></li></ol>
      </li>
    </ol>
  </li>
</ol>`),
          },
        ],
      }),
    );

    expect(book.toc[0]?.children[0]?.children[0]?.label).toBe("三階");
    expect(flatten(book.toc).map((item) => item.label)).toEqual([
      "一階",
      "二階",
      "三階",
    ]);
  });
});

describe("both href ailments have to be resolved on both vehicles", () => {
  const AILING = [
    { fileName: "toc-href-percent-comma.epub", vehicle: "nav" },
    { fileName: "toc-href-percent-comma-epub2.epub", vehicle: "ncx" },
    { fileName: "toc-href-parent-prefix.epub", vehicle: "nav" },
    { fileName: "toc-href-parent-prefix-epub2.epub", vehicle: "ncx" },
  ] as const;

  test.for(AILING)(
    "every entry in $fileName resolves to a Section on the readingOrder",
    async ({ fileName }: (typeof AILING)[number]) => {
      const book = await EpubBook.open(await readFixture(fileName));

      // This is what "resolves to the right Section" means: the path computed on the TOC
      // side is the same string as the path computed on the readingOrder side. An
      // implementation with its own normalization on each side diverges right here — and
      // that is exactly the spine original sin recorded in #1.
      expect(book.toc.map(pathOf)).toEqual(
        book.readingOrder.map((section) => section.path),
      );
    },
  );

  test("in the %2c book, the TOC points at the literal-comma entry", async () => {
    const book = await EpubBook.open(
      await readFixture("toc-href-percent-comma.epub"),
    );

    // The ailment lives only on the TOC side: both the manifest and the archive entry
    // name use a literal comma. An implementation that does not undo percent-encoding
    // looks up `section-2%2ccontinued.xhtml`, finds nothing, and then tapping the table
    // of contents silently does nothing.
    expect(book.toc[1]?.href).toContain("%2c");
    expect(pathOf(book.toc[1]!)).toBe("EPUB/section-2,continued.xhtml");
  });

  test("in the ../ book, the navigation document sits in a subdirectory", async () => {
    const book = await EpubBook.open(
      await readFixture("toc-href-parent-prefix.epub"),
    );

    // An href is relative to **the navigation document's own** position, not the package
    // document's. An implementation using the package document as its base walks outside
    // EPUB/ on this fixture.
    expect(book.navigationDocument?.path).toBe("EPUB/nav/nav.xhtml");
    expect(book.toc[0]?.href).toBe("../section-1.xhtml");
    expect(pathOf(book.toc[0]!)).toBe("EPUB/section-1.xhtml");
  });
});

describe("fragment", () => {
  test.for(VEHICLES)(
    "$fileName's second level carries a fragment and its first level does not",
    async ({ fileName }: (typeof VEHICLES)[number]) => {
      const book = await EpubBook.open(await readFixture(fileName));
      const target = (item: TocItem) =>
        item.target.kind === "in-container" ? item.target.fragment : "(outside the package)";

      // Mixing entries with and without fragments in one navigation document is the shape
      // of the nested EPUB 2 in the sample. An implementation that drops fragments looks
      // perfectly fine on the first level, and only when jumping into the middle of a
      // chapter does it silently stop at the Section's start.
      expect(book.toc.map(target)).toEqual([undefined, undefined, undefined]);
      expect(book.toc.map((item) => item.children.map(target))).toEqual([
        ["part-1-1", "part-1-2"],
        ["part-2-1", "part-2-2"],
        [],
      ]);
    },
  );

  test("the fragment comes back decoded, matching the id in the document", async () => {
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/nav.xhtml",
            contents: navigationDocument(
              `<ol><li><a href="section-1.xhtml#%E7%AC%AC%E4%B8%80%E7%AB%A0">第一章</a></li></ol>`,
            ),
          },
        ],
      }),
    );

    // An id may be non-ASCII, and in an href it arrives percent-encoded. Without
    // decoding, handing this fragment to getElementById matches nothing at all.
    expect(
      book.toc[0]?.target.kind === "in-container" && book.toc[0].target.fragment,
    ).toBe("第一章");
  });
});

describe("which wins when both navigation documents are present (ADR-0010)", () => {
  /** Declares 3.x, has both a nav and an NCX, and **they disagree**. */
  function bothVehicles(): Uint8Array {
    return handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        readingOrderAttributes: ` toc="ncx"`,
      }),
      entries: [
        ...HEALTHY_ENTRIES,
        {
          path: "OEBPS/nav.xhtml",
          contents: navigationDocument(
            `<ol><li><a href="section-1.xhtml">nav 說的標題</a></li></ol>`,
          ),
        },
        {
          path: "OEBPS/toc.ncx",
          contents: navigationControlFile(
            `<navPoint id="p1" playOrder="1"><navLabel><text>NCX 說的標題</text></navLabel><content src="section-1.xhtml"/></navPoint>`,
          ),
        },
      ],
    });
  }

  test("EPUB 3 uses the nav and ignores the NCX entirely", async () => {
    // Having both is the norm (all 31 EPUB 3s in the sample do), so this slot cannot be
    // "report an error" or "merge".
    const book = await EpubBook.open(bothVehicles());

    expect(book.navigationDocument).toEqual({
      vehicle: "nav",
      path: "OEBPS/nav.xhtml",
    });
    expect(book.toc.map((item) => item.label)).toEqual(["nav 說的標題"]);
  });

  test("the two disagreeing is not an error — no merging, no cross-validation", async () => {
    // The disagreement is a fact; whether to warn the reader is the consumer's policy
    // (ADR-0002). An EPUB 3 shipping a stale NCX is entirely conforming, and turning that
    // into an error would stop a good book from opening.
    await expect(EpubBook.open(bothVehicles())).resolves.toBeDefined();
  });

  test("3.x declared with no nav falls back to the NCX rather than throwing", async () => {
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
          readingOrderAttributes: ` toc="ncx"`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/toc.ncx",
            contents: navigationControlFile(
              `<navPoint id="p1" playOrder="1"><navLabel><text>只有 NCX</text></navLabel><content src="section-1.xhtml"/></navPoint>`,
            ),
          },
        ],
      }),
    );

    expect(book.metadata.epubVersion).toBe("epub3");
    expect(book.navigationDocument?.vehicle).toBe("ncx");
    expect(book.toc.map((item) => item.label)).toEqual(["只有 NCX"]);
  });

  test("EPUB 2 has only the NCX route", async () => {
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.navigationDocument).toEqual({
      vehicle: "ncx",
      path: "EPUB/toc.ncx",
    });
    expect(book.toc.map((item) => item.label)).toEqual([
      "朝の光",
      "坂の道",
      "夜の駅",
    ]);
  });

  test("an NCX not pointed at by <spine toc> is still found by media type", async () => {
    // Measured: all 33 books declare an NCX in the manifest, but only 27 point at it with
    // `<spine toc>` — **6 are findable only by media type**. All 6 have a nav so they
    // never reach this route, but "the NCX is not pointed at" is itself very common in
    // the wild.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          version: "2.0",
          manifest: `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/toc.ncx",
            contents: navigationControlFile(
              `<navPoint id="p1" playOrder="1"><navLabel><text>沒被指到的 NCX</text></navLabel><content src="section-1.xhtml"/></navPoint>`,
            ),
          },
        ],
      }),
    );

    expect(book.toc.map((item) => item.label)).toEqual(["沒被指到的 NCX"]);
  });
});

describe("a book with no navigation document at all", () => {
  test("reports an empty TOC rather than refusing to open", async () => {
    // What the reader wants is for the book to open (the direction ADR-0010 sets for
    // this trade-off). A book without a table of contents is still readable end to end.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({}),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.toc).toEqual([]);
    expect(book.navigationDocument).toBeUndefined();
  });

  test("a navigation document declared but absent from the archive is also just an empty TOC", async () => {
    // A missing file is only fatal on the readingOrder (`resources.ts`). With the
    // navigation document gone, what is missing is the table of contents, not the
    // content.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.toc).toEqual([]);
    expect(book.navigationDocument).toBeUndefined();
  });
});

describe("the nav.xhtml vehicle's own shape", () => {
  test("the landmarks nav is not mistaken for the TOC", async () => {
    // Measured: of the 31 books with a nav, **27 have more than one `<nav>` in their
    // navigation document** (mostly landmarks), and all 31 declare epub:type="toc" on the
    // TOC one. An implementation that takes the first `<nav>` as the TOC picks up a
    // different list on these books.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/nav.xhtml",
            contents: navigationDocument(
              `<ol><li><a href="section-1.xhtml">目錄的標題</a></li></ol>`,
              `<ol><li><a href="section-1.xhtml">本文開始</a></li></ol>`,
            ),
          },
        ],
      }),
    );

    expect(book.toc.map((item) => item.label)).toEqual(["目錄的標題"]);
  });

  test("a label wrapped in inline tags is still read, in order", async () => {
    // Measured: 73 of 1527 TOC links have labels carrying inline tags (5 books), and in
    // one of them **all 39 entries have their text wrapped in a `<span>`**. An
    // implementation that reads only the `<a>`'s own text level leaves that book's entire
    // table of contents with empty labels.
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/nav.xhtml",
            contents: navigationDocument(
              `<ol>
  <li><a href="section-1.xhtml"><span>序</span></a></li>
  <li><a href="section-1.xhtml"><span class="part"><small>輯一</small>・儲藏室</span></a></li>
  <li><a href="section-1.xhtml">前<em>言</em>後</a></li>
</ol>`,
            ),
          },
        ],
      }),
    );

    expect(book.toc.map((item) => item.label)).toEqual([
      "序",
      "輯一・儲藏室",
      "前言後",
    ]);
  });
});

/** A `nav.xhtml`. When `before` is given, an extra landmarks nav is placed ahead of the TOC. */
function navigationDocument(list: string, before?: string): string {
  const landmarks =
    before === undefined
      ? ""
      : `    <nav epub:type="landmarks"><h1>導讀</h1>${before}</nav>\n`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
  <head><meta charset="utf-8"/><title>目次</title></head>
  <body>
${landmarks}    <nav epub:type="toc">
${list}
    </nav>
  </body>
</html>
`;
}

/** An NCX. */
function navigationControlFile(navPoints: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="ja">
  <head><meta name="dtb:uid" content="urn:uuid:frond-handmade"/></head>
  <docTitle><text>手で組んだ本</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}
