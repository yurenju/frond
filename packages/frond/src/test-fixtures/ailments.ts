import {
  DEFAULT_EPUB_VERSION,
  type EpubSpec,
  type EpubVersion,
  type SectionSpec,
} from "./epub.ts";
import { encodePng } from "./png.ts";
import { PROSE, proseBody } from "./prose.ts";

/**
 * The ailment list. **One ailment per file, and the filename is the ailment's name**
 * (ADR-0007).
 *
 * Each ailment is expressed as a **single-point difference** against one shared healthy
 * skeleton — everything else stays healthy. That discipline is the entire value of this
 * set of fixtures: when a test goes red, the filename says which ailment has come back.
 * Once two ailments are crammed into one file, a red light costs time again to work out
 * which of them caused it — which is exactly the drawback of using real books as
 * fixtures.
 *
 * ## The EPUB version is a second axis
 *
 * Beyond the ailment there is the **EPUB version**: EPUB 3 (the default) and EPUB 2
 * (ADR-0010). The version is written as a **filename suffix** — no suffix means EPUB 3,
 * `-epub2` means EPUB 2. This keeps committed fixtures one-to-one with filenames (the
 * source of red-light readability), and makes the two files for one ailment across both
 * versions visibly a pair when placed side by side.
 *
 * The suffix and the `epubVersion` field are two sources of truth, held consistent by
 * `epub-version.test.ts`.
 *
 * ## Controls
 *
 * The control for the six horizontal ailments is the healthy skeleton itself
 * (`baseSpec`), and the control for the three vertical ones is `vertical-japanese`.
 * `vertical-japanese` deliberately **does not declare** page-progression-direction, even
 * though real vertical Japanese books almost always are rtl — because to serve as a
 * control it has to differ from `ppd-rtl-vertical` by that one attribute alone.
 *
 * ## Why a named face
 *
 * Every fixture that needs predictable layout names `"Noto Serif CJK JP"`, writing
 * neither a generic family nor a generic as fallback. The three browsers do not agree on
 * CJK resolution for generic families (#4), and with a generic what gets measured is
 * "which font the browser picked" rather than "how this book lays out". Real books mostly
 * declare generics, which is #4's territory and must not contaminate the controllability
 * of the synthetic fixtures.
 */

const NAMED_FACE = '"Noto Serif CJK JP"';

/**
 * The healthy stylesheet. It deliberately **does not declare** font-size, width, color,
 * background or writing-mode — each of those is an ailment of its own, and a skeleton
 * that touched them would leave no control.
 */
const HEALTHY_STYLESHEET = `html {
  font-family: ${NAMED_FACE};
  line-height: 1.8;
}

body {
  margin: 0;
}

h1 {
  line-height: 1.4;
}

p {
  margin: 0 0 1em;
  text-indent: 1em;
}
`;

/** The vertical declaration, written on `html` — the correct place for it. */
const VERTICAL_ON_HTML = `
html {
  writing-mode: vertical-rl;
}
`;

/**
 * The vertical declaration, written on `<body>`. Books produced by InDesign are exactly
 * this, and a library reading only `<html>` judges them horizontal. This is not
 * overriding the book, it is the library **not reading enough** — the browser did what
 * the book said (ADR-0003).
 */
const VERTICAL_ON_BODY = `
body {
  writing-mode: vertical-rl;
}
`;

/**
 * The vertical declaration with **only the prefixed property names** — unprefixed
 * `writing-mode` does not appear once. 《入境大廳》 (produced by Adobe InDesign 17.0.1,
 * EPUB 3) has exactly this shape, and Firefox recognises neither prefix, so that book
 * lays out entirely horizontally in Firefox (docs/browser-quirks.md's "`-epub-` and
 * `-webkit-` prefixed `writing-mode`, not recognised by Firefox").
 *
 * It and `VERTICAL_ON_BODY` are each other's controls, and they are not ill with the same
 * thing: that one is ill in the declaration's **position** (all three did what the book
 * said; the library did not read enough, looking only at `documentElement`), and this one
 * is ill in the declaration's **syntax** (nobody failed to read enough; Firefox never
 * received the declaration at all).
 *
 * A space is left after the colon even though that book writes none — the no-space form
 * is a separate fact already measured (all three accept it; see the same document), and
 * writing it in here would stack two axes on one file.
 */
const VERTICAL_ON_BODY_PREFIXED = `
body {
  -epub-writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
}
`;

