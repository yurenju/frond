import { describe, expect, test } from "vitest";
import { PNG } from "pngjs";
import {
  openEpub,
  type EpubArchive,
  type TocNode,
} from "../support/epub-archive.ts";
import { buildEpub } from "../../../packages/frond/src/test-fixtures/epub.ts";
import {
  buildFixture,
  type AilmentName,
} from "../../../packages/frond/src/test-fixtures/index.ts";

/**
 * Whether each fixture actually carries the ailment its name claims.
 *
 * This group and `single-ailment.test.ts` are two sides of one thing: this one asks "is
 * the ailment there", that one asks "has the ailment spilled into other files". Both
 * are needed — with only the former, a generator writing every ailment into one
 * stylesheet would also come out green.
 */

function open(name: AilmentName): EpubArchive {
  return openEpub(buildFixture(name));
}

describe("ailments in the stylesheet", () => {
  test("writing-mode-on-body: the vertical declaration is on body rather than html", () => {
    const book = open("writing-mode-on-body");

    expect(book.stylesheet).toMatch(/body\s*\{[^}]*writing-mode:\s*vertical-rl/);
    expect(book.stylesheet).not.toMatch(/html\s*\{[^}]*writing-mode/);
  });

  test("writing-mode-prefixed-only: only prefixed property names, the unprefixed one not once", () => {
    const book = open("writing-mode-prefixed-only");

    expect(book.stylesheet).toMatch(/-epub-writing-mode:\s*vertical-rl/);
    expect(book.stylesheet).toMatch(/-webkit-writing-mode:\s*vertical-rl/);

    // "The unprefixed one not once" is this fixture's entire value: adding a single
    // unprefixed declaration makes Firefox behave, and what this book plays is precisely
    // the case where that declaration does not exist.
    expect(book.stylesheet).not.toMatch(/[^-\w]writing-mode:/);
  });

  test("writing-mode-prefixed-only and writing-mode-on-body are not ill with the same thing", () => {
    // What makes the pairing hold: both declare on <body>, both use vertical-rl, and the
    // only difference is the property name. If they differed in more than that, "why is
    // one book horizontal and the other vertical in Firefox" would no longer have the
    // prefix as its only explanation.
    const prefixed = open("writing-mode-prefixed-only");
    const unprefixed = open("writing-mode-on-body");

    expect(prefixed.stylesheet).toMatch(/body\s*\{[^}]*-epub-writing-mode/);
    expect(unprefixed.stylesheet).toMatch(/body\s*\{[^}]*[^-\w]writing-mode:/);
    expect(prefixed.stylesheet).not.toMatch(/html\s*\{[^}]*writing-mode/);
    expect(unprefixed.stylesheet).not.toMatch(/-epub-|-webkit-/);
  });

  test("vertical-japanese: the vertical declaration is on html — this is the control", () => {
    const book = open("vertical-japanese");

    expect(book.stylesheet).toMatch(/html\s*\{[^}]*writing-mode:\s*vertical-rl/);
    expect(book.stylesheet).not.toMatch(/body\s*\{[^}]*writing-mode/);
  });

  test("writing-mode-behind-import: the <link>ed stylesheet is a single @import string", () => {
    const book = open("writing-mode-behind-import");

    // The quoted spelling rather than `url()` — that is the one measured in the sample,
    // and an implementation recognizing only `url()` is exactly what loses in this slot.
    expect(book.stylesheet).toMatch(/@import\s*"book-style\.css"\s*;/);
    expect(book.stylesheet).not.toContain("url(");

    // Not one layout intention is in this file. Leaving any behind would have those
    // declarations absorb part of the "the whole stylesheet disappears" symptom, and the
    // fixture would no longer be a clean slot.
    expect(book.stylesheet).not.toMatch(/writing-mode/);
    expect(book.stylesheet).not.toMatch(/font-family/);
  });

  test("writing-mode-behind-import: the vertical declaration is in the imported file", () => {
    const book = open("writing-mode-behind-import");
    const imported = book.manifest.find((item) => item.href === "book-style.css");

    expect(imported?.mediaType).toBe("text/css");
    expect(book.text(imported!.archivePath)).toMatch(
      /html\s*\{[^}]*writing-mode:\s*vertical-rl/,
    );
  });

  test("writing-mode-behind-import and vertical-japanese differ only in which file holds the declaration", () => {
    // What makes this pair hold: the declarations are identical character for character,
    // and the only difference is which file those bytes live in. If they differed in more
    // than that, "why is one book vertical and the other horizontal" would no longer have
    // the @import as its only explanation.
    const behindImport = open("writing-mode-behind-import");
    const inline = open("vertical-japanese");
    const imported = behindImport.manifest.find(
      (item) => item.href === "book-style.css",
    )!;

    expect(behindImport.text(imported.archivePath)).toBe(inline.stylesheet);
  });

  test("font-size-important: the book overrides the reader's size with !important", () => {
    const book = open("font-size-important");

    expect(book.stylesheet).toMatch(/font-size:\s*12px\s*!important/);
  });

  test("fixed-width-800: a fixed width clips the content on small screens", () => {
    const book = open("fixed-width-800");

    expect(book.stylesheet).toMatch(/width:\s*800px/);
  });

  test("hardcoded-colors: foreground and background pinned, defeating night mode", () => {
    const book = open("hardcoded-colors");

    expect(book.stylesheet).toMatch(/color:\s*#000000/);
    expect(book.stylesheet).toMatch(/background-color:\s*#ffffff/);
  });
});

describe("ailments in TOC hrefs", () => {
  test("toc-href-percent-comma: the nav encodes its comma as %2c and the manifest does not", () => {
    const book = open("toc-href-percent-comma");

    const encoded = book.toc.filter((entry) => entry.href.includes("%2c"));
    expect(encoded.length).toBe(1);

    // The ailment's shape is nav and manifest spelling one filename two ways. Were both
    // encoded, a string comparison would simply succeed and this fixture would measure
    // nothing.
    const section = book.readingOrder.find(
      (item) => item.archivePath === encoded[0]!.archivePath,
    );
    expect(section?.href).toContain(",");
    expect(section?.href).not.toContain("%2c");
  });

  test("toc-href-parent-prefix: the navigation document is in a subdirectory and hrefs carry a ../ prefix", () => {
    const book = open("toc-href-parent-prefix");

    expect(book.navigationPath).toBe("EPUB/nav/nav.xhtml");
    for (const entry of book.toc) {
      expect(entry.href).toMatch(/^\.\.\//);
    }
    // "Resolves to a Section" is covered by epub-structure.test.ts — this only pins the
    // ailment's shape. If an href were resolved against the package document rather than
    // the navigation document, that test would go red.
  });

  test("toc-href-percent-comma-epub2: the same ailment living on the NCX's content src", () => {
    const book = open("toc-href-percent-comma-epub2");

    // The vehicle really has to be the NCX — this fixture exists because "the bad TOCs
    // measured in the wild appear on this vehicle", and falling back to the nav would make
    // it the same file as the EPUB 3 one.
    expect(book.navigationVehicle).toBe("ncx");

    const encoded = book.toc.filter((entry) => entry.href.includes("%2c"));
    expect(encoded.length).toBe(1);

    // Only the NCX side encodes: both the manifest and the archive entry name use a
    // literal comma. What was checked entry by entry on that book in the sample is exactly
    // the relationship between those three.
    const section = book.readingOrder.find(
      (item) => item.archivePath === encoded[0]!.archivePath,
    );
    expect(section?.href).toContain(",");
    expect(section?.href).not.toContain("%2c");
    expect(book.entryPaths).toContain(encoded[0]!.archivePath);
  });

  test("toc-href-percent-comma's two vehicle versions carry the ailment in the same shape", () => {
    // The two fixtures share one afflict, and this turns "shared" into an assertion that
    // can go red: the same character, the same lowercase, the same one-sided encoding
    // (#23's acceptance criterion, verbatim).
    const nav = open("toc-href-percent-comma");
    const ncx = open("toc-href-percent-comma-epub2");

    const encodedHrefs = (book: EpubArchive): string[] =>
      book.toc.map((entry) => entry.href).filter((href) => href.includes("%"));

    expect(encodedHrefs(ncx)).toEqual(encodedHrefs(nav));
    expect(encodedHrefs(nav)).toEqual(["section-2%2ccontinued.xhtml"]);
  });

  test("toc-href-parent-prefix-epub2: the NCX is in a subdirectory and content src carries a ../ prefix", () => {
    const book = open("toc-href-parent-prefix-epub2");

    expect(book.navigationVehicle).toBe("ncx");
    expect(book.navigationPath).toBe("EPUB/toc/toc.ncx");
    for (const entry of book.toc) {
      expect(entry.href).toMatch(/^\.\.\//);
    }
  });
});

describe("shapes in manifest hrefs", () => {
  test("manifest-href-parent-prefix: ../ walks to the package root, and the target really is there", () => {
    const book = open("manifest-href-parent-prefix");
    const script = book.manifest.find((item) => item.href.startsWith("../"));

    expect(script?.href).toBe("../js/reader.js");
    // It resolves to the **package root**, not below the content directory — that is this
    // fixture's point. An implementation concatenating the href onto the content directory
    // as a string looks for `EPUB/../js/reader.js`, fails to find it, and judges this good
    // book to be "an OPF pointing at a file that does not exist" (a comment on #8).
    expect(script?.archivePath).toBe("js/reader.js");
    expect(book.has(script!.archivePath)).toBe(true);
    expect(book.entryPaths).not.toContain("EPUB/../js/reader.js");
  });

  test("manifest-href-parent-prefix is a good book: everything still resolves inside the package", () => {
    const book = open("manifest-href-parent-prefix");

    for (const item of book.manifest) {
      expect(item.archivePath.startsWith("../"), item.href).toBe(false);
      expect(book.has(item.archivePath), item.href).toBe(true);
    }
  });

  test("an href escaping the package root is blocked rather than silently corrected", () => {
    // "`../` is conforming" and "`../` always passes" are two different things: one more
    // `..` steps outside the package, and that really is non-conforming. ADR-0007 requires
    // illegal combinations to throw inside the generator — silently clamping to the
    // package root would let this spec produce a book that looks perfectly normal.
    expect(() =>
      buildEpub({
        title: "frond fixture",
        language: "ja",
        identifier: "urn:uuid:frond-fixture-probe",
        stylesheet: "html { line-height: 1.8; }\n",
        readingOrder: [
          { path: "section-1.xhtml", title: "朝", body: "    <p>朝。</p>" },
        ],
        resources: [
          {
            path: "../../outside.js",
            mediaType: "application/javascript",
            contents: Uint8Array.of(1),
          },
        ],
      }),
    ).toThrow(/package root/);
  });
});

/**
 * A nested TOC — one per vehicle, the same tree.
 *
 * The shape is scaled down from the EPUB 2 in the sample (Sigil → calibre): depth 2, not
 * every top-level entry having children, and `content src` values with and without
 * fragments mixed in one document.
 */
describe("a nested TOC", () => {
  const NESTED = ["nested-toc", "nested-toc-epub2"] as const;

  test.for(NESTED)("%s's TOC has two levels", (name: AilmentName) => {
    const book = open(name);

    expect(book.tocTree.length).toBe(3);
    expect(book.tocTree.map((node) => node.children.length)).toEqual([2, 2, 0]);
    expect(book.toc.length).toBe(7);
    expect(depthOf(book.tocTree)).toBe(2);
  });

  test.for(NESTED)(
    "%s mixes hrefs with and without fragments in one navigation document",
    (name: AilmentName) => {
      const book = open(name);
      const children = book.tocTree.flatMap((node) => node.children);

      // The top level has none and the second level all have one — the shape of that
      // book's "two kinds of content src mixed in one NCX". The mixing is a property of
      // **the whole document**; no single level has to mix again within itself.
      expect(book.tocTree.every((node) => !node.href.includes("#"))).toBe(true);
      expect(children.length).toBe(4);
      expect(children.every((child) => child.href.includes("#"))).toBe(true);
    },
  );

  test.for(NESTED)("every TOC entry in %s points somewhere different", (name: AilmentName) => {
    const book = open(name);
    const hrefs = book.toc.map((entry) => entry.href);

    // A child omitting its fragment would have an href identical to its parent's — and
    // "parent and child share one target" is an extra property the ticket never asked for.
    // Once a deduplicating implementation swallows that entry, this fixture silently loses
    // a second-level item.
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test.for(NESTED)("%s's fragment-carrying second level points at real anchors", (name: AilmentName) => {
    const book = open(name);
    const withFragment = book.toc.filter((entry) => entry.href.includes("#"));

    expect(withFragment.length).toBeGreaterThan(0);
    for (const entry of withFragment) {
      const fragment = entry.href.slice(entry.href.indexOf("#") + 1);
      // Pointing nowhere would give this fixture a second ailment beyond "the TOC has two
      // levels", and the single-ailment group cannot see that — it asks whether a symptom
      // has spilled into other files.
      expect(book.text(entry.archivePath), entry.href).toContain(
        `id="${fragment}"`,
      );
    }
  });

  test("nested-toc: the sub-list is an <ol> nested inside the <li>", () => {
    const book = open("nested-toc");
    const navigation = book.text(book.navigationPath);

    expect(book.navigationVehicle).toBe("nav");
    // A sub-list placed as a sibling of the <li> is equally well-formed XHTML and browsers
    // draw it just the same, but that tree is flat. Getting the position wrong is this
    // vehicle's most typical mistake.
    expect(navigation).toMatch(/<li><a [^>]*>[^<]*<\/a>\n\s*<ol>/);
  });

  test("nested-toc-epub2: children are navPoints inside navPoints, with playOrder continuous across levels", () => {
    const book = open("nested-toc-epub2");
    const ncx = book.text(book.navigationPath);

    expect(book.navigationVehicle).toBe("ncx");
    expect(ncx).toMatch(/<content src="[^"]*"\/>\n\s*<navPoint /);

    // playOrder numbers the whole tree flattened, rather than restarting from 1 at each
    // level — the flat NCX in the sample runs 1..48 continuously, and the nested one is
    // continuous too.
    const order = [...ncx.matchAll(/playOrder="(\d+)"/g)].map((match) =>
      Number(match[1]),
    );
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // The depth the NCX declares has to match the actual number of levels. Pinned at 1, an
    // implementation deciding whether to descend from this field alone never sees the
    // second level.
    expect(ncx).toContain('<meta name="dtb:depth" content="2"/>');
  });

  test("a flat TOC still declares dtb:depth=1", () => {
    // The depth is computed, not a constant edited along with the nested fixture.
    expect(open("healthy-epub2").text("EPUB/toc.ncx")).toContain(
      '<meta name="dtb:depth" content="1"/>',
    );
  });
});

/**
 * How many levels the tree has. `epub.ts`'s `tocDepth` is the same reduce, **written out
 * twice deliberately**: checking the depth the code under test writes into `dtb:depth`
 * against the depth that same code computed would have both sides wrong together and the
 * tests still green.
 */
function depthOf(nodes: readonly TocNode[]): number {
  return nodes.reduce(
    (deepest, node) => Math.max(deepest, 1 + depthOf(node.children)),
    0,
  );
}

describe("the readingOrder's direction", () => {
  test("ppd-rtl-vertical: vertical, with page-progression-direction=rtl", () => {
    const book = open("ppd-rtl-vertical");

    expect(book.pageProgressionDirection).toBe("rtl");
    expect(book.stylesheet).toMatch(/html\s*\{[^}]*writing-mode:\s*vertical-rl/);
  });

  test("the control declares no page-progression-direction", () => {
    // "Undeclared" and "declared ltr" are synonymous in the spec but different in the
    // bytes. The control takes the former, so that ppd-rtl-vertical differs from it in
    // that one attribute alone.
    expect(open("vertical-japanese").pageProgressionDirection).toBeUndefined();
  });
});

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe("ailments in the readingOrder's shape", () => {
  test("huge-single-section: one enormous Section", () => {
    const book = open("huge-single-section");

    expect(book.readingOrder.length).toBe(1);
    expect(book.text(book.readingOrder[0]!.archivePath).length).toBeGreaterThan(
      30_000,
    );
  });

  test("empty-and-image-only-sections: one empty, one holding only an image", () => {
    const book = open("empty-and-image-only-sections");
    const bodies = book.readingOrder.map((section) =>
      bodyOf(book.text(section.archivePath)),
    );

    expect(bodies.filter((body) => body.trim() === "").length).toBe(1);

    const imageOnly = bodies.filter(
      (body) => body.includes("<img") && !/<p[\s>]/.test(body),
    );
    expect(imageOnly.length).toBe(1);
  });

  test("empty-and-image-only-sections: the image is a real PNG and is declared in the manifest", () => {
    const book = open("empty-and-image-only-sections");
    const image = book.manifest.find((item) => item.mediaType === "image/png");

    expect(image).toBeDefined();
    const bytes = book.bytes(image!.archivePath);
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    // Really decode it with pngjs. Matching only the signature would pass a PNG with a
    // broken IDAT, a miscomputed CRC or a reversed adler32 — and that image is a broken
    // image icon in the browser, not a plate.
    const decoded = PNG.sync.read(Buffer.from(bytes));
    expect(decoded.width).toBe(96);
    expect(decoded.height).toBe(128);
  });
});

describe("a plate taller than a page", () => {
  test("plate-taller-than-page: the image is wrapped in a div that declares no height", () => {
    const book = open("plate-taller-than-page");
    const body = bodyOf(book.text(book.readingOrder.at(-1)!.archivePath));

    expect(body).toContain('<div class="plate"><img src="images/tall-plate.png"');

    // The wrapper **must declare no height** — this fixture's whole mechanism rests on
    // "the containing block's height is indefinite", and the moment that layer has a
    // definite height, `max-block-size: 100%` resolves and the fixture is no longer ill.
    expect(book.stylesheet).toMatch(/\.plate\s*\{[^}]*\}/);
    expect(/\.plate\s*\{([^}]*)\}/.exec(book.stylesheet)?.[1]).not.toMatch(
      /height|block-size/,
    );
  });

  test("plate-taller-than-page: the image really is taller than a page", () => {
    const book = open("plate-taller-than-page");
    const image = book.manifest.find((item) => item.mediaType === "image/png");
    const decoded = PNG.sync.read(Buffer.from(book.bytes(image!.archivePath)));

    // In an 800x600 viewport, after the reader margins, a column is about 552px along the
    // block axis. The image has to exceed that clearly, or this fixture proves nothing.
    expect(decoded.height).toBeGreaterThan(600);
    // A tall, narrow ratio: it fits along the inline axis and does not along the block
    // axis — so the book's own max-width is harmless here, and any overflow can only come
    // from the block axis side.
    expect(decoded.width).toBeLessThan(decoded.height / 5);
  });

  test("plate-taller-than-page: the book itself only constrains the inline axis", () => {
    const book = open("plate-taller-than-page");

    // The shape of real books: `max-width: 100%` (the inline axis) is there, and the block
    // axis has no bound.
    expect(book.stylesheet).toMatch(/\.plate img\s*\{[^}]*max-inline-size:\s*100%/);
    expect(/\.plate img\s*\{([^}]*)\}/.exec(book.stylesheet)?.[1]).not.toMatch(
      /max-block-size|max-height/,
    );
  });
});

describe("content hidden inside a content document", () => {
  test("hidden-trailing-notes: the notes come after the body text, and are the last thing there", () => {
    const book = open("hidden-trailing-notes");
    const body = bodyOf(book.text(book.readingOrder.at(-1)!.archivePath));

    // Position is the whole of this ailment. Were the notes not last, the final text node
    // in document order would be visible body text — and that book is healthy.
    const firstNote = body.indexOf('<div class="note"');
    expect(firstNote).toBeGreaterThan(0);
    expect(
      body.slice(firstNote).replaceAll(/<div class="note"[\s\S]*?<\/div>/g, "").trim(),
      "Nothing should follow the notes — that would make the last text node visible again.",
    ).toBe("");

    expect(book.stylesheet).toMatch(/\.note\s*\{[^}]*display:\s*none/);
  });

  test("hidden-trailing-notes: the body text is long enough to lay out over several pages", () => {
    const book = open("hidden-trailing-notes");
    const body = bodyOf(book.text(book.readingOrder.at(-1)!.archivePath));
    const paragraphs = [...body.matchAll(/<p>/g)].length;

    // The length is not a second ailment but **the precondition for the symptom**: in a
    // one-page section, "the page count collapses to 1" is the same number as the right
    // answer, and the fixture would prove nothing (ailments.ts).
    expect(paragraphs).toBeGreaterThan(40);
  });

  test("hidden-trailing-notes: only the last section is touched; the earlier ones stay healthy", () => {
    const book = open("hidden-trailing-notes");
    const healthy = open("vertical-japanese");

    // The readingOrder's length does not change — "the readingOrder has only one Section"
    // is huge-single-section's ailment, and the two must stay separable under a probe.
    expect(book.readingOrder.length).toBe(healthy.readingOrder.length);
    for (const [index, section] of book.readingOrder.slice(0, -1).entries()) {
      expect(book.text(section.archivePath)).toBe(
        healthy.text(healthy.readingOrder[index]!.archivePath),
      );
    }
  });
});

function bodyOf(document: string): string {
  return document.slice(
    document.indexOf("<body>") + "<body>".length,
    document.indexOf("</body>"),
  );
}
