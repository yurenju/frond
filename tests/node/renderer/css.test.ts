import { describe, expect, test } from "vitest";
import {
  demoteImportant,
  inlineImports,
  mapStylesheet,
  normalisePageBreaks,
  normalisePrefixedWritingMode,
  relativiseFontSizes,
  rewriteUrls,
} from "../../../packages/frond/src/renderer/css.ts";

/**
 * Every rewrite made to a book's stylesheet.
 *
 * Half the tests in this group ask what was **not** touched — that the untouched parts
 * are unchanged character for character is this layer's most important property. A
 * rewrite is an intervention in the book (ADR-0003), and one more intervention slipping
 * in unnoticed is exactly why that closed list exists; "one thing too many was
 * rewritten" is mostly invisible on screen, and only a character-for-character
 * comparison catches it.
 */

describe("locating declarations", () => {
  test("a colon in a selector is not a declaration", () => {
    // The most typical way a regular expression gets this wrong: the colon in `a:hover`
    // taken as the separator between property and value.
    const css = "a:hover { color: red }";
    const seen: string[] = [];

    mapStylesheet(css, (declaration) => {
      seen.push(declaration.property);
      return undefined;
    });

    expect(seen).toEqual(["color"]);
  });

  test("what an @media holds is rules, not declarations", () => {
    const seen: string[] = [];

    mapStylesheet("@media (min-width: 40em) { p { color: red } }", (declaration) => {
      seen.push(declaration.property);
      return undefined;
    });

    // `min-width: 40em` sits in the at-rule's prelude; it is not a declaration.
    expect(seen).toEqual(["color"]);
  });

  test("a semicolon inside a string or a url() does not split a declaration", () => {
    const seen: string[] = [];

    mapStylesheet(
      `p { content: "a;b"; background: url(data:image/gif;base64,AAAA) }`,
      (declaration) => {
        seen.push(declaration.property);
        return undefined;
      },
    );

    expect(seen).toEqual(["content", "background"]);
  });

  test("what is inside a comment does not count", () => {
    const seen: string[] = [];

    mapStylesheet("p { /* color: red; */ margin: 0 }", (declaration) => {
      seen.push(declaration.property);
      return undefined;
    });

    expect(seen).toEqual(["margin"]);
  });

  test("untouched means unchanged character for character, whitespace and comments included", () => {
    const css = `@charset "utf-8";

/* 書自己的註解 */
p   {
  margin : 0 0 1em ;
  text-indent:1em
}
`;

    expect(mapStylesheet(css, () => undefined)).toBe(css);
  });

  test("!important is split off the value, and the property name is lowercased", () => {
    const seen: Array<{ property: string; value: string; important: boolean }> = [];

    mapStylesheet("p { FONT-SIZE: 12px ! IMPORTANT }", (declaration) => {
      seen.push({
        property: declaration.property,
        value: declaration.value,
        important: declaration.important,
      });
      return undefined;
    });

    expect(seen).toEqual([{ property: "font-size", value: "12px", important: true }]);
  });
});

describe("prefixed writing-mode", () => {
  test("an equivalent unprefixed declaration is added", () => {
    // 《入境大廳》's shape: both prefixes written, the unprefixed one not once.
    const css = `body {
  -epub-writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
}`;

    const rewritten = normalisePrefixedWritingMode(css);

    expect(rewritten).toContain("-epub-writing-mode: vertical-rl");
    expect(rewritten).toContain("-webkit-writing-mode: vertical-rl");
    expect(rewritten.match(/[^-]writing-mode: vertical-rl/g)?.length).toBe(2);
  });

  test("the original declaration stays; it is not replaced", () => {
    const rewritten = normalisePrefixedWritingMode(
      "body { -epub-writing-mode: vertical-rl }",
    );

    expect(rewritten).toContain("-epub-writing-mode");
  });

  test("!important comes along with the added declaration", () => {
    const rewritten = normalisePrefixedWritingMode(
      "body { -webkit-writing-mode: vertical-rl !important }",
    );

    expect(rewritten).toContain("writing-mode: vertical-rl !important");
  });

  test("a book that already has an unprefixed declaration is left alone", () => {
    const css = "html { writing-mode: vertical-rl }";
    expect(normalisePrefixedWritingMode(css)).toBe(css);
  });

  test("the old tb-rl syntax needs no handling — all three accept it", () => {
    // Measured in docs/browser-quirks.md: all three accept it, and the computed value
    // normalizes to vertical-rl.
    const css = "html { writing-mode: tb-rl }";
    expect(normalisePrefixedWritingMode(css)).toBe(css);
  });
});

describe("page-break-*", () => {
  test("always becomes a column break", () => {
    const rewritten = normalisePageBreaks("h1 { page-break-before: always }");

    expect(rewritten).toContain("page-break-before: always");
    expect(rewritten).toContain("break-before: column");
  });

  test("avoid has the same name on both sides", () => {
    expect(normalisePageBreaks("figure { page-break-inside: avoid }")).toContain(
      "break-inside: avoid",
    );
  });

  test("left and right degrade to a column break — a multicol layout has no spreads", () => {
    expect(normalisePageBreaks("h1 { page-break-before: left }")).toContain(
      "break-before: column",
    );
  });

  test("an unrecognized value is left alone", () => {
    const css = "h1 { page-break-before: recto }";
    expect(normalisePageBreaks(css)).toBe(css);
  });

  test("nothing is added twice when the book already uses the modern spelling", () => {
    const css = "h1 { break-before: column }";
    expect(normalisePageBreaks(css)).toBe(css);
  });
});

