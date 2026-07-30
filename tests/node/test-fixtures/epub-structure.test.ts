import { describe, expect, test } from "vitest";
import {
  assertWellFormedXml,
  openEpub,
  type EpubArchive,
} from "../support/epub-archive.ts";
import {
  buildFixture,
  syntheticFixtures,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

/**
 * The generator's acceptance criterion cannot just be "the script threw no exception".
 * This group breaks "the output is a conforming book" into assertions that can each go
 * red on their own: what the manifest declares really is in the archive, the
 * readingOrder points into the manifest, TOC hrefs resolve to Sections, and every XML
 * document is well-formed.
 *
 * Well-formedness matters most: XHTML is not HTML. One missing end tag and a browser
 * does not forgivingly repair it the way it would for HTML — it refuses to render the
 * whole document. And the generator assembles its output from string templates, which is
 * exactly where that breaks most easily.
 */

const fixtureNames = syntheticFixtures.map((fixture) => fixture.name);

function open(name: AilmentName): EpubArchive {
  return openEpub(buildFixture(name));
}

describe("the output is a conforming book", () => {
  test.for(fixtureNames)("every item %s's manifest declares is in the archive", (name) => {
    const book = open(name);

    for (const item of book.manifest) {
      expect(book.has(item.archivePath), `manifest's ${item.href}`).toBe(true);
    }
  });

  test.for(fixtureNames)("%s's archive holds nothing the manifest does not declare", (name) => {
    const book = open(name);
    // OCF's own files need not be in the manifest (`encryption.xml` is only present in
    // books with obfuscated resources); everything else has to be declared, or EpubBook
    // reads a list that does not match the archive's contents.
    const declared = new Set([
      "mimetype",
      "META-INF/container.xml",
      "META-INF/encryption.xml",
      book.packageDocumentPath,
      ...book.manifest.map((item) => item.archivePath),
    ]);

    expect(book.entryPaths.filter((path) => !declared.has(path))).toEqual([]);
  });

  test.for(fixtureNames)("%s's readingOrder is non-empty and all XHTML", (name) => {
    const book = open(name);

    expect(book.readingOrder.length).toBeGreaterThan(0);
    for (const section of book.readingOrder) {
      expect(section.mediaType).toBe("application/xhtml+xml");
    }
  });

  test.for(fixtureNames)("every TOC entry in %s resolves to a Section on the readingOrder", (name) => {
    const book = open(name);
    const sections = new Set(book.readingOrder.map((section) => section.archivePath));

    expect(book.toc.length).toBeGreaterThan(0);
    for (const entry of book.toc) {
      expect(sections, `TOC's ${entry.href}`).toContain(entry.archivePath);
    }
  });

  test.for(fixtureNames)("every XML document in %s is well-formed", (name) => {
    const book = open(name);
    const xmlPaths = book.entryPaths.filter(
      (path) => path.endsWith(".xhtml") || path.endsWith(".xml") || path.endsWith(".opf"),
    );

    expect(xmlPaths.length).toBeGreaterThan(0);
    for (const path of xmlPaths) {
      assertWellFormedXml(book.text(path), path);
    }
  });

  test.for(fixtureNames)("the language %s declares matches its content", (name) => {
    const book = open(name);

    expect(book.language).toBe("ja");
    for (const section of book.readingOrder) {
      expect(book.text(section.archivePath)).toContain('xml:lang="ja"');
    }
  });
});