/**
 * The skeleton's Sections.
 *
 * `anchorIdsOf` decides which paragraphs of Section `index` carry an id, and by default
 * none do. The two nested-TOC fixtures get their anchors from it rather than walking
 * `PROSE` again themselves — that would put the assumption "readingOrder's nth item
 * corresponds to PROSE's nth item" in two places, and one of them would sooner or later
 * have modified the readingOrder first (`percentEncodedComma` already changes `path`),
 * making the assumption silently wrong.
 */
function healthySections(
  anchorIdsOf: (index: number) => ReadonlyMap<number, string> = () => new Map(),
): readonly SectionSpec[] {
  return PROSE.map((prose, index) => ({
    path: `section-${index + 1}.xhtml`,
    title: prose.title,
    body: proseBody(prose, anchorIdsOf(index)),
  }));
}

/**
 * This fixture's EPUB version.
 *
 * It exists for typing reasons rather than for the default: `AILMENTS` uses `as const` to
 * preserve literal types, so the entries that omit `epubVersion` do not have the property
 * at all, and `ailment.epubVersion` cannot be read off that union type. This function
 * widens it to `Ailment` before reading. The default itself has exactly one definition,
 * `epub.ts`'s `DEFAULT_EPUB_VERSION`.
 */
export function epubVersionOf(ailment: Ailment): EpubVersion {
  return ailment.epubVersion ?? DEFAULT_EPUB_VERSION;
}

/**
 * The healthy skeleton. The identifier is fixed rather than random — a UUID is the
 * easiest place to break determinism.
 */
function baseSpec(ailment: Ailment): EpubSpec {
  return {
    epubVersion: epubVersionOf(ailment),
    title: `frond fixture — ${ailment.name}`,
    language: "ja",
    identifier: `urn:uuid:frond-fixture-${ailment.name}`,
    stylesheet: HEALTHY_STYLESHEET,
    readingOrder: healthySections(),
  };
}

export interface Ailment {
  /** The ailment's name, which is also the filename (without `.epub`). When the version is not the default, the name carries a suffix. */
  readonly name: string;
  /**
   * The packaging version. Omitted, it is `"epub3"` — omitted rather than written on
   * every entry, so that the ten existing fixtures' bytes do not change merely because
   * this axis appeared.
   */
  readonly epubVersion?: EpubVersion;
  /** A one-line statement of which ailment this file encodes. */
  readonly description: string;
  /** Adds the ailment to the healthy skeleton. The change is confined to a single point — that is the entire value of these fixtures. */
  readonly afflict: (base: EpubSpec) => EpubSpec;
}

