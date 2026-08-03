import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { ContentDocument } from "../../../src/epub/content-document.ts";
import { serializeCfi } from "../../../src/epub/cfi.ts";
import { EpubBook } from "../../../src/epub/index.ts";
import { openHarness, type AddressedSection } from "../support/harness.js";

/**
 * **The claim the whole tree layer rests on**: a browser and a Worker, handed the same
 * section, write the same CFI.
 *
 * `src/epub/tree.ts` argues that addressing is a rule about trees, so one walk can serve
 * both. The walk being shared is not enough on its own, because the **trees** are not: one
 * comes from the browser's XML parser, the other from `xml.ts`. They differ in at least two
 * known ways — comments exist in one and not the other, and a run of text containing an
 * entity reference arrives as several nodes in one and as a single node in the other.
 *
 * The addressing rule is supposed to absorb both (comments occupy no position; adjacent text
 * merges into one chunk before anything is numbered). "Supposed to" is why this file exists.
 * Reasoning cannot settle it: the question is what a real XML parser in a real browser does
 * with real markup, and the only instrument for that is a real browser.
 *
 * ## Why every character rather than a sample
 *
 * The failures worth catching are off-by-one at a seam — the first character after an inline
 * tag, the last one before a comment, the join between two text nodes. Choosing which
 * positions to check means guessing where the seams are, which is the same guess that put
 * the bug there. Walking all of them costs milliseconds.
 *
 * ## Why the books here are the ones in the repository
 *
 * ADR-0007's second layer: two public-domain books, committed. Books under copyright are
 * used for **observation only** — run the scan, find the shape that breaks, then reproduce
 * that shape as a synthetic fixture. Their text does not enter the repository.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

/**
 * The shapes where the two parsers are known to build different trees, one per document.
 *
 * Each is here because something specific could go wrong, named in the key. They are
 * deliberately small: when one of these fails, the failure should say which shape broke
 * rather than which book.
 */
const SHAPES: readonly { readonly name: string; readonly body: string }[] = [
  { name: "plain paragraphs", body: "<p>一二三</p><p>四五六</p>" },
  { name: "inline markup splitting a paragraph", body: "<p>前<span>言</span>後</p>" },
  {
    name: "an entity reference inside a run of text",
    // The browser's parser often leaves three adjacent text nodes here; `xml.ts` decodes in
    // place and leaves one. The chunk merge is what has to absorb that.
    body: "<p>a&amp;b</p><p>x&#x4e00;y</p>",
  },
  {
    name: "a comment inside a run of text",
    // Only one tree has the comment at all. CFI says it occupies no position, so neither the
    // ordinals nor the chunk boundaries may move.
    body: "<p>a<!--c-->b</p>",
  },
  { name: "a comment between two elements", body: "<p>一</p><!--c--><p>二</p>" },
  { name: "a processing instruction between two elements", body: "<p>一</p><?pi x?><p>二</p>" },
  { name: "CDATA next to ordinary text", body: "<p>a<![CDATA[<b>]]>c</p>" },
  { name: "an empty element between two runs of text", body: "<p>上<br/>下</p>" },
  { name: "nested inline markup carrying ids", body: '<p id="p1">前<em id="e1">強<b>調</b></em>後</p>' },
  {
    name: "indentation between blocks",
    body: "\n  <p>一</p>\n  <div>\n    <p>二</p>\n  </div>\n",
  },
  {
    name: "ruby, which is CJK markup with text at three levels",
    body: "<p>彼は<ruby>本<rt>ほん</rt></ruby>を読む</p>",
  },
  { name: "an image-only paragraph among text", body: '<p>前</p><p><img src="a.png" alt=""/></p><p>後</p>' },
];

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
}

/**
 * The browser's answer, measured inside the page (`frond-page.ts`).
 *
 * Everything it calls is the shipped code — `cfi-dom.ts` for the writing, `text-index.ts` for
 * the flattening — so a divergence here is a divergence in the product, not in the test.
 */
async function inBrowser(
  page: Page,
  source: string,
  sectionIndex: number,
): Promise<AddressedSection> {
  return page.evaluate(
    ([xml, index]) => window.frond.addressEveryCharacter(xml as string, index as number),
    [source, sectionIndex] as const,
  );
}

/** The same answer from the bytes, with no browser anywhere near it. */
function inNode(source: string, sectionIndex: number): AddressedSection {
  const document = ContentDocument.parse(source, sectionIndex);

  const cfis: string[] = [];
  const resolved: [number, number][] = [];

  for (let at = 0; at < document.characters; at += 1) {
    const cfi = document.cfiForCharacters(at, at + 1)!;
    cfis.push(serializeCfi(cfi));

    const back = document.charactersForCfi(cfi);
    resolved.push(back === undefined ? [-1, -1] : [back.start, back.end]);
  }

  return { text: document.text, cfis, resolved };
}

test.describe("the two implementations address a section identically", () => {
  for (const shape of SHAPES) {
    test(`${shape.name}`, async ({ page }) => {
      const source = xhtml(shape.body);
      const browser = await inBrowser(page, source, 0);
      const node = inNode(source, 0);

      // The text first: a difference here means the two flattenings disagree, and every CFI
      // below would then be comparing different characters. Reported separately so the
      // failure says which of the two it is.
      expect(node.text).toBe(browser.text);
      expect(node.cfis).toEqual(browser.cfis);
      expect(node.resolved).toEqual(browser.resolved);
    });
  }
});

test.describe("the two implementations address a real book identically", () => {
  // Real prose, real markup, and enough of it that a rare shape has a chance to appear —
  // which the hand-written shapes above cannot offer, since they only contain what was
  // thought of.
  const BOOKS = [
    { file: "kusamakura-vertical-japanese.epub", sections: 3 },
    { file: "alice-in-wonderland-horizontal.epub", sections: 3 },
  ] as const;

  for (const book of BOOKS) {
    test(`${book.file}`, async ({ page }) => {
      const bytes = await readFile(join(REPO_ROOT, "tests", "books", "public", book.file));
      const opened = await EpubBook.open(new Uint8Array(bytes));

      const sections = opened.readingOrder.slice(0, book.sections);
      expect(sections.length).toBeGreaterThan(0);

      for (const [index, section] of sections.entries()) {
        const source = new TextDecoder().decode(opened.bytes(section.path));

        const browser = await inBrowser(page, source, index);
        const node = inNode(source, index);

        expect(node.text, section.path).toBe(browser.text);
        expect(node.cfis, section.path).toEqual(browser.cfis);
        expect(node.resolved, section.path).toEqual(browser.resolved);
      }
    });
  }
});
