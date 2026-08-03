import { describe, expect, test } from "vitest";
import { ContentDocument } from "../../../src/epub/content-document.ts";
import { parseCfi, serializeCfi } from "../../../src/epub/cfi.ts";
import { EpubOpenError } from "../../../src/epub/errors.ts";

/**
 * Reading a section, and pointing back into it, with no browser.
 *
 * These pin the tree layer through the interface a consumer actually holds. The equivalence
 * with what a browser writes is pinned separately and against a browser
 * (`tests/browser/renderer/cfi-cross-implementation.spec.ts`) — that is the claim this whole
 * layer rests on, and only a browser can settle it.
 */

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`;
}

describe("the text of a section", () => {
  test("is the body's text in document order, inline markup included", () => {
    const document = ContentDocument.parse(xhtml("<p>前<span>言</span>後</p>"), 0);
    expect(document.text).toBe("前言後");
  });

  test("leaves out the indentation between blocks", () => {
    // The whole-book index skips text nodes that are entirely whitespace, and this has to
    // agree with it or every character offset drifts by the size of the book's formatting.
    const document = ContentDocument.parse(
      xhtml("\n  <p>一</p>\n  <p>二</p>\n"),
      0,
    );
    expect(document.text).toBe("一二");
  });

  test("leaves out script and style, which the reader never reads", () => {
    const document = ContentDocument.parse(
      xhtml("<style>p { color: red }</style><p>本文</p><script>var x = 1</script>"),
      0,
    );
    expect(document.text).toBe("本文");
  });

  test("is empty for a section holding only an image, which is not a failure", () => {
    const document = ContentDocument.parse(xhtml('<p><img src="a.png" alt=""/></p>'), 0);
    expect(document.text).toBe("");
    expect(document.characters).toBe(0);
  });

  test("counts an entity reference as the character it stands for", () => {
    const document = ContentDocument.parse(xhtml("<p>a&amp;b</p>"), 0);
    expect(document.text).toBe("a&b");
  });

  test("counts CDATA, which is text as far as addressing is concerned", () => {
    const document = ContentDocument.parse(xhtml("<p>a<![CDATA[<b>]]>c</p>"), 0);
    expect(document.text).toBe("a<b>c");
  });
});

describe("writing a passage out as a CFI", () => {
  test("round-trips: the characters that go in come back out", () => {
    const document = ContentDocument.parse(xhtml("<p>第一段</p><p>第二段</p>"), 3);
    const cfi = document.cfiForCharacters(1, 5)!;

    expect(document.charactersForCfi(cfi)).toEqual({ start: 1, end: 5 });
    expect(document.text.slice(1, 5)).toBe("一段第二");
  });

  test("round-trips across every position in the section", () => {
    // The interesting failures are off-by-one at a boundary — the first character of a
    // paragraph, the last one, the seam between two text nodes — so every position is
    // cheaper to check than choosing which ones to check.
    const document = ContentDocument.parse(
      xhtml("<p>前<span>言</span>後</p><p>次<em>の</em>段</p>"),
      0,
    );

    for (let at = 0; at < document.characters; at += 1) {
      const cfi = document.cfiForCharacters(at, at + 1)!;
      expect(document.charactersForCfi(cfi), `character ${at}`).toEqual({
        start: at,
        end: at + 1,
      });
    }
  });

  test("gives a point when nothing is spanned, and a range when something is", () => {
    const document = ContentDocument.parse(xhtml("<p>本文</p>"), 0);

    expect(document.cfiForCharacters(1)!.kind).toBe("point");
    expect(document.cfiForCharacters(1, 1)!.kind).toBe("point");
    expect(document.cfiForCharacters(0, 2)!.kind).toBe("range");
  });

  test("addresses the body as /4, counting from the content document's root element", () => {
    // Pinned as a string because this is the one number a different reader has to agree with
    // for a shared annotation to land in the same place: <head> is /2, <body> is /4, the
    // first <p> is /2 under it, and its text chunk is /1.
    const document = ContentDocument.parse(xhtml("<p>本文</p>"), 0);
    expect(serializeCfi(document.cfiForCharacters(0, 2)!)).toBe("epubcfi(/6/2!/4/2,/1:0,/1:2)");
  });

  test("carries an element's id in the assertion, as other readers expect", () => {
    const document = ContentDocument.parse(xhtml('<p id="para-3">本文</p>'), 0);
    expect(serializeCfi(document.cfiForCharacters(0)!)).toContain("[para-3]");
  });

  test("begins with the section it was told, so two sections never collide", () => {
    const first = ContentDocument.parse(xhtml("<p>本文</p>"), 0);
    const seventh = ContentDocument.parse(xhtml("<p>本文</p>"), 6);

    expect(serializeCfi(first.cfiForCharacters(0)!)).toContain("/6/2!");
    expect(serializeCfi(seventh.cfiForCharacters(0)!)).toContain("/6/14!");
  });

  test("stops at the end rather than refusing when the offset runs past the text", () => {
    // A passage found in one edition and looked up in another is the ordinary case.
    const document = ContentDocument.parse(xhtml("<p>本文</p>"), 0);
    expect(document.charactersForCfi(document.cfiForCharacters(99)!)).toEqual({
      start: 2,
      end: 2,
    });
  });

  test("has nothing to address in a section with no text", () => {
    const document = ContentDocument.parse(xhtml('<p><img src="a.png" alt=""/></p>'), 0);
    expect(document.cfiForCharacters(0)).toBeUndefined();
  });
});

describe("reading a CFI that was written elsewhere", () => {
  test("refuses one belonging to another section rather than pointing at the wrong words", () => {
    // Without this check the local path resolves happily against this tree and the caller
    // gets a confident answer about a passage the reader never looked at.
    const document = ContentDocument.parse(xhtml("<p>本文</p>"), 0);
    expect(document.charactersForCfi(parseCfi("epubcfi(/6/8!/4/2/1:1)"))).toBeUndefined();
  });

  test("refuses one whose path does not exist in this document", () => {
    const document = ContentDocument.parse(xhtml("<p>本文</p>"), 0);
    expect(document.charactersForCfi(parseCfi("epubcfi(/6/2!/4/40/1:1)"))).toBeUndefined();
  });
});

describe("nodes that do not count", () => {
  test("a comment does not break a run of text in two", () => {
    // CFI spec 2.2: comments do not occupy a position at all. So `a<!--x-->b` addresses
    // exactly as `ab` does — one chunk, offsets running straight through it. A walk that
    // stopped at the comment would number both halves as chunk 1 and leave the second
    // unreachable.
    const document = ContentDocument.parse(xhtml("<p>a<!--x-->b</p>"), 0);

    expect(document.text).toBe("ab");
    expect(serializeCfi(document.cfiForCharacters(0, 2)!)).toBe("epubcfi(/6/2!/4/2,/1:0,/1:2)");
    expect(document.charactersForCfi(document.cfiForCharacters(1)!)).toEqual({
      start: 1,
      end: 1,
    });
  });

  test("a comment between two elements does not shift the elements' ordinals", () => {
    const document = ContentDocument.parse(xhtml("<p>一</p><!--x--><p>二</p>"), 0);
    // The second <p> is still /4, not /6.
    expect(serializeCfi(document.cfiForCharacters(1)!)).toBe("epubcfi(/6/2!/4/4/1:0)");
  });
});

describe("a content document that will not parse", () => {
  test("says so, and says it is the content document rather than the book", () => {
    let thrown: unknown;
    try {
      ContentDocument.parse(xhtml("<p>unclosed"), 2);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(EpubOpenError);
    expect((thrown as EpubOpenError).reason).toBe("malformed-content-document");
    expect((thrown as EpubOpenError).message).toContain("section 2");
  });
});