// `as const satisfies` rather than `: readonly Ailment[]`: the latter would widen name to
// string, so buildFixture("typo") would pass type checking and only blow up at runtime.
export const AILMENTS = [
  {
    name: "vertical-japanese",
    description:
      "a healthy vertical Japanese book — the control for the three vertical ailments, and the book used by the Renderer vertical tests and the foliate spike",
    afflict: (base) => ({
      ...base,
      stylesheet: base.stylesheet + VERTICAL_ON_HTML,
    }),
  },
  {
    name: "writing-mode-on-body",
    description:
      "the vertical declaration is on <body> rather than <html> (a book produced by InDesign); a library reading only <html> judges it horizontal",
    afflict: (base) => ({
      ...base,
      stylesheet: base.stylesheet + VERTICAL_ON_BODY,
    }),
  },
  {
    name: "font-size-important",
    description:
      "the book uses font-size !important to override the reader's font size — the reader's ability is blocked by the book, and frond has to win",
    afflict: (base) => ({
      ...base,
      stylesheet: `${base.stylesheet}
body {
  font-size: 12px !important;
}

p {
  font-size: 12px !important;
}
`,
    }),
  },
  {
    name: "fixed-width-800",
    description: "a fixed width of 800px; on a small screen the right half is clipped and unreadable",
    afflict: (base) => ({
      ...base,
      stylesheet: `${base.stylesheet}
body {
  width: 800px;
}
`,
    }),
  },
  {
    name: "toc-href-percent-comma",
    description:
      "the nav href encodes the comma in the filename as %2c while the manifest uses a literal comma — without normalization, tapping the table of contents silently does nothing",
    afflict: percentEncodedComma,
  },
  {
    name: "toc-href-parent-prefix",
    description:
      "the navigation document is in a subdirectory and the TOC hrefs carry a ../ prefix — resolving them against the package document does not line up",
    afflict: (base) => ({
      ...base,
      navigationPath: "nav/nav.xhtml",
    }),
  },
  {
    name: "ppd-rtl-vertical",
    description: "vertical with page-progression-direction=rtl — both the page turn direction and the position slider have to mirror",
    afflict: (base) => ({
      ...base,
      stylesheet: base.stylesheet + VERTICAL_ON_HTML,
      pageProgressionDirection: "rtl",
    }),
  },
  {
    name: "hardcoded-colors",
    description: "hard-coded foreground and background colours, defeating the reader's dark mode",
    afflict: (base) => ({
      ...base,
      stylesheet: `${base.stylesheet}
body {
  color: #000000;
  background-color: #ffffff;
}
`,
    }),
  },
  {
    name: "huge-single-section",
    description:
      "the whole book is one enormous Section — the pressure point for pagination performance and the whole-book index (fraction)",
    afflict: (base) => ({
      ...base,
      readingOrder: [
        {
          path: "section-1.xhtml",
          title: "長い一日",
          body: hugeBody(),
        },
      ],
    }),
  },
  {
    name: "empty-and-image-only-sections",
    description:
      "one empty Section and one image-only Section — the boundary for pagination and positioning when there is no text",
    afflict: (base) => ({
      ...base,
      readingOrder: [
        base.readingOrder[0]!,
        { path: "section-2.xhtml", title: "白紙", body: "" },
        {
          path: "section-3.xhtml",
          title: "図版",
          body: `    <img src="${IMAGE_PATH}" alt="市松模様の図版"/>`,
        },
      ],
      resources: [
        {
          path: IMAGE_PATH,
          mediaType: "image/png",
          contents: PLATE_IMAGE,
        },
      ],
    }),
  },
  {
    name: "healthy-epub2",
    epubVersion: "epub2",
    description:
      "a healthy EPUB 2 skeleton (OPF 2.0 + NCX, no page progression direction) — the control for every ailment on the EPUB 2 route",
    // The difference is in the version itself rather than the content: this differs from
    // the EPUB 3 healthy skeleton only by version, so afflict adds nothing.
    afflict: (base) => base,
  },
  {
    name: "cover-image-property",
    description:
      "the cover goes through EPUB 3's manifest properties=\"cover-image\" — the main source of bookshelf thumbnails",
    afflict: (base) => ({
      ...base,
      cover: { ...COVER_RESOURCE, declaredBy: ["cover-image-property"] },
    }),
  },
  {
    name: "cover-meta-name-epub2",
    epubVersion: "epub2",
    description:
      "the cover goes through EPUB 2's <meta name=\"cover\"> — EPUB 2 has no properties, so this is the only route",
    afflict: coverByMetaName,
  },
  {
    name: "toc-href-percent-comma-epub2",
    epubVersion: "epub2",
    description:
      "the same %2c grows on the NCX's content src — the 48 lowercase %2c in the sample are exactly this vehicle's shape",
    // Shares one afflict with the EPUB 3 fixture. The ailment's shape (the same character,
    // the same lower case, the same one-sided encoding) therefore cannot drift between the
    // two — written twice, it would.
    afflict: percentEncodedComma,
  },
  {
    name: "toc-href-parent-prefix-epub2",
    epubVersion: "epub2",
    description:
      "the NCX is in a subdirectory and content src carries a ../ prefix — resolving it against the package document does not line up",
    // The directory is called `toc/` rather than `nav/`: CONTEXT.md reserves nav for the
    // EPUB 3 navigation document, and putting an NCX in it would read like the same file
    // with a changed extension.
    afflict: (base) => ({
      ...base,
      navigationPath: "toc/toc.ncx",
    }),
  },
  {
    name: "nested-toc",
    description:
      "a nested TOC in nav.xhtml — <ol> nested inside <li>, two levels, with the second level mixing hrefs with and without fragments",
    afflict: nestedToc,
  },
  {
    name: "nested-toc-epub2",
    epubVersion: "epub2",
    description:
      "a nested TOC in the NCX — navPoint nested in navPoint, two levels, with playOrder continuous across levels",
    // The same tree as the EPUB 3 fixture, written for the two vehicles. Sharing afflict
    // makes "the same TOC grows into two shapes across the two vehicles" a pair that can be
    // compared side by side, rather than two separately written trees that happen to look
    // alike.
    afflict: nestedToc,
  },
  {
    name: "manifest-href-parent-prefix",
    description:
      "a manifest href walks up to the package root with ../ and the target really exists — a good book, used to block the false positive \"the OPF points at a missing file\"",
    afflict: (base) => ({
      ...base,
      resources: [
        {
          path: ROOT_SCRIPT_PATH,
          // The media type as that real retail book writes it. EPUB 3.3 now recommends
          // text/javascript, but a fixture has to play the shape books actually have.
          mediaType: "application/javascript",
          contents: ROOT_SCRIPT,
        },
      ],
    }),
  },
  {
    name: "writing-mode-prefixed-only",
    description:
      "vertical is declared only with the -epub- and -webkit- prefixed property names, never unprefixed — Firefox never receives the declaration and lays the whole book out horizontally",
    afflict: (base) => ({
      ...base,
      stylesheet: base.stylesheet + VERTICAL_ON_BODY_PREFIXED,
    }),
  },
  {
    name: "obfuscated-font-idpf",
    description:
      "a font obfuscated with the IDPF algorithm, declared by META-INF/encryption.xml — decoding it wrongly throws nothing, and the symptom is a page full of tofu for the reader",
    afflict: (base) => ({
      ...base,
      resources: [
        {
          path: FONT_PATH,
          mediaType: "font/otf",
          contents: FONT_BYTES,
          obfuscation: "idpf",
        },
      ],
    }),
  },
  {
    name: "cover-meta-name",
    description:
      "an EPUB 3 cover declared only with <meta name=\"cover\">, with no properties in the manifest — an implementation dispatching the cover on version leaves this book without a thumbnail",
    afflict: coverByMetaName,
  },
  {
    name: "writing-mode-behind-import",
    description:
      "the stylesheet the content document <link>s is one line of @import string, with all the typographic intent in the imported file — an implementation that does not expand @import loses the entire stylesheet and lays the whole book out horizontally",
    afflict: verticalBehindImport,
  },
  {
    name: "hidden-trailing-notes",
    description:
      "a section's body text is followed by display:none footnotes, so the last text node in document order is not drawable — taking it as the end of the content squashes the section's page count to 1 and the reader cannot turn past the first page",
    afflict: hiddenTrailingNotes,
  },
  {
    name: "plate-taller-than-page",
    description:
      "a plate taller than one page, wrapped in a div that declares no height — a percentage max-block-size will not resolve here, and the lower half of the image is clipped and unreachable by turning pages",
    afflict: plateTallerThanPage,
  },
  {
    name: "table-taller-than-page",
    description:
      "a table taller than one page — Chromium breaks it across adjacent columns while Firefox and WebKit do not, so the lower half is clipped and unreadable (the three disagree; this holds the status quo)",
    afflict: tableTallerThanPage,
  },
  {
    name: "scripted-content-in-body",
    description:
      "a <script> and an <iframe> sit between two paragraphs of the body — removing them (ADR-0006) shifts the CFI index of every following sibling, and this file is what pins that",
    afflict: scriptedContentInBody,
  },
] as const satisfies readonly Ailment[];

