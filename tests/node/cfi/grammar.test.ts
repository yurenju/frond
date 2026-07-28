import { describe, expect, test } from "vitest";
import { CfiParseError, parseCfi, serializeCfi } from "../../../packages/frond/src/epub/index.ts";

/**
 * The CFI grammar: the round trip between string and structure.
 *
 * The oracle is the EPUB CFI spec itself (layer 1 of ADR-0001's test pyramid).
 * foliate's acceptance table is in the file next door; what is asked here is the two
 * things that table does not: **what happens to a broken string**, and **the round
 * trip's normalization rules** — the latter cannot be left to chance, or a saved
 * reading position comes back looking different on every read.
 */

describe("the structure parse reads out", () => {
  test("an indirection splits the path into segments", () => {
    // Crossing a `!` means a different document (package document → content document). A
    // structure flattened into one run of steps cannot express that, and that is the only
    // place compare ever answers "incomparable".
    const cfi = parseCfi("epubcfi(/6/4!/4/2)");

    expect(cfi.kind).toBe("point");
    if (cfi.kind !== "point") return;
    expect(cfi.path.map((segment) => segment.steps.map((step) => step.index))).toEqual([
      [6, 4],
      [4, 2],
    ]);
  });

  test("a character offset is held on the segment it belongs to", () => {
    const cfi = parseCfi("epubcfi(/6/4!/4/2/1:37)");

    expect(cfi.kind).toBe("point");
    if (cfi.kind !== "point") return;
    expect(cfi.path[0]?.offset).toBeUndefined();
    expect(cfi.path[1]?.offset?.characters).toBe(37);
  });

  test("a text-position assertion is two fields of surrounding context", () => {
    // The `[…]` on a step is an id; the one on a character offset is `[before,after]` —
    // one grammar, two uses.
    const cfi = parseCfi("epubcfi(/4/2/1:10[前の字,後の字])");
    const offset = cfi.kind === "point" ? cfi.path[0]?.offset : undefined;

    expect(offset?.assertion?.fields).toEqual(["前の字", "後の字"]);
  });

  test("parameters (`;name=value`) are read out", () => {
    // Side bias (`;s=b`) is a parameter the spec allows and real readers write. An
    // implementation that does not recognize it takes the whole `id;s=b` run as the id —
    // silently half-right.
    const cfi = parseCfi("epubcfi(/4/2[chap1;s=b])");
    const assertion = cfi.kind === "point" ? cfi.path[0]?.steps[1]?.assertion : undefined;

    expect(assertion?.fields).toEqual(["chap1"]);
    expect(assertion?.parameters).toEqual([{ name: "s", value: "b" }]);
  });

  test("a bare path and an epubcfi(…) one read into the same structure", () => {
    // Real books write it in a URL fragment (`#epubcfi(…)`), while the spec's examples and
    // what gets passed around in code are often bare.
    expect(parseCfi("/6/4!/4/2")).toEqual(parseCfi("epubcfi(/6/4!/4/2)"));
  });

  test("a range reads into three parts", () => {
    const cfi = parseCfi("epubcfi(/6/4!/4,/2/1:0,/6/3:12)");

    expect(cfi.kind).toBe("range");
    if (cfi.kind !== "range") return;
    expect(cfi.parent).toHaveLength(2);
    expect(cfi.start[0]?.offset?.characters).toBe(0);
    expect(cfi.end[0]?.offset?.characters).toBe(12);
  });
});

describe("the round trip is the identity", () => {
  const CANONICAL = [
    "epubcfi(/6/4)",
    "epubcfi(/6/4[chap01ref])",
    "epubcfi(/6/4!/4/2/1:0)",
    "epubcfi(/6/4!/4/2/1:10[前,後])",
    "epubcfi(/4/2[chap1;s=b])",
    "epubcfi(/6/4!/4,/2/1:0,/6/3:12)",
    "epubcfi(/6/4!)",
    "epubcfi(/4/2[a^,b])",
    "epubcfi(/4/2[a^]b])",
    "epubcfi(/4/2[a^^b])",
    "epubcfi(/4/2[a^(b^)c])",
    "epubcfi(/4/2[a^;b^=c])",
  ];

  test.for(CANONICAL)("%s serializes back character for character", (cfi: string) => {
    expect(serializeCfi(parseCfi(cfi))).toBe(cfi);
  });

  test.for(CANONICAL)("%s is unchanged by a second trip", (cfi: string) => {
    // Identity means a fixed point. Without this case, an implementation that adds one
    // more layer of escaping every time would also be green in the case above.
    const once = serializeCfi(parseCfi(cfi));

    expect(serializeCfi(parseCfi(once))).toBe(once);
  });
});

