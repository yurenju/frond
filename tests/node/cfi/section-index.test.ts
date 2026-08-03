import { describe, expect, test } from "vitest";
import { parseCfi, sectionIndexOf } from "../../../src/epub/index.ts";

/**
 * Which readingOrder item a CFI belongs to.
 *
 * Imported through `src/epub/index.ts` rather than from `cfi-tree.ts` on purpose: the point
 * of this function for a consumer is that it is **on the public face**, and importing the
 * implementation directly would let the export be removed without a test noticing.
 *
 * It answers the question that comes before `ContentDocument`: parsing a section means
 * knowing which section to parse, and a consumer holding a stored CFI — a reading position,
 * an annotation's anchor — has nothing but the string.
 */

describe("the section a CFI points at", () => {
  test("counts from the itemref's ordinal, which starts at 2 for the first section", () => {
    // `/6` is `<spine>` (EPUB's content model puts it third under `<package>`), and the step
    // after it is the itemref: the kth section has ordinal 2k, so section 0 is /2.
    expect(sectionIndexOf(parseCfi("epubcfi(/6/2!/4/2/1:0)"))).toBe(0);
    expect(sectionIndexOf(parseCfi("epubcfi(/6/4!/4/2/1:0)"))).toBe(1);
    expect(sectionIndexOf(parseCfi("epubcfi(/6/14!/4/2/1:0)"))).toBe(6);
  });

  test("reads a range CFI from its parent path, the same as a point", () => {
    // An annotation is stored as a range, so answering only for points would leave the more
    // common case of the two unanswerable.
    expect(sectionIndexOf(parseCfi("epubcfi(/6/8!/4/2,/1:0,/1:4)"))).toBe(3);
  });

  test("answers for a CFI naming nothing but the section", () => {
    // What `Renderer` writes for a section with no text at all.
    expect(sectionIndexOf(parseCfi("epubcfi(/6/6)"))).toBe(2);
  });

  test("says nothing rather than guessing when it cannot recognise the path", () => {
    // A CFI from a different reader, or a book that has changed edition. Landing silently in
    // section 0 would be worse than refusing: the consumer would quote the wrong chapter with
    // no sign anything went wrong.
    expect(sectionIndexOf(parseCfi("epubcfi(/4/2!/4/2/1:0)"))).toBeUndefined();
    expect(sectionIndexOf(parseCfi("epubcfi(/6)"))).toBeUndefined();
    expect(sectionIndexOf(parseCfi("epubcfi(/6/3!/4/2/1:0)"))).toBeUndefined();
  });
});