/** The ailment's name. Also the `<name>.epub` filename. */
export type AilmentName = (typeof AILMENTS)[number]["name"];

/**
 * The TOC href encodes the comma in the filename as `%2c`, while the manifest and the
 * archive entry name use a literal comma. **Only the TOC side is encoded** — encode both
 * sides and string comparison simply succeeds, leaving this fixture carrying no ailment
 * at all.
 *
 * The sample's EPUB 2 (Simplified Chinese, produced by calibre) has 48 such hrefs, all
 * lowercase `%2c` with the comma mid-filename, and the encoding **happens only on the
 * NCX**: the same file has a literal comma in both the manifest and the zip entry name.
 * So this function is shared by two fixtures — the nav one and the NCX one, differing
 * only in vehicle.
 */
function percentEncodedComma(base: EpubSpec): EpubSpec {
  const path = "section-2,continued.xhtml";
  return {
    ...base,
    readingOrder: base.readingOrder.map((section, index) =>
      index === 1
        ? { ...section, path, navHref: path.replaceAll(",", "%2c") }
        : section,
    ),
  };
}

/**
 * The cover declared only with `<meta name="cover">`.
 *
 * The EPUB 2 fixture and the EPUB 3 one share it — they are a side-by-side pair, and the
 * only difference there should be between them is the version. Written inline twice,
 * "they differ only by version" would be a coincidence rather than structure, and nothing
 * would hold "EPUB 3 has to recognise the old notation too" in place (ADR-0007).
 */
function coverByMetaName(base: EpubSpec): EpubSpec {
  return { ...base, cover: { ...COVER_RESOURCE, declaredBy: ["meta-name"] } };
}

/**
 * The stylesheet brought in by `@import`. Under the content directory, at the same level
 * as `style.css` — following the shape of that toolchain in the sample
 * (`item/style/book-style.css` sitting beside the files it imports).
 */
const IMPORTED_STYLESHEET_PATH = "book-style.css";