describe("demoting !important", () => {
  const OVERRIDDEN = new Set(["font-size"]);

  test("for a property the reader overrode, the flag goes and the value stays", () => {
    const rewritten = demoteImportant("p { font-size: 12px !important }", OVERRIDDEN);

    expect(rewritten).toContain("font-size: 12px");
    expect(rewritten).not.toContain("!important");
  });

  test("for a property the reader did not override, the flag stays", () => {
    // ADR-0003's threshold: with no reader setting there is nothing being blocked, and so
    // no reason to intervene.
    const css = "p { color: #000 !important }";
    expect(demoteImportant(css, OVERRIDDEN)).toBe(css);
  });

  test("declarations of the same property without !important are left alone", () => {
    const css = "p { font-size: 12px }";
    expect(demoteImportant(css, OVERRIDDEN)).toBe(css);
  });

  test("an !important in a style attribute can be demoted too", () => {
    // This is the slot that matters: nothing anywhere in the cascade outranks an inline
    // !important.
    expect(
      demoteImportant("font-size: 12px !important; color: red", OVERRIDDEN, "declarations"),
    ).toBe("font-size: 12px; color: red");
  });
});

describe("converting absolute font sizes to rem", () => {
  test("px converts against the 16px basis", () => {
    expect(relativiseFontSizes("p { font-size: 12px }")).toContain("font-size: 0.75rem");
    expect(relativiseFontSizes("h1 { font-size: 32px }")).toContain("font-size: 2rem");
  });

  test("pt goes to px first, then converts", () => {
    // 12pt = 16px = 1rem.
    expect(relativiseFontSizes("p { font-size: 12pt }")).toContain("font-size: 1rem");
  });

  test("the book's own size hierarchy is left intact", () => {
    const rewritten = relativiseFontSizes(`h1 { font-size: 32px }
p { font-size: 16px }`);

    // 2 : 1, item for item the same as before the conversion — when the reader adjusts the
    // size, the whole document scales by one ratio.
    expect(rewritten).toContain("font-size: 2rem");
    expect(rewritten).toContain("font-size: 1rem");
  });

  test("nested absolute sizes do not compound", () => {
    // This is the entire reason for choosing rem over em. With em, the span would come out
    // at 0.75 × 0.625.
    const rewritten = relativiseFontSizes(`p { font-size: 12px }
p span { font-size: 10px }`);

    expect(rewritten).toContain("font-size: 0.75rem");
    expect(rewritten).toContain("font-size: 0.625rem");
  });

  test("values already in relative units are left alone", () => {
    for (const value of ["1.2em", "0.9rem", "120%", "larger", "medium"]) {
      const css = `p { font-size: ${value} }`;
      expect(relativiseFontSizes(css)).toBe(css);
    }
  });

  test("compound values are left alone — converting them wrongly is worse than not at all", () => {
    const css = "p { font-size: calc(12px + 1vw) }";
    expect(relativiseFontSizes(css)).toBe(css);
  });

  test("!important stays on the converted declaration", () => {
    // Converting and demoting the flag are two independent rewrites, each doing one
    // thing.
    expect(relativiseFontSizes("p { font-size: 12px !important }")).toContain(
      "font-size: 0.75rem !important",
    );
  });

  test("absolute sizes in a style attribute convert too", () => {
    expect(relativiseFontSizes("font-size: 24px; color: red", "declarations")).toBe(
      "font-size: 1.5rem; color: red",
    );
  });
});

describe("rewriting url()", () => {
  const resolve = (reference: string): string | undefined =>
    reference === "images/plate.png" ? "blob:https://example/abc" : undefined;

  test("a relative path becomes the resolved address", () => {
    expect(rewriteUrls("p { background: url(images/plate.png) }", resolve)).toContain(
      'url("blob:https://example/abc")',
    );
  });

  test("the quoted spellings are recognized too", () => {
    expect(rewriteUrls(`p { background: url("images/plate.png") }`, resolve)).toContain(
      'url("blob:https://example/abc")',
    );
    expect(rewriteUrls(`p { background: url('images/plate.png') }`, resolve)).toContain(
      'url("blob:https://example/abc")',
    );
  });

  test("what cannot be resolved is left as it stands", () => {
    const css = "p { background: url(data:image/gif;base64,AAAA) }";
    expect(rewriteUrls(css, resolve)).toBe(css);
  });

  test("an @import's url() is rewritten too — it is inside no declaration at all", () => {
    expect(rewriteUrls("@import url(images/plate.png);", resolve)).toContain(
      'url("blob:https://example/abc")',
    );
  });

  test("a url() inside a comment is left alone", () => {
    const css = "/* url(images/plate.png) */ p { margin: 0 }";
    expect(rewriteUrls(css, resolve)).toBe(css);
  });

  test("an @font-face's font goes through the same route", () => {
    const rewritten = rewriteUrls(
      `@font-face { font-family: "書"; src: url(images/plate.png) format("opentype") }`,
      resolve,
    );

    expect(rewritten).toContain('url("blob:https://example/abc") format("opentype")');
  });
});

