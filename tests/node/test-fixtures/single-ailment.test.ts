import { describe, expect, test } from "vitest";
import { openEpub, type EpubArchive } from "../support/epub-archive.ts";
import { buildFixture, syntheticFixtures } from "../../../src/test-fixtures/index.ts";

/**
 * The enforcer of "one fixture carries one ailment, and everything else stays healthy".
 *
 * `ailments.test.ts` asks "is the ailment there"; this asks "has the ailment spilled into
 * other files". Without this group, a generator writing every ailment into one stylesheet
 * would come out green over there, and the whole value of a fixture — a red test pointing
 * straight at one single cause — would be gone.
 *
 * The method is to write each ailment as a probe and assert that **the set of files it
 * hits is exactly** that list. "Exactly" is the point: asserting only "it hits something"
 * would leave nobody to notice when an ailment spreads to a second file.
 */

/**
 * The code version of ADR-0007's fixture table.
 *
 * The assertion below compares for **set equality**, not containment. One-way containment
 * only guards one direction: on the table but not in the code. The other way — a fixture
 * added in code with the ADR's table not keeping up — would pass silently, and that is
 * how documentation actually rots.
 *
 * Order is not compared: this list is grouped by ailment while `AILMENTS` is ordered by
 * when each was added, and neither ordering carries meaning.
 */
const REQUIRED_BY_ADR_0007 = [
  "vertical-japanese",
  "writing-mode-on-body",
  "toc-href-percent-comma",
  "toc-href-parent-prefix",
  "font-size-important",
  "fixed-width-800",
  "hardcoded-colors",
  "ppd-rtl-vertical",
  "huge-single-section",
  "empty-and-image-only-sections",
  // The version axis (ADR-0010 → #22). EPUB 2's healthy skeleton, and both cover
  // declaration forms.
  "healthy-epub2",
  "cover-image-property",
  "cover-meta-name-epub2",
  // The TOC axis (#23). The NCX versions of the ailments, a nested TOC on each vehicle,
  // and the manifest-side `../` — that last one plays a good book, not an ailment.
  "toc-href-percent-comma-epub2",
  "toc-href-parent-prefix-epub2",
  "nested-toc",
  "nested-toc-epub2",
  "manifest-href-parent-prefix",
  // Two gaps in the shapes books actually have that nothing would go red on (#24).
  "writing-mode-prefixed-only",
  "cover-meta-name",
  // The only one with no sample behind it, synthesized from the spec (#30). The reasoning
  // is in ADR-0007: undoing obfuscation wrongly throws nothing, and the symptom shows up
  // only on the reader's screen.
  "obfuscated-font-idpf",
  // Four ailments only measured by actually running a render over 34 books. None of the
  // four raises an error; they just leave the reader seeing less — a whole book laid out
  // the wrong way, a chapter where only the first page can be turned to, the lower half of
  // plates and tables permanently out of view. The last one is the slot where the three
  // engines disagree and frond cannot fix it; it exists to pin the status quo.
  "writing-mode-behind-import",
  "hidden-trailing-notes",
  "plate-taller-than-page",
  "table-taller-than-page",
  // The only one that plays a shape **measured at zero** (#54): scripted content in
  // `<body>` never appeared in the sample, and this file exists so that
  // `stripScriptedContent` leaving the node count alone — and with it every following
  // sibling's CFI — has a test holding it (#65).
  "scripted-content-in-body",
  // The first one ADR-0007's second layer found rather than the first (#35). A real
  // public-domain book turned it up; this is its synthetic copy, because the real book
  // deliberately carries no CI assertion.
  "nav-inside-section",
];

const books = new Map<string, EpubArchive>(
  syntheticFixtures.map((fixture) => [
    fixture.name,
    openEpub(buildFixture(fixture.name)),
  ]),
);

interface Probe {
  readonly symptom: string;
  /** The files allowed to show this symptom — exactly these. */
  readonly expectedIn: readonly string[];
  readonly matches: (book: EpubArchive) => boolean;
}

