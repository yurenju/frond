import { describe, expect, test } from "vitest";
import {
  compareCfi,
  parseCfi,
  serializeCfi,
  type CfiComparison,
} from "../../../src/epub/index.ts";

/**
 * foliate-js's `tests/epubcfi-tests.js` (280 lines, upstream's only test) run through
 * once as an **acceptance table**.
 *
 * ## Licence
 *
 * The CFI strings and comparison cases in this file are taken verbatim from upstream, so
 * it carries upstream's copyright notice:
 *
 *     Copyright (c) 2022 John Factotum
 *     MIT License — https://github.com/johnfactotum/foliate-js
 *
 * The full text MIT requires is kept in `THIRD-PARTY-NOTICES.md` at the repo root.
 * **This is the only file in the whole repo under that obligation**: `src/` contains not
 * one line of upstream code (ADR-0001), and the published npm package excludes `tests/`.
 *
 * **This reads its cases, not its code** (ADR-0001: frond is a reimplementation, not a
 * port). That file's value is in being a **record of one reading** of the CFI spec —
 * which strings should parse to what, and which position sorts before which. frond's
 * oracle is still the spec itself; this table's job is to ask "does any case read
 * differently", and every difference has to be explained case by case as either a
 * different reading of the spec or a frond bug.
 *
 * ## Case by case
 *
 * foliate's file has five blocks:
 *
 * | # | Block | This ticket | Result |
 * | --- | --- | --- | --- |
 * | 1 | Taking an element off the OPF with `/6/4[chap01ref]` | **Outside the grammar layer** (`toElement` needs a DOM) | The strings' own parse/round trip is covered here |
 * | 2 | Offsets and ranges on XHTML, round-tripped through the DOM | **Outside the grammar layer** (`toRange`/`fromRange` need a DOM) | As above; the range grammar is verified here |
 * | 3 | The FILTER_SKIP-wrapped selection regression (upstream #100) | **Outside the grammar layer** (DOM filter behaviour) | As above |
 * | 4 | Special characters in ID assertions | **Exactly this layer** | Agrees throughout |
 * | 5 | `compare`'s seven cases | **Exactly this layer** | Agrees throughout |
 *
 * Blocks 1 through 3 want the "CFI ↔ DOM position" correspondence, and that takes a
 * rendered document — it belongs to `Renderer` (#31's boundary). Their **strings** are
 * still this layer's obligation, so they are taken in all the same and run through parse
 * → serialize.
 *
 * **Every CFI string appearing in that file is run here**, including both of its
 * ten-iteration loops — the difference between "ran roughly all of it" and "ran it" is
 * precisely why an acceptance table exists.
 *
 * **Disagreements: none at all.** The only difference needing explanation is
 * normalization rather than reading — see "redundant escapes like `^/`" below.
 */

/** Both of foliate's loops run 0…9. */
const LOOP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** parse → serialize returns the original string (once wrapped in `epubcfi(…)`). */
function roundtrips(cfi: string): void {
  expect(serializeCfi(parseCfi(cfi))).toBe(`epubcfi(${cfi})`);
}

describe("block 1: the OPF example from the EPUB CFI spec", () => {
  // foliate takes these strings and fetches elements off the OPF (`toElement`), a step
  // that needs a DOM. The strings themselves are this layer's business: both spellings,
  // with and without an id assertion, have to parse, and neither may contaminate the
  // other.
  test.for(["/6/4[chap01ref]", "/6/4"])("%s round trip is the identity", (cfi: string) => {
    roundtrips(cfi);
  });

  test("with and without an assertion name the same step", () => {
    // foliate's assertion is "both fetch the same element". The corresponding fact at the
    // grammar layer is: the indices match, the only difference is the assertion, and an
    // assertion does not affect position.
    expect(compareCfi(parseCfi("/6/4[chap01ref]"), parseCfi("/6/4"))).toBe("equal");
  });

  test("the id assertion is read out", () => {
    const cfi = parseCfi("/6/4[chap01ref]");
    const step = cfi.kind === "point" ? cfi.path[0]?.steps[1] : undefined;

    expect(step?.index).toBe(4);
    expect(step?.assertion?.fields).toEqual(["chap01ref"]);
  });
});

