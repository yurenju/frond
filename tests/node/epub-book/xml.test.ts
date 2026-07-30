import { XMLValidator } from "fast-xml-parser";
import { unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { EpubOpenError } from "../../../src/epub/errors.ts";
import { parseXml, type XmlElement } from "../../../src/epub/xml.ts";
import { buildFixture, syntheticFixtures } from "../../../src/test-fixtures/index.ts";

/**
 * The hand-written XML parser: its well-formedness verdict is compared against
 * `fast-xml-parser`, and the tree's behaviour is asserted on its own.
 *
 * `fast-xml-parser` is a **reference implementation** (CONTEXT.md) and appears only in
 * tests. The only thing comparable here is **a fact both sides ought to agree on** —
 * the "is this document well-formed" boolean. Error messages and tree shapes are
 * supposed to differ between the two, so they cannot be compared.
 *
 * Comparing that one boolean is worthwhile because it is exactly `xml.ts`'s most
 * breakable and least visible slot: let the parser be one notch more **lenient** than
 * the validator and a broken book degrades from "this book is broken" to "that field
 * would not read" — the TOC length is right, the hrefs are right, only the text is
 * empty. No test goes red on that kind of failure.
 */

function parse(source: string): XmlElement {
  return parseXml(source, { reason: "malformed-container", label: "test.xml" });
}

/** Does frond consider this document well-formed. */
function frondAccepts(source: string): boolean {
  try {
    parse(source);
    return true;
  } catch (error) {
    if (error instanceof EpubOpenError) return false;
    throw error;
  }
}

/** Does the reference implementation consider this document well-formed. */
function oracleAccepts(source: string): boolean {
  return XMLValidator.validate(source, { allowBooleanAttributes: false }) === true;
}

describe("the well-formedness verdict agrees with the reference implementation", () => {
  const AGREED: Record<string, string> = {
    "the smallest document": `<a/>`,
    "with a declaration": `<?xml version="1.0" encoding="utf-8"?><a/>`,
    "with a BOM": `﻿<?xml version="1.0"?><a/>`,
    "nesting": `<a><b><c/></b></a>`,
    "nesting the same tag": `<a><a/></a>`,
    "mixed content": `<a>前<span>言</span>後</a>`,
    "CDATA": `<a>前<![CDATA[<b>&未跳脫]]>後</a>`,
    "comments before and after the root element": `<!-- 前 --><a><!-- 中 --></a><!-- 後 -->`,
    "a processing instruction": `<?xml version="1.0"?><?xml-stylesheet href="x.css"?><a/>`,
    "DOCTYPE": `<!DOCTYPE html><a/>`,
    "DOCTYPE with an internal subset": `<!DOCTYPE ncx PUBLIC "-//X" "y.dtd" [ <!ENTITY f "b"> ]><a/>`,
    "an attribute in single quotes": `<a x='1'/>`,
    "an attribute with escapes": `<a x="&amp;&lt;&quot;"/>`,
    "attributes across lines": `<a\n  x="1"\n  y="2"\n/>`,
    "a namespace prefix": `<package xmlns:dc="http://x" xml:lang="zh"><dc:title>書</dc:title></package>`,
    "an unrecognized named entity": `<a>&nbsp;</a>`,
    "a numeric character reference": `<a>&#8212;&#x2014;</a>`,
    "an element holding only whitespace": `<a>   </a>`,

    "no end tag": `<a><b></a>`,
    "the end tag's case does not match": `<A></a>`,
    "a surplus end tag": `<a/></a>`,
    "an attribute with no value": `<a x/>`,
    "an unquoted attribute": `<a x=1/>`,
    "a duplicate attribute": `<a x="1" x="2"/>`,
    "a bare &": `<a>a & b</a>`,
    "an unterminated comment": `<a><!-- x</a>`,
    "unterminated CDATA": `<a><![CDATA[x</a>`,
    "a tag name starting with a digit": `<1a/>`,
    "an empty document": ``,
    "only a comment": `<!-- x -->`,
    "only a declaration": `<?xml version="1.0"?>`,
    "the declaration is not first": `  <?xml version="1.0"?><a/>`,
    "no root element, only text": `文字`,
    "text before the root element": `前面有字<a/>`,
  };

  test.each(Object.entries(AGREED))("%s", (_name, source) => {
    expect(frondAccepts(source)).toBe(oracleAccepts(source));
  });

  test.each(syntheticFixtures.map((fixture) => fixture.name))(
    "both sides call every XML document in synthetic fixture %s well-formed",
    (name) => {
      const entries = unzipSync(buildFixture(name));
      const decoder = new TextDecoder();
      const documents = Object.entries(entries).filter(([path]) =>
        /\.(xml|opf|ncx|xhtml)$/.test(path),
      );

      expect(documents.length).toBeGreaterThan(0);
      for (const [path, contents] of documents) {
        const source = decoder.decode(contents);
        expect(oracleAccepts(source), path).toBe(true);
        expect(frondAccepts(source), path).toBe(true);
      }
    },
  );
});

/**
 * The two slots where frond is deliberately **stricter** than the reference
 * implementation.
 *
 * Neither is well-formed XML, and `XMLValidator` lets both through. Erring strict is
 * the safe direction (a broken book makes noise rather than silently yielding half a
 * tree), and the cost is possibly rejecting a book that is actually in circulation — so
 * there has to be a basis: **not one** of the 1767 XML documents in the sample steps on
 * either slot.
 *
 * "The reference implementation accepts it" is asserted here too. The day it tightens
 * up, this goes red — and the right response then is to move the case back into the
 * table above, rather than let the two quietly agree again with nobody knowing.
 */
describe("where frond is stricter than the reference implementation", () => {
  const STRICTER: Record<string, string> = {
    "two root elements": `<a/><b/>`,
    "text after the root element": `<a/>後面還有字`,
  };

  test.each(Object.entries(STRICTER))("%s", (_name, source) => {
    expect(frondAccepts(source)).toBe(false);
    expect(oracleAccepts(source)).toBe(true);
  });
});

describe("children, attributes and text are readable", () => {
  test("taking the first and taking them all", () => {
    const root = parse(`<manifest><item id="a"/><item id="b"/><other/></manifest>`);
    const manifest = root.child("manifest")!;

    expect(manifest.child("item")?.attribute("id")).toBe("a");
    expect(manifest.children("item").map((item) => item.attribute("id"))).toEqual(["a", "b"]);
    expect(manifest.children("missing")).toEqual([]);
    expect(manifest.child("missing")).toBeUndefined();
  });

  test("an absent attribute is undefined; an empty one is an empty string", () => {
    const a = parse(`<a x=""/>`).child("a")!;
    expect(a.attribute("x")).toBe("");
    expect(a.attribute("y")).toBeUndefined();
  });

  test("a self-closing element has no children and no text", () => {
    const a = parse(`<a><b/></a>`).child("a")!;
    expect(a.child("b")?.text()).toBe("");
    expect(a.child("b")?.children("c")).toEqual([]);
  });
});

describe("namespace prefixes", () => {
  const SOURCE = `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
    <metadata><dc:title>書名</dc:title><meta property="dcterms:modified">2024-01-01</meta></metadata>
  </package>`;

  test("prefixes are stripped from both elements and attributes", () => {
    const metadata = parse(SOURCE).child("package")!.child("metadata")!;
    expect(metadata.child("title")?.text()).toBe("書名");
  });

  test("swapping the prefix reads out the same thing", () => {
    // The prefix is a string the document picks for itself. An implementation matching
    // `dc:` literally reads no title from this book, and this book is entirely
    // conforming.
    const renamed = SOURCE.replaceAll("dc:", "d:").replace("xmlns:d=", "xmlns:d=");
    expect(parse(renamed).child("package")!.child("metadata")!.child("title")?.text()).toBe(
      "書名",
    );
  });

  test("xmlns is not itself an attribute", () => {
    // It declares a binding rather than something this document is saying. Keeping it
    // would make `attribute("xmlns")` answer with a namespace URI, and nowhere that reads
    // XML wants that.
    const packageElement = parse(SOURCE).child("package")!;
    expect(packageElement.attribute("xmlns")).toBeUndefined();
    expect(packageElement.attribute("dc")).toBeUndefined();
    expect(packageElement.attribute("version")).toBe("3.0");
  });

  test("xml:lang and lang together with the same value is not a collision", () => {
    // The standard XHTML form; every navigation document in the sample writes it this
    // way.
    const html = parse(`<html xml:lang="zh-TW" lang="zh-TW"><body/></html>`).child("html")!;
    expect(html.attribute("lang")).toBe("zh-TW");
  });

  test("a collision after stripping prefixes, with differing values, makes noise", () => {
    expect(frondAccepts(`<html xml:lang="zh-TW" lang="en"/>`)).toBe(false);
  });
});

describe("text", () => {
  test("the whole subtree's text is joined in document order", () => {
    // The measured shapes: one book has all 39 of its TOC entries' text wrapped in a
    // `<span>`, and another's second level is `<span><small>輯一</small>・儲藏室</span>`.
    // Reading only the element's own level yields an empty string; losing the order reads
    // it as `・儲藏室輯一`.
    expect(parse(`<a>前<span>言</span>後</a>`).child("a")!.text()).toBe("前言後");
    expect(parse(`<a><span>序</span></a>`).child("a")!.text()).toBe("序");
    expect(
      parse(`<a><span><small>輯一</small>・儲藏室</span></a>`).child("a")!.text(),
    ).toBe("輯一・儲藏室");
  });

  test("leading and trailing whitespace goes, the whitespace between stays", () => {
    expect(parse(`<title>\n  書名\n</title>`).child("title")!.text()).toBe("書名");
    // Keeping the whitespace between is what stops `Chapter One Revised` reading as
    // `ChapterOneRevised`.
    expect(parse(`<a>Chapter <em>One</em> Revised</a>`).child("a")!.text()).toBe(
      "Chapter One Revised",
    );
  });

  test("CDATA is text; the markup inside is not markup", () => {
    expect(parse(`<a>前<![CDATA[<b>&未跳脫]]>後</a>`).child("a")!.text()).toBe(
      "前<b>&未跳脫後",
    );
  });

  test("a comment is not text", () => {
    expect(parse(`<a>前<!-- 註解 -->後</a>`).child("a")!.text()).toBe("前後");
  });
});

describe("entities and character references", () => {
  test("the five predefined entities", () => {
    expect(parse(`<a>&amp;&lt;&gt;&quot;&apos;</a>`).child("a")!.text()).toBe(`&<>"'`);
    expect(parse(`<a x="&amp;&lt;"/>`).child("a")!.attribute("x")).toBe("&<");
  });

  test("numeric character references", () => {
    // This slot **differs** from the reference implementation: `fast-xml-parser` leaves
    // `&#8212;` as it stands, so a book writing its em dashes as numeric references ends
    // up with that literal string in its title. Resolving per the XML spec is the correct
    // behaviour.
    expect(parse(`<a>&#8212;&#x2014;&#65;</a>`).child("a")!.text()).toBe("——A");
  });

  test("an unrecognized named entity is left as it stands", () => {
    // It may have been declared by a DOCTYPE's internal subset, and frond does not expand
    // those declarations. Throwing would stop a conforming book from opening; leaving it
    // costs at most an extra run of characters in a title.
    expect(parse(`<a>&nbsp;</a>`).child("a")!.text()).toBe("&nbsp;");
  });

  test("a broken numeric reference is left as it stands rather than read as a number", () => {
    expect(parse(`<a>&#zz;</a>`).child("a")!.text()).toBe("&#zz;");
  });
});

describe("the error message can name the line", () => {
  test("the line number points at the offending line", () => {
    let message = "";
    try {
      parse(`<a>\n  <b>\n</a>`);
    } catch (error) {
      message = (error as EpubOpenError).message;
    }
    expect(message).toContain("test.xml is not well-formed XML");
    expect(message).toContain("line 3");
  });

  test("the open error thrown is the kind the caller specified", () => {
    try {
      parseXml(`<a>`, { reason: "malformed-navigation-document", label: "nav.xhtml" });
      expect.unreachable();
    } catch (error) {
      expect((error as EpubOpenError).reason).toBe("malformed-navigation-document");
      expect((error as EpubOpenError).message).toContain("nav.xhtml");
    }
  });
});
