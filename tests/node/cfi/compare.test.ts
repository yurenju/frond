import { describe, expect, test } from "vitest";
import { compareCfi, parseCfi, type Cfi } from "../../../packages/frond/src/epub/index.ts";

/**
 * Which of two CFIs comes first in the book (user story 22: ordering annotations by
 * their position in the book).
 *
 * foliate's seven groups are in the file next door. What is asked here is the three
 * things those seven do not: **is the ordering actually usable**, **can
 * incomparability be expressed**, and **is the comparison self-consistent**
 * (antisymmetric, transitive).
 */

function order(a: string, b: string): string {
  return compareCfi(parseCfi(a), parseCfi(b));
}

describe("order within one document", () => {
  const PAIRS = [
    { a: "/6/4!/4/2", b: "/6/4!/4/6", why: "siblings at one level: the lower index comes first" },
    { a: "/6/4!/4/2", b: "/6/4!/6/2", why: "the order is already settled at an ancestor level" },
    { a: "/6/4!/4/2/1:3", b: "/6/4!/4/2/1:9", why: "one text node: the smaller offset comes first" },
    { a: "/6/4!/4/2", b: "/6/4!/4/2/1:0", why: "a node itself comes before its content" },
    { a: "/6/4!/4/2", b: "/6/4!/4/2/2", why: "an ancestor comes before its descendants" },
    { a: "/6/2!/4", b: "/6/4!/2", why: "different Sections: the package document level decides" },
  ] as const;

  test.for(PAIRS)("$why", ({ a, b }: (typeof PAIRS)[number]) => {
    expect(order(a, b)).toBe("before");
    expect(order(b, a)).toBe("after");
  });

  test("two identical ones are equal", () => {
    expect(order("/6/4!/4/2/1:3", "/6/4!/4/2/1:3")).toBe("equal");
  });

  test("two differing only in their assertions are equal too", () => {
    // The spec says the indices are authoritative and the assertion is redundancy for
    // recovering a position after a book is revised. Comparing on it would turn one
    // position into two just because the book got a new edition.
    expect(order("/6/4[chapA]!/4/2", "/6/4[chapB]!/4/2")).toBe("equal");
  });
});

describe("annotations can be sorted", () => {
  test("sorting a list of CFIs gives the order they appear in the book", () => {
    // This is what user story 22 looks like: the consumer has a pile of saved annotations
    // and wants to list them in the order they appear in the book.
    const shuffled = [
      "epubcfi(/6/8!/4/2/1:5)",
      "epubcfi(/6/4!/4/6)",
      "epubcfi(/6/4!/4/2/1:12)",
      "epubcfi(/6/4!/4/2/1:3)",
    ].map((cfi) => parseCfi(cfi));

    const sorted = [...shuffled].sort((a: Cfi, b: Cfi) =>
      compareCfi(a, b) === "before" ? -1 : compareCfi(a, b) === "after" ? 1 : 0,
    );

    expect(
      sorted.map((cfi) => (cfi.kind === "point" ? cfi.path[1]?.offset?.characters : -1)),
    ).toEqual([3, 12, undefined, 5]);
  });

  test("two overlapping highlights still get an order", () => {
    // With equal starts, the ends decide. Overlap is the norm for annotations (highlights
    // are often drawn over each other), and answering "incomparable" here would leave the
    // consumer's list unsortable.
    const shorter = parseCfi("epubcfi(/6/4!/4/2,/1:0,/1:5)");
    const longer = parseCfi("epubcfi(/6/4!/4/2,/1:0,/1:9)");

    expect(compareCfi(shorter, longer)).toBe("before");
    expect(compareCfi(longer, shorter)).toBe("after");
  });

  test("a range and its own start point get an order", () => {
    const point = parseCfi("epubcfi(/6/4!/4/2/1:0)");
    const range = parseCfi("epubcfi(/6/4!/4/2,/1:0,/1:9)");

    // The starts are equal and the point's own end comes first — so the point sorts ahead
    // of the range.
    expect(compareCfi(point, range)).toBe("before");
  });
});

describe("incomparability is expressible", () => {
  test("one side steps into another document while the other walks to a child", () => {
    // `/6/4!/2`: walk to /6/4, follow its reference into another document, and take /2
    // there.
    // `/6/4/2`: the child /2 of /6/4 inside the package document.
    // The two positions are not even in the same document, and these strings alone cannot
    // say which comes first — forcing an ordering out would be making one up.
    expect(order("/6/4!/2", "/6/4/2")).toBe("incomparable");
    expect(order("/6/4/2", "/6/4!/2")).toBe("incomparable");
  });

  test("one side lands in text while the other lands on a child node", () => {
    // `/4/2:5` is the 5th character in node /4/2's text; `/4/2/6` is a child of it. Which
    // comes first depends on where that child sits within the content, and that takes a
    // document to know.
    expect(order("/4/2:5", "/4/2/6")).toBe("incomparable");
    expect(order("/4/2/6", "/4/2:5")).toBe("incomparable");
  });

  test("incomparable does not degrade into equal", () => {
    // This is the entire reason this return type exists: a `-1/0/1` API has nowhere to say
    // "there is no order", so it gets silently said as 0, and the consumer's sort looks
    // right while the order is invented.
    expect(order("/6/4!/2", "/6/4/2")).not.toBe("equal");
  });

  test("when the difference is settled earlier, a later incompatibility does not change the answer", () => {
    // Incomparability only arises when **the two make incompatible claims about the same
    // node**. For two paths that already diverge at an earlier index, what follows does
    // not matter.
    expect(order("/6/2!/2", "/6/4/2")).toBe("before");
  });
});

describe("the comparison has to be self-consistent", () => {
  const SAMPLE = [
    "/6/4",
    "/6/4!/2",
    "/6/4!/2/1:0",
    "/6/4!/2/1:7",
    "/6/4!/4",
    "/6/6",
    "/6/4!/2,/1:0,/1:3",
  ];

  test("antisymmetry: a before b is the same as b after a", () => {
    for (const a of SAMPLE) {
      for (const b of SAMPLE) {
        const forward = order(a, b);
        const backward = order(b, a);
        const mirrored =
          forward === "before" ? "after" : forward === "after" ? "before" : forward;

        expect(backward, `${a} and ${b}`).toBe(mirrored);
      }
    }
  });

  test("anything compared with itself is equal", () => {
    for (const cfi of SAMPLE) {
      expect(order(cfi, cfi), cfi).toBe("equal");
    }
  });

  test("transitivity: a before b and b before c means a before c", () => {
    // For the sort to be usable, transitivity cannot break. This set all lives in one
    // document, so there are no incomparable slots — transitivity does not hold in the
    // presence of incomparability by construction, and that is what that answer means.
    const comparable = SAMPLE.filter((cfi) => !cfi.includes(","));
    for (const a of comparable) {
      for (const b of comparable) {
        for (const c of comparable) {
          if (order(a, b) === "before" && order(b, c) === "before") {
            expect(order(a, c), `${a} → ${b} → ${c}`).toBe("before");
          }
        }
      }
    }
  });
});