/**
 * Expanding `@import` in place.
 *
 * This function exists because of what was measured on real books: four books in the
 * sample have content documents that `<link>` only an aggregate file, and that file
 * holds nothing but `@charset` and `@import` strings — without expansion the whole
 * stylesheet **disappears**, and four vertical books lay out horizontally
 * (`inlineImports` in `src/renderer/css.ts`).
 *
 * Testing both spellings is not about coverage: the `writing-mode-behind-import`
 * fixture plays only the string spelling (the one that was measured), and the `url()`
 * spelling is another branch of the same expander — something a pure string function
 * can test should not cost an extra book (ADR-0007).
 */
describe("expanding @import", () => {
  /** The expander only returns "the CSS at this address"; how a path resolves is document-source's business. */
  const expand = (reference: string): string | undefined =>
    reference === "book-style.css" ? "html { writing-mode: vertical-rl }" : undefined;

  test("the string spelling expands — this is the one measured in the sample", () => {
    expect(inlineImports(`@import "book-style.css";`, expand)).toBe(
      "html { writing-mode: vertical-rl }",
    );
  });

  test("the single-quoted and url() spellings are recognized too", () => {
    for (const rule of [
      `@import 'book-style.css';`,
      "@import url(book-style.css);",
      `@import url("book-style.css");`,
    ]) {
      expect(inlineImports(rule, expand)).toBe("html { writing-mode: vertical-rl }");
    }
  });

  test("the expansion goes exactly where the @import was — the cascade depends on order", () => {
    expect(
      inlineImports(`p { color: red }\n@import "book-style.css";\np { color: blue }`, expand),
    ).toBe("p { color: red }\nhtml { writing-mode: vertical-rl }\np { color: blue }");
  });

  test("what cannot be expanded is left as it stands rather than deleted", () => {
    // Deleting it would leave whoever investigates unable to see what the book asked for,
    // and an @import that resolves to nothing has the same on-screen effect as its
    // absence.
    const css = `@import "missing.css";\np { margin: 0 }`;
    expect(inlineImports(css, expand)).toBe(css);
  });

  test("one with a media query is wrapped in an @media; that condition may not be lost", () => {
    expect(inlineImports(`@import "book-style.css" print;`, expand)).toBe(
      "@media print {\nhtml { writing-mode: vertical-rl }\n}",
    );
    expect(
      inlineImports(`@import "book-style.css" screen and (min-width: 30em);`, expand),
    ).toBe(
      "@media screen and (min-width: 30em) {\nhtml { writing-mode: vertical-rl }\n}",
    );
  });

  test("the layer() and supports() spellings are left as they stand", () => {
    // Both change the cascade's layering and conditions, and splicing the text in does not
    // reproduce that.
    for (const rule of [
      `@import "book-style.css" layer(book);`,
      `@import "book-style.css" supports(display: grid);`,
    ]) {
      expect(inlineImports(rule, expand)).toBe(rule);
    }
  });

  test("an @import inside a comment or a string is not an at-rule", () => {
    for (const css of [
      `/* @import "book-style.css"; */ p { margin: 0 }`,
      `p { content: "@import \\"book-style.css\\";" }`,
    ]) {
      expect(inlineImports(css, expand)).toBe(css);
    }
  });

  test("an @import inside a block is non-conforming and is left as it stands", () => {
    const css = `@media print { @import "book-style.css"; }`;
    expect(inlineImports(css, expand)).toBe(css);
  });

  test("a stylesheet with no @import at all is unchanged character for character", () => {
    const css = `@charset "UTF-8";\n/* 書自己的 */\nhtml { font-family: "書" }\n`;
    expect(inlineImports(css, expand)).toBe(css);
  });

  test("multiple @imports in one stylesheet all expand", () => {
    const two = (reference: string): string | undefined =>
      reference === "a.css" ? "p { margin: 0 }" : reference === "b.css" ? "p { padding: 0 }" : undefined;

    expect(inlineImports(`@import "a.css";\n@import "b.css";`, two)).toBe(
      "p { margin: 0 }\np { padding: 0 }",
    );
  });
});

describe("@import's boundaries", () => {
  const expand = (): string | undefined => "p { margin: 0 }";

  test("an at-rule whose name merely starts like @import is left alone", () => {
    // Without the lookahead, `@imports` matches too, and that rule gets eaten whole.
    const css = "@imports-are-fun x;\np { color: red }";
    expect(inlineImports(css, expand)).toBe(css);
  });

  test("case does not matter", () => {
    expect(inlineImports(`@IMPORT "a.css";`, expand)).toBe("p { margin: 0 }");
  });

  test("an @import with no recognizable address is left as it stands", () => {
    const css = "@import ;";
    expect(inlineImports(css, expand)).toBe(css);
  });
});