/**
 * The typographic intent is moved wholesale into the `@import`ed stylesheet, leaving
 * `style.css` with nothing but that one `@import` line.
 *
 * This is the shape of four books in the sample (九歌112年散文選, 創業投資聖經,
 * 原子習慣, 大器可以晚成, all from the same Kadokawa/BookCreator toolchain): the content
 * documents `<link>` a single aggregator file, and that file contains **nothing but
 * `@import` strings** apart from an `@charset` — a notation like
 * `@import "style-standard.css";` has not one `url(` in it. An implementation recognising
 * only `url()` has therefore already lost before it even resolves a relative path: that
 * stylesheet disappears entirely, and all four vertical books lay out horizontally.
 *
 * ## It pairs with `vertical-japanese`
 *
 * The two declare **character-for-character identical** content (`HEALTHY_STYLESHEET`
 * plus `VERTICAL_ON_HTML`), and the only difference is which file those bytes live in.
 * Were there more than that one difference, `@import` would no longer be the only
 * explanation for "why is one vertical and the other horizontal".
 *
 * The quoted notation rather than `@import url(book-style.css)`: the string form is the
 * one measured in the sample. The `url()` form is another branch of the same expander,
 * and testing it does not need a fixture — that is a pure string function's business
 * (`tests/node/renderer/css.test.ts`).
 *
 * `@charset` is deliberately omitted even though all four books have it. It would stack a
 * second axis on this file (whether an `@charset` still counts inside a stylesheet inlined
 * into a `<style>`), and that is verified in the real-book scan rather than here.
 */
function verticalBehindImport(base: EpubSpec): EpubSpec {
  return {
    ...base,
    stylesheet: `@import "${IMPORTED_STYLESHEET_PATH}";\n`,
    resources: [
      {
        path: IMPORTED_STYLESHEET_PATH,
        mediaType: "text/css",
        contents: new TextEncoder().encode(base.stylesheet + VERTICAL_ON_HTML),
      },
    ],
  };
}

/**
 * A stretch of `display: none` footnotes following the body text.
 *
 * The norm in the sample: footnotes placed **after** the body text, hidden by default and
 * revealed when the reader taps the marker (《投資最重要的事》's `.hide` and `.footnote`;
 * the same shape was measured in several other books). An entire hidden `nav.xhtml` is
 * the same shape.
 *
 * The ailment is that **the last text node in document order is not drawable**: taking its
 * rectangle (all zeros) as the answer to "how far does the content extend" computes the
 * section's page count as 1, so the reader can only read the first page
 * (`section-view.ts`'s `lastPageWithContent`).
 *
 * ## Why this section's body text is unusually long
 *
 * The length is not a second ailment, it is **a precondition for the symptom to exist**:
 * in a one-page section, "the page count squashed to 1" and the correct answer are the
 * same number, so this fixture would prove nothing. The body text therefore has to lay out
 * across several pages — `PAGINATING_PARAGRAPH_COUNT` is the number that exists for this.
 *
 * Only the last section is touched and the first two stay healthy:
 * `huge-single-section` is the "readingOrder has only one Section" ailment, and were this
 * fixture to change the readingOrder as well, the two would become indistinguishable to
 * the probes (`single-ailment.test.ts`).
 */
function hiddenTrailingNotes(base: EpubSpec): EpubSpec {
  return {
    ...base,
    stylesheet: `${base.stylesheet}
.note {
  display: none;
}
`,
    readingOrder: base.readingOrder.map((section, index) =>
      index === base.readingOrder.length - 1
        ? { ...section, body: paginatingBodyWithHiddenNotes(section.title) }
        : section,
    ),
  };
}

/**
 * Body text that lays out across several pages, plus the hidden footnotes on the tail.
 *
 * The paragraph count is fixed rather than random (determinism). The value has to put the
 * body text over one page at 800x600, 16px, two columns — measured, it lands around four
 * pages, with enough slack to absorb small changes in font metrics without falling back to
 * one page; and once it falls back to one page, this fixture no longer carries its ailment
 * (see `hiddenTrailingNotes`).
 */
const PAGINATING_PARAGRAPH_COUNT = 80;

/** How many footnotes. Two is enough — what matters is "there is hidden text on the tail", not the count. */
const HIDDEN_NOTE_COUNT = 2;

function paginatingBodyWithHiddenNotes(title: string): string {
  const sentences = PROSE.flatMap((prose) => prose.paragraphs);

  return [
    `    <h1>${title}</h1>`,
    ...Array.from(
      { length: PAGINATING_PARAGRAPH_COUNT },
      (_, index) => `    <p>${sentences[index % sentences.length]}</p>`,
    ),
    // The footnotes come after the body text and are the **last** thing — the entire point
    // of the ailment is in that position.
    ...Array.from(
      { length: HIDDEN_NOTE_COUNT },
      (_, index) =>
        `    <div class="note" id="note-${index + 1}"><p>${
          sentences[index % sentences.length]
        }</p></div>`,
    ),
  ].join("\n");
}