describe("the four normalization rules", () => {
  // These four are the only exceptions to "the round trip is the identity", and every one
  // of them converges two spellings of one position into one — none loses information.
  // The rules are written out in `serializeCfi`'s comments.
  const NORMALIZED = [
    { rule: "add the epubcfi(…) wrapper", input: "/6/4", output: "epubcfi(/6/4)" },
    { rule: "drop surplus escapes", input: "epubcfi(/4/2[a^/b])", output: "epubcfi(/4/2[a/b])" },
    { rule: "drop leading zeros", input: "epubcfi(/06/4:007)", output: "epubcfi(/6/4:7)" },
    { rule: "add = to a valueless parameter", input: "epubcfi(/4/2[a;b])", output: "epubcfi(/4/2[a;b=])" },
  ] as const;

  test.for(NORMALIZED)(
    "$rule：$input → $output",
    ({ input, output }: (typeof NORMALIZED)[number]) => {
      expect(serializeCfi(parseCfi(input))).toBe(output);
    },
  );

  test.for(NORMALIZED)(
    "$rule reaches a fixed point",
    ({ output }: (typeof NORMALIZED)[number]) => {
      expect(serializeCfi(parseCfi(output))).toBe(output);
    },
  );
});

describe("a broken CFI gives an explicit error", () => {
  const BROKEN = [
    { reason: "not-a-cfi", cfi: "" },
    { reason: "not-a-cfi", cfi: "6/4" },
    { reason: "not-a-cfi", cfi: "epubcfi/6/4" },
    { reason: "not-a-cfi", cfi: "epubcfi(6/4)" },
    { reason: "malformed-step", cfi: "epubcfi(/6/)" },
    { reason: "malformed-step", cfi: "epubcfi(/6/4/)" },
    { reason: "malformed-step", cfi: "epubcfi(/6/4:3/2)" },
    { reason: "malformed-offset", cfi: "epubcfi(/6/4:)" },
    { reason: "malformed-offset", cfi: "epubcfi(/6/4:3:5)" },
    { reason: "unterminated-assertion", cfi: "epubcfi(/6/4[chap01)" },
    { reason: "unterminated-assertion", cfi: "epubcfi(/6/4[chap01^])" },
    { reason: "malformed-range", cfi: "epubcfi(/6/4,/2)" },
    { reason: "malformed-range", cfi: "epubcfi(/6/4,/2,/4,/6)" },
    { reason: "unexpected-character", cfi: "epubcfi(/6/4 /2)" },
    { reason: "unexpected-character", cfi: "epubcfi(/6/4#2)" },
  ] as const;

  test.for(BROKEN)(
    "$cfi → $reason",
    ({ cfi, reason }: (typeof BROKEN)[number]) => {
      // "Do not silently return a half-right structure" means: a string that cannot be
      // read says so on the spot rather than handing over the half it did understand — a
      // half-right CFI sends the reader somewhere else, and that looks like "the reading
      // position was saved wrong" rather than "this string is broken".
      expect(() => parseCfi(cfi)).toThrow(CfiParseError);
      try {
        parseCfi(cfi);
        expect.unreachable("should have thrown CfiParseError");
      } catch (error) {
        expect((error as CfiParseError).reason).toBe(reason);
      }
    },
  );
});

describe("offsets the grammar knows but v1 does not do", () => {
  test.for(["epubcfi(/6/4!/4~23.5)", "epubcfi(/6/4!/4~23.5@10:20)"])(
    "%s's temporal offset is explicitly rejected",
    (cfi: string) => {
      // Ignoring the offset leaves a path that is a legal CFI pointing somewhere else —
      // which is exactly "silently returning a half-right structure". v1 renders only XHTML
      // content documents, where a timestamp in audio or video has no meaning.
      try {
        parseCfi(cfi);
        expect.unreachable("should have thrown CfiParseError");
      } catch (error) {
        expect((error as CfiParseError).reason).toBe("unsupported-offset");
      }
    },
  );

  test("a spatial offset (@) likewise", () => {
    try {
      parseCfi("epubcfi(/6/4!/4@10:20)");
      expect.unreachable("should have thrown CfiParseError");
    } catch (error) {
      expect((error as CfiParseError).reason).toBe("unsupported-offset");
    }
  });
});