describe("block 2: offsets and ranges on XHTML", () => {
  // foliate round-trips these strings through the DOM across three equivalent XHTML
  // documents. That DOM half is `Renderer`'s business; what is verified here is that the
  // same strings parse and serialize back at the grammar layer.
  const POINTS = [
    "/4[body01]/10[para05]/3:10",
    "/4[body01]/16[svgimg]",
    "/4[body01]/10[para05]/1:0",
    "/4[body01]/10[para05]/2/1:0",
    "/4[body01]/10[para05]/2/1:3",
  ];

  test.for(POINTS)("%s round trip is the identity", (cfi: string) => {
    roundtrips(cfi);
  });

  test("a character offset reads as a number, not a string", () => {
    const cfi = parseCfi("/4[body01]/10[para05]/3:10");
    const segment = cfi.kind === "point" ? cfi.path[0] : undefined;

    expect(segment?.offset?.characters).toBe(10);
    expect(segment?.steps.map((step) => step.index)).toEqual([4, 10, 3]);
  });

  test("a range CFI's three parts each read out", () => {
    // foliate's loop runs `/4/10,/3:i,/3:i+1` — a shared prefix plus a start and an end,
    // which is the shape an annotation marking a span of text takes.
    const cfi = parseCfi("/4/10,/3:0,/3:1");

    expect(cfi.kind).toBe("range");
    if (cfi.kind !== "range") return;
    expect(cfi.parent[0]?.steps.map((step) => step.index)).toEqual([4, 10]);
    expect(cfi.start[0]?.offset?.characters).toBe(0);
    expect(cfi.end[0]?.offset?.characters).toBe(1);
  });

  test.for(LOOP)("/4/10,/3:%i,/3:… round trip is the identity", (index: number) => {
    roundtrips(`/4/10,/3:${index},/3:${index + 1}`);
  });
});

describe("block 3: the FILTER_SKIP regression (upstream #100)", () => {
  // That regression is about how a DOM filter counts offsets, and the whole of it belongs
  // to Renderer. The CFI strings it produces are ranges, taken in here to confirm the
  // grammar layer parses them — including the narrowest range there is, with start and end
  // in the same text node.
  test.for(["/4/2[test-skip-1],/1:3,/1:8", "/4/4[test-skip-2],/1:3,/1:8"])(
    "%s round trip is the identity",
    (cfi: string) => {
      roundtrips(cfi);
    },
  );

  test("a range with equal start and end is not the same thing as that point", () => {
    // Even collapsed to a point, a range is still a range — the kind tells them apart, and
    // serialization writes it back.
    const collapsed = parseCfi("/4/2,/1:3,/1:3");

    expect(collapsed.kind).toBe("range");
    expect(serializeCfi(collapsed)).toBe("epubcfi(/4/2,/1:3,/1:3)");
  });
});

describe("block 4: special characters in ID assertions", () => {
  /** foliate's cases: string → the values those assertions unescape to. */
  const ESCAPED = [
    {
      cfi: "/6/4[chap0^]!/1ref^^]",
      fields: [["chap0]!/1ref^"]],
    },
    {
      cfi: "/4[body0^]!/1^^]/10[para^]/0^,/5]/3:10",
      fields: [["body0]!/1^"], ["para]/0,/5"]],
    },
    {
      cfi: "/4[body0^]!/1^^]/16[s^]^[vgimg]",
      fields: [["body0]!/1^"], ["s][vgimg"]],
    },
    // What the three below are about is **where the assertion ends**: a `/` or `:` right
    // after the `]`. If the end-of-assertion decision gets confused by the escaping, the
    // `:0` that follows is swallowed into the assertion — and the result is still a CFI
    // that "parses fine", just pointing somewhere else.
    {
      cfi: "/4[body0^]!/1^^]/10[para^]/0^,/5]/1:0",
      fields: [["body0]!/1^"], ["para]/0,/5"]],
    },
    {
      cfi: "/4[body0^]!/1^^]/10[para^]/0^,/5]/2/1:0",
      fields: [["body0]!/1^"], ["para]/0,/5"]],
    },
    {
      cfi: "/4[body0^]!/1^^]/10[para^]/0^,/5]/2/1:3",
      fields: [["body0]!/1^"], ["para]/0,/5"]],
    },
  ] as const;

  test.for(ESCAPED)("$cfi's assertions unescape correctly", ({ cfi, fields }: (typeof ESCAPED)[number]) => {
    const parsed = parseCfi(cfi);
    const assertions =
      parsed.kind === "point"
        ? parsed.path.flatMap((segment) =>
            segment.steps.flatMap((step) =>
              step.assertion === undefined ? [] : [step.assertion.fields],
            ),
          )
        : [];

    // `^]` is `]` and `^^` is `^`, while `!` and `/` are literals inside an assertion —
    // they need no escaping, so escaped or not they are the same character.
    expect(assertions).toEqual(fields.map((field) => [...field]));
  });

  test.for(ESCAPED)("$cfi round trip is the identity", ({ cfi }: (typeof ESCAPED)[number]) => {
    roundtrips(cfi);
  });

  test("redundant escapes like `^/` are normalized away — the only difference there is", () => {
    // foliate's file spells the same id two ways: `[para^]/0^,/5]` and
    // `[para^]/0^,^/5]`, the latter escaping one extra `/`. The spec only requires
    // `^ [ ] ( ) , ; =` to be escaped, so **both spellings unescape to the same id**, and
    // frond always writes back the one without the extra escape.
    //
    // This is normalization, not a different reading: both sides answer "what is this id"
    // identically.
    const redundant = "/4[body0^]!/1^^]/10[para^]/0^,^/5],/3:0,/3:1";
    const canonical = "/4[body0^]!/1^^]/10[para^]/0^,/5],/3:0,/3:1";

    expect(serializeCfi(parseCfi(redundant))).toBe(`epubcfi(${canonical})`);
    expect(parseCfi(redundant)).toEqual(parseCfi(canonical));
  });

  test.for(LOOP)(
    "iteration %i of the redundantly-escaped loop also differs only in that one ^",
    (index: number) => {
      // The shape of foliate's second ten-iteration loop. Every iteration has to parse and
      // to differ from its input only at the `^/` — running one iteration and declaring
      // "agrees throughout" would amount to never checking the offset number at all.
      const redundant = `/4[body0^]!/1^^]/10[para^]/0^,^/5],/3:${index},/3:${index + 1}`;
      const canonical = `/4[body0^]!/1^^]/10[para^]/0^,/5],/3:${index},/3:${index + 1}`;

      expect(serializeCfi(parseCfi(redundant))).toBe(`epubcfi(${canonical})`);
    },
  );

  test("the redundantly-escaped one settles after a second parse", () => {
    // "The round trip is the identity" means "a normalized string is a fixed point". The
    // first pass may rewrite it, and after that it never changes again — otherwise a saved
    // reading position would come back looking different on every read.
    const once = serializeCfi(parseCfi("/4[para^]/0^,^/5]"));

    expect(serializeCfi(parseCfi(once))).toBe(once);
  });
});