const TALL_PLATE_PATH = "images/tall-plate.png";

/**
 * A plate **taller than one page**, wrapped in a div that declares no height.
 *
 * The plate notation found in the sample (four books, seven sections in total):
 *
 * ```html
 * <div class="pic"><span><img src="…"/></span></div>
 * ```
 * ```css
 * .pic { text-align: center; margin: 1.5em auto; width: 98% }
 * .pic img { max-width: 100% }
 * ```
 *
 * The book itself only handles the **inline axis** (`max-width`), leaving the block axis
 * uncapped — which is exactly the gap frond's `cap-overflowing-boxes` is supposed to fill.
 * But `max-block-size: 100%` **will not resolve** in this shape: a percentage max-height
 * needs a definite containing-block size, and `.pic` is `height: auto`, so the whole
 * declaration is treated as `none` and the image stretches past and is clipped by
 * `overflow: hidden` (`src/renderer/layout.ts` has the measured numbers).
 *
 * **The wrapper is the point of this fixture, not decoration.** The same mechanism holds
 * when the image sits directly under `<body>` (layout.ts sets body's block-size to auto),
 * but that would lose the real-world shape of "the book wrapped it itself", and were the
 * fix ever changed to "only handle body's direct children", an unwrapped fixture would
 * pass while real books stayed broken.
 *
 * The image's aspect ratio is deliberately extreme (64 × 720), with a dark band at the very
 * bottom: when the lower half is clipped, that band disappears from the screen, which is
 * visible at a glance when reading the screenshots.
 */
function plateTallerThanPage(base: EpubSpec): EpubSpec {
  return {
    ...base,
    stylesheet: `${base.stylesheet}
.plate {
  margin: 1.5em auto;
  text-align: center;
}

.plate img {
  max-inline-size: 100%;
}
`,
    readingOrder: base.readingOrder.map((section, index) =>
      index === base.readingOrder.length - 1
        ? {
            ...section,
            body: `${section.body}
    <div class="plate"><img src="${TALL_PLATE_PATH}" alt="縦長の図版"/></div>`,
          }
        : section,
    ),
    resources: [
      {
        path: TALL_PLATE_PATH,
        mediaType: "image/png",
        contents: TALL_PLATE_IMAGE,
      },
    ],
  };
}

/**
 * A tall plate. 720px high, longer than a 800x600 viewport can fit along the block axis.
 *
 * The dark band at the bottom (the last 8%) is there for reading the result: when the
 * image is not clipped it is on screen, and when it is clipped it is not. The horizontal
 * stripes also make "has it been squashed" visible — evenly spaced stripes growing denser
 * means it has.
 */
const TALL_PLATE_IMAGE = encodePng({
  width: 64,
  height: 720,
  sample: (_x, y) => (y >= 662 ? 0x10 : (y >> 5) % 2 === 0 ? 0x30 : 0xe0),
});

/**
 * A **table taller than one page**.
 *
 * Three books in the sample, nine sections in total, have this shape (《幽靈帝國拜占庭》,
 * 《激進市場》, 《FIRE．致富實踐》), and the worst section's table is 3115px tall against a
 * column of only 552px.
 *
 * It pairs with `plate-taller-than-page`, and **there have to be two of them**: both are
 * "a box taller than one column", but the three browsers treat them differently — the image
 * one can be brought down with `max-block-size` (`max-height` works on replaced elements)
 * while the table one cannot (`max-height` is a **lower** bound for tables, not an upper
 * one, so a table is as long as its content). So frond can fix the image one and cannot fix
 * the table one, and Chromium disagrees with the other two on tables besides
 * (`docs/browser-quirks.md`). Combined into one file, "which kind of box is fixable" would
 * become indistinguishable.
 *
 * **No CSS is added deliberately**: an unstyled `<table>` already carries this ailment, and
 * one more rule would only stack a second axis on the same file.
 */
function tableTallerThanPage(base: EpubSpec): EpubSpec {
  return {
    ...base,
    readingOrder: base.readingOrder.map((section, index) =>
      index === base.readingOrder.length - 1
        ? { ...section, body: `${section.body}\n${tallTable()}` }
        : section,
    ),
  };
}