const PROBES: readonly Probe[] = [
  {
    symptom: "font-size pinned by !important",
    expectedIn: ["font-size-important"],
    matches: (book) => book.stylesheet.includes("!important"),
  },
  {
    symptom: "a fixed width",
    expectedIn: ["fixed-width-800"],
    matches: (book) => /\bwidth:\s*\d+px/.test(book.stylesheet),
  },
  {
    symptom: "hardcoded colours",
    expectedIn: ["hardcoded-colors"],
    matches: (book) => /(^|[\s;{])(background-)?color:/m.test(book.stylesheet),
  },
  {
    symptom: "the vertical declaration is on body, with an unprefixed property name",
    expectedIn: ["writing-mode-on-body"],
    // `[^-\w]` is this probe's entire point: without it, the `writing-mode` inside
    // `-epub-writing-mode` matches too, and the positional ailment and the syntactic one
    // become indistinguishable under the probe — while those two fixtures exist precisely
    // because they are **different** ailments (#24).
    matches: (book) => /body\s*\{[^}]*[^-\w]writing-mode:/.test(book.stylesheet),
  },
  {
    symptom: "the vertical declaration uses only prefixed property names",
    expectedIn: ["writing-mode-prefixed-only"],
    matches: (book) =>
      /-(?:epub|webkit)-writing-mode:/.test(book.stylesheet),
  },
  {
    symptom: "the vertical declaration is on html",
    expectedIn: ["vertical-japanese", "ppd-rtl-vertical"],
    matches: (book) => /html\s*\{[^}]*writing-mode/.test(book.stylesheet),
  },
  {
    symptom: "a TOC href carries percent-encoding",
    expectedIn: ["toc-href-percent-comma", "toc-href-percent-comma-epub2"],
    matches: (book) => book.toc.some((entry) => /%[0-9a-fA-F]{2}/.test(entry.href)),
  },
  {
    symptom: "a TOC href carries a ../ prefix",
    expectedIn: ["toc-href-parent-prefix", "toc-href-parent-prefix-epub2"],
    matches: (book) => book.toc.some((entry) => entry.href.startsWith("../")),
  },
  {
    symptom: "a manifest href carries a ../ prefix",
    // The two on the TOC side are ailments; this one is a **good book**: the `../` walks to
    // the package root and the target really is there, conforming and resolvable. They are
    // separate probes because neither fixture can stand in for the other — what blocks the
    // false report on the manifest side is not whether the TOC side has a `../`.
    expectedIn: ["manifest-href-parent-prefix"],
    matches: (book) => book.manifest.some((item) => item.href.startsWith("../")),
  },
  {
    symptom: "the TOC has a second level",
    expectedIn: ["nested-toc", "nested-toc-epub2"],
    matches: (book) => book.tocTree.some((node) => node.children.length > 0),
  },
  {
    symptom: "the toc <nav> is wrapped rather than hanging off <body>",
    expectedIn: ["nav-inside-section"],
    // Read off the navigation document's source rather than through `tocTree`: this
    // ailment is about **where the nav sits**, and every reader that handles it correctly
    // produces exactly the same tree as the healthy fixtures. There is nothing to see in
    // the product — which is what made it invisible until a real book turned it up (#35).
    matches: (book) =>
      book.navigationVehicle === "nav" &&
      /<body>\s*<section/.test(book.text(book.navigationPath)),
  },
  {
    symptom: "a page-progression-direction is declared",
    expectedIn: ["ppd-rtl-vertical"],
    matches: (book) => book.pageProgressionDirection !== undefined,
  },
  {
    symptom: "the readingOrder has only one Section",
    expectedIn: ["huge-single-section"],
    matches: (book) => book.readingOrder.length === 1,
  },
  {
    symptom: "there is an empty or textless Section",
    expectedIn: ["empty-and-image-only-sections"],
    matches: (book) =>
      book.readingOrder.some((section) => !/<p[\s>]/.test(book.text(section.archivePath))),
  },
  {
    symptom: "a section's body carries scripted content",
    expectedIn: ["scripted-content-in-body"],
    // The `<head>` of every fixture is the skeleton's, and none of them has a `<script>`
    // there — so this probe needs no way to tell the two positions apart. Were one ever
    // added, this is where it would have to grow one: what shifts a CFI is a removal in
    // `<body>`.
    matches: (book) =>
      book.readingOrder.some((section) =>
        /<(?:script|iframe|object|embed|frame)[\s/>]/.test(book.text(section.archivePath)),
      ),
  },
  {
    symptom: "an obfuscated resource is declared",
    expectedIn: ["obfuscated-font-idpf"],
    matches: (book) => book.entryPaths.includes("META-INF/encryption.xml"),
  },
  {
    symptom: "carries resources beyond the skeleton",
    // `manifest-href-parent-prefix` is here too: its single point of difference needs a
    // file that really exists at the package root to carry it — "the target really is
    // there" is that fixture's whole point, and removing the file turns it into a broken
    // book. The obfuscated font is the same: the ailment lives on a resource, and that
    // resource has to really be in the package.
    expectedIn: [
      "empty-and-image-only-sections",
      "manifest-href-parent-prefix",
      "obfuscated-font-idpf",
      "plate-taller-than-page",
    ],
    // "Neither XHTML nor CSS" is not precise enough: the NCX and the cover image land in
    // that slot too, so this probe would hit the EPUB 2 and cover fixtures as well, and
    // what they carry is not body content. What has to be asked is "beyond the skeleton's
    // own files, is there extra content".
    matches: (book) =>
      book.manifest.some(
        (item) =>
          item.mediaType !== "application/xhtml+xml" &&
          item.mediaType !== "text/css" &&
          item.archivePath !== book.navigationPath &&
          item.archivePath !== book.cover?.item.archivePath,
      ),
  },
  {
    symptom: "a cover is declared",
    expectedIn: [
      "cover-image-property",
      "cover-meta-name",
      "cover-meta-name-epub2",
    ],
    matches: (book) => book.cover !== undefined,
  },
  {
    symptom: "the cover goes through EPUB 3's properties=\"cover-image\"",
    expectedIn: ["cover-image-property"],
    matches: (book) => book.cover?.foundBy === "cover-image-property",
  },
  {
    symptom: "the cover goes through <meta name=\"cover\">",
    // Both versions are here, and that is the point: ADR-0010 requires both routes to work
    // and **without dispatching on version**, so the old form has to appear on both an
    // EPUB 2 and an EPUB 3 fixture (#24).
    expectedIn: ["cover-meta-name", "cover-meta-name-epub2"],
    matches: (book) => book.cover?.foundBy === "meta-name",
  },
];

describe("one fixture carries one ailment", () => {
  test("ADR-0007's fixture table matches the generator's list exactly", () => {
    const names = syntheticFixtures.map((fixture) => fixture.name);

    expect(
      [...names].sort(),
      "ADR-0007's fixture table and REQUIRED_BY_ADR_0007 have to be updated along with it.",
    ).toEqual([...REQUIRED_BY_ADR_0007].sort());
  });

  test("the filename is the ailment name plus .epub", () => {
    for (const fixture of syntheticFixtures) {
      expect(fixture.fileName).toBe(`${fixture.name}.epub`);
    }
  });

  test.for(PROBES)("$symptom appears only in the designated files", (probe: Probe) => {
    const matched = [...books]
      .filter(([, book]) => probe.matches(book))
      .map(([name]) => name);

    expect([...matched].sort()).toEqual([...probe.expectedIn].sort());
  });
});

/**
 * Generic families (`serif` / `sans-serif` / …) are off limits in synthetic fixtures.
 *
 * The three browsers do not resolve generic families to CJK faces consistently (#4) —
 * with a generic, what gets measured is "which font the browser picked" rather than "how
 * this book lays out". Real books mostly declare generics, and that is #4's territory; it
 * should not contaminate the controllability of a synthetic fixture.
 *
 * Not even a fallback is written: `"Noto Serif CJK JP", serif` silently falls back to the
 * generic when the face is absent, and that is exactly the "no idea what was measured"
 * this avoids.
 *
 * **This looks at every CSS file in the book, not only the `<link>`ed one.** Looking only
 * at the first would make this check silently examine nothing once a declaration moves
 * into an `@import`ed file (`writing-mode-behind-import` is that shape) — and a generic
 * family can be written in that file just as well.
 */
describe("named faces only, no generic families", () => {
  const GENERIC_FAMILIES = [
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
  ];

  test.for(syntheticFixtures.map((fixture) => fixture.name))(
    "%s's font-family names faces only",
    (name: string) => {
      const book = books.get(name)!;
      const everyStylesheet = book.manifest
        .filter((item) => item.mediaType === "text/css")
        .map((item) => book.text(item.archivePath))
        .join("\n");
      const declarations = [...everyStylesheet.matchAll(/font-family:([^;}]*)/g)];

      expect(declarations.length).toBeGreaterThan(0);
      for (const [, value] of declarations) {
        // Strip the quoted face names first, or the Serif inside "Noto Serif CJK JP" gets
        // mistaken for a generic family.
        const withoutNamedFaces = value!.replaceAll(/"[^"]*"|'[^']*'/g, "");
        for (const generic of GENERIC_FAMILIES) {
          expect(withoutNamedFaces).not.toContain(generic);
        }
      }
    },
  );
});