describe("block 5: compare's seven cases", () => {
  /** foliate's table, copied verbatim — including the -1/0/1 it expects. */
  const TABLE = [
    { a: "/6/4!/10", b: "/6/4!/10", foliate: 0 },
    { a: "/6/4!/2/3:0", b: "/6/4!/2", foliate: 1 },
    { a: "/6/4!/2/4/6/8/10/3:0", b: "/6/4!/4", foliate: -1 },
    {
      a: "/6/4[chap0^]!/1ref^^]!/4[body01^^]/10[para^]^,05^^]",
      b: "/6/4!/4/10",
      foliate: 0,
    },
    {
      a: "/6/4[chap0^]!/1ref^^]!/4[body01^^],/10[para^]^,05^^],/15:10[foo^]]",
      b: "/6/4!/4/12",
      foliate: -1,
    },
    { a: "/6/4", b: "/6/4!/2", foliate: -1 },
    { a: "/6/4!/2", b: "/6/4!/2!/2", foliate: -1 },
  ] as const;

  /** Which of frond's answers foliate's -1/0/1 maps to. */
  const AS_FROND: Record<number, CfiComparison> = {
    [-1]: "before",
    0: "equal",
    1: "after",
  };

  test.for(TABLE)(
    "compare($a, $b) === $foliate",
    ({ a, b, foliate }: (typeof TABLE)[number]) => {
      expect(compareCfi(parseCfi(a), parseCfi(b))).toBe(AS_FROND[foliate]);
    },
  );

  test.for(TABLE)(
    "compare($b, $a) gives the mirrored answer",
    ({ a, b, foliate }: (typeof TABLE)[number]) => {
      // foliate does not test symmetry. Asking the other way round is free: an
      // implementation that has a and b the wrong way round is still green on three of the
      // seven cases above.
      expect(compareCfi(parseCfi(b), parseCfi(a))).toBe(AS_FROND[-foliate]);
    },
  );

  test("case 4 also proves assertions take no part in the comparison", () => {
    // That case's a carries three assertions and its b none, and the expectation is 0. The
    // spec says the indices are authoritative and the assertion is redundancy for
    // recovering a position after a book is revised.
    const withAssertions = parseCfi(
      "/6/4[chap0^]!/1ref^^]!/4[body01^^]/10[para^]^,05^^]",
    );

    expect(compareCfi(withAssertions, parseCfi("/6/4!/4/10"))).toBe("equal");
  });

  test("case 5 also proves a range and a point are comparable", () => {
    // a is a range and b a point, and foliate expects -1. frond compares on the range's
    // **start**, and only falls through to the end when the starts are equal — so this
    // case gets the same answer on both sides.
    const range = parseCfi(
      "/6/4[chap0^]!/1ref^^]!/4[body01^^],/10[para^]^,05^^],/15:10[foo^]]",
    );

    expect(range.kind).toBe("range");
    expect(compareCfi(range, parseCfi("/6/4!/4/12"))).toBe("before");
  });
});