/**
 * A `<script>` and an `<iframe>` between two paragraphs of the **body**.
 *
 * ## No real book has this shape, which is why it has to be synthetic
 *
 * Measured over 34 books in circulation (1638 sections): `<script>` in `<body>` is **0**,
 * and so are `<iframe>` / `<object>` / `<embed>` / `<frame>` and `on*` attributes. The 1456
 * `<script>` elements that do exist are all in `<head>`, all one shape (the Kobo toolchain's
 * `<script type="text/javascript" src="../js/kobo.js"/>`), and removing something from
 * `<head>` shifts no CFI an annotation could be pointing at.
 *
 * ## What it holds
 *
 * `stripScriptedContent` (ADR-0006) `remove()`s those elements, and that is the **only**
 * place frond changes the node count — every other intervention preserves it
 * (`link.replaceWith(style)` is 1:1, frond's own two `<style>` elements only append to
 * `<head>`). One removed element shifts the CFI index of every following sibling by two, and
 * the symptom of that is a reader's highlight silently landing somewhere else.
 *
 * So this file exists to make that shift **visible to a test** (`isolation.spec.ts`'s "the
 * CFI of a following sibling"), not because the shape was measured. The two removed elements
 * sit **between** paragraphs rather than at the end for exactly that reason: at the end there
 * is no following sibling and the shift would have nothing to show.
 *
 * The script is written inline rather than with a `src`: a `src` would need a resource in the
 * manifest, and "this book carries an extra resource" is a second axis this file must not
 * grow (`single-ailment.test.ts`).
 */
function scriptedContentInBody(base: EpubSpec): EpubSpec {
  return {
    ...base,
    readingOrder: base.readingOrder.map((section, index) =>
      index === 0
        ? { ...section, body: withScriptedContentAfterFirstParagraph(section.body) }
        : section,
    ),
  };
}

/**
 * Splices the two elements in after the body's first paragraph.
 *
 * Written against the assembled body text rather than by rebuilding it from `PROSE`: the
 * paragraphs either side of the insertion have to be **character-for-character** the healthy
 * skeleton's, or the difference from the control stops being a single point.
 */
function withScriptedContentAfterFirstParagraph(body: string): string {
  const lines = body.split("\n");
  const firstParagraph = lines.findIndex((line) => line.includes("<p"));

  return [
    ...lines.slice(0, firstParagraph + 1),
    `    <script type="text/javascript">document.title = "scripted";</script>`,
    `    <iframe src="about:blank"></iframe>`,
    ...lines.slice(firstParagraph + 1),
  ].join("\n");
}

/**
 * How many table rows. The count has to put the table clearly past one column's block-axis
 * length (about 552px at 800x600) — a row is roughly 29px, so 30 rows lay out to over
 * eight hundred px, with enough slack to absorb changes in font metrics.
 */
const TALL_TABLE_ROW_COUNT = 30;

function tallTable(): string {
  const sentences = PROSE.flatMap((prose) => prose.paragraphs);

  return [
    `    <table>`,
    `      <tbody>`,
    ...Array.from({ length: TALL_TABLE_ROW_COUNT }, (_, index) => {
      const ordinal = index + 1;
      return `        <tr><td>${ordinal}</td><td>${sentences[index % sentences.length]}</td></tr>`;
    }),
    `      </tbody>`,
    `    </table>`,
  ].join("\n");
}

/**
 * How many sub-entries each Section hangs in the TOC.
 *
 * The shape is scaled down from the sample's nested EPUB 2 (Traditional Chinese, Sigil →
 * calibre): that one has 52 navPoints at depth 2, 14 at the top level and 38 at the
 * second, and **not every top-level entry has children**. Here it is 3 top-level and 4
 * second-level, with the last top-level entry having no children — the same shape, scaled
 * down onto the skeleton's three Sections.
 */
const NESTED_TOC_SUBITEM_COUNTS = [2, 2, 0];

/** The second level's ordinals; the length is `NESTED_TOC_SUBITEM_COUNTS`'s maximum. Synthetic text. */
const SUBITEM_ORDINALS = ["一", "二"];

/** Which id Section `index`'s sub-entry `subindex` points at. */
function subitemAnchorId(index: number, subindex: number): string {
  return `part-${index + 1}-${subindex + 1}`;
}

/**
 * Grows the TOC to two levels. The readingOrder is untouched — nesting is **a level of the
 * TOC**, not of the reading order, and conflating the two is exactly where this ailment is
 * most easily implemented wrongly.
 *
 * **Every sub-entry points at its own anchor**, with no two sharing a target. Were the
 * first sub-entry to omit its fragment, its href would be word-for-word identical to its
 * parent's, and "parent and child share a target" is an extra property the issue never
 * asked for — after an implementation that de-duplicates silently swallows that entry, the
 * test would still look correct.
 *
 * The real-book property "mixing hrefs with and without fragments" still holds, and within
 * one navigation document: none of the three top-level entries carry one, and all four
 * second-level entries do. The anchors are written into the paragraphs by
 * `healthySections`, so every fragment points at a real id — otherwise this fixture would
 * carry a second ailment, "the TOC points at a non-existent position".
 */
function nestedToc(base: EpubSpec): EpubSpec {
  const sections = healthySections(
    (index) =>
      new Map(
        Array.from(
          { length: NESTED_TOC_SUBITEM_COUNTS[index] ?? 0 },
          (_, subindex) => [subindex + 1, subitemAnchorId(index, subindex)],
        ),
      ),
  );

  return {
    ...base,
    readingOrder: sections.map((section, index) => {
      const count = NESTED_TOC_SUBITEM_COUNTS[index] ?? 0;
      if (count === 0) return section;

      return {
        ...section,
        subitems: Array.from({ length: count }, (_, subindex) => ({
          title: `${section.title}・${SUBITEM_ORDINALS[subindex]!}`,
          fragment: subitemAnchorId(index, subindex),
        })),
      };
    }),
  };
}

/**
 * A resource at the package root, pointed at by the manifest with `../`.
 *
 * The shape is taken from a real retail book (Kobo, EPUB 3): the OPF is at
 * `OEBPS/content.opf`, the manifest has `href="../js/kobo.js"`, and `js/kobo.js` really
 * does exist at the ZIP root. Resolved by URL rules it is `js/kobo.js`, inside the
 * package, **conforming and resolvable**.
 *
 * An implementation that concatenates the href onto the content directory would look for
 * the literal entry name `EPUB/../js/reader.js`, fail to find it, and judge a good book to
 * have "an OPF pointing at a missing file". This fixture blocks that false positive.
 */
const ROOT_SCRIPT_PATH = "../js/reader.js";

const ROOT_SCRIPT = new TextEncoder().encode(
  "// frond fixture：內容不重要，位置才是——這個檔案在封裝根，manifest 用 ../ 指到它。\n",
);

const IMAGE_PATH = "images/plate.png";

const FONT_PATH = "fonts/obfuscated.otf";

/**
 * The obfuscated "font".
 *
 * **It is not a real OTF**, and that is deliberate: the ailment this fixture plays is
 * **the decoding step** — key derivation, the masked range, and whether masking too far
 * destroys the bytes after it. A real font would carry two more axes (licensing, and "what
 * this font looks like"), and neither has anything to do with decoding. Testing "how a book
 * lays out in its own font" is a Renderer issue, and it would need a different fixture too.
 *
 * The length deliberately exceeds 1040: obfuscation masks only the first 1040 bytes, and
 * masking too far is the easiest step to get wrong — with a file too short, nothing would
 * expose that mistake. The content is a deterministic arithmetic sequence, not random.
 */
const FONT_BYTES = Uint8Array.from({ length: 1200 }, (_, index) => (index * 31 + 7) % 256);

const COVER_PATH = "images/cover.png";

/**
 * The cover image. Deliberately **a different size and a different pattern** from the body
 * plate (`PLATE_IMAGE`) — when a bookshelf thumbnail grabs the wrong image, the fact that
 * it grabbed a body illustration has to be visible at a glance, and two images that look
 * alike would hide it. The portrait aspect ratio is also the shape of a book cover.
 */
const COVER_RESOURCE = {
  path: COVER_PATH,
  mediaType: "image/png",
  contents: encodePng({
    width: 100,
    height: 160,
    // A gradient with a border: the border proves the image was not clipped, and the
    // gradient's direction proves it was not flipped vertically.
    sample: (x, y) =>
      x < 6 || y < 6 || x >= 94 || y >= 154 ? 0x10 : 0x40 + Math.floor(y * 0.75),
  }),
} as const;

/**
 * The body plate. A checkerboard (市松模様) — it shows at a glance whether it was drawn at
 * all and whether it was stretched, without bringing in any copyrighted material.
 */
const PLATE_IMAGE = encodePng({
  width: 96,
  height: 128,
  sample: (x, y) => (((x >> 4) + (y >> 4)) % 2 === 0 ? 0x20 : 0xe0),
});

/** How long a Section can get. The paragraph count is deliberately fixed; determinism cannot rest on randomness. */
const HUGE_PARAGRAPH_COUNT = 1200;

function hugeBody(): string {
  const sentences = PROSE.flatMap((prose) => prose.paragraphs);
  return [
    "    <h1>長い一日</h1>",
    ...Array.from(
      { length: HUGE_PARAGRAPH_COUNT },
      (_, index) => `    <p>${sentences[index % sentences.length]}</p>`,
    ),
  ].join("\n");
}

/** Adds the ailment to the healthy skeleton, assembling this ailment's complete EpubSpec. */
export function specFor(ailment: Ailment): EpubSpec {
  return ailment.afflict(baseSpec(ailment));
}
