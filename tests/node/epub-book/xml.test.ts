import { XMLValidator } from "fast-xml-parser";
import { unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { EpubOpenError } from "../../../src/epub/errors.ts";
import { parseXml, type XmlElement } from "../../../src/epub/xml.ts";
import { buildFixture, syntheticFixtures } from "../../../src/test-fixtures/index.ts";

/**
 * 手寫的 XML 解析器：良構性的判定對 `fast-xml-parser` 比對，樹的行為自己斷言。
 *
 * `fast-xml-parser` 是**對照實作**（CONTEXT.md），只在測試裡出現。這裡能比的只有
 * **雙方都該同意的事實**——「這份文件良不良構」那個布林。錯誤訊息與樹的形狀兩邊
 * 本來就該不同，比不得。
 *
 * 比這一個布林是有意義的，因為它正是 `xml.ts` 最容易壞、又最不容易被發現的一
 * 格：解析器只要比驗證器**寬容**一點，一本壞書就會從「這本書壞了」退化成「欄位
 * 讀不到」——目錄長度對、href 對，只有字是空的。那種失敗不會讓任何測試變紅。
 */

function parse(source: string): XmlElement {
  return parseXml(source, { reason: "malformed-container", label: "test.xml" });
}

/** frond 認為這份文件良構嗎。 */
function frondAccepts(source: string): boolean {
  try {
    parse(source);
    return true;
  } catch (error) {
    if (error instanceof EpubOpenError) return false;
    throw error;
  }
}

/** 對照實作認為這份文件良構嗎。 */
function oracleAccepts(source: string): boolean {
  return XMLValidator.validate(source, { allowBooleanAttributes: false }) === true;
}

describe("良構性的判定與對照實作一致", () => {
  const AGREED: Record<string, string> = {
    "最小的文件": `<a/>`,
    "帶宣告": `<?xml version="1.0" encoding="utf-8"?><a/>`,
    "帶 BOM": `﻿<?xml version="1.0"?><a/>`,
    "巢狀": `<a><b><c/></b></a>`,
    "巢狀相同標籤": `<a><a/></a>`,
    "混合內容": `<a>前<span>言</span>後</a>`,
    "CDATA": `<a>前<![CDATA[<b>&未跳脫]]>後</a>`,
    "註解在根元素前後": `<!-- 前 --><a><!-- 中 --></a><!-- 後 -->`,
    "處理指令": `<?xml version="1.0"?><?xml-stylesheet href="x.css"?><a/>`,
    "DOCTYPE": `<!DOCTYPE html><a/>`,
    "DOCTYPE 含內部子集": `<!DOCTYPE ncx PUBLIC "-//X" "y.dtd" [ <!ENTITY f "b"> ]><a/>`,
    "屬性用單引號": `<a x='1'/>`,
    "屬性含跳脫": `<a x="&amp;&lt;&quot;"/>`,
    "屬性換行": `<a\n  x="1"\n  y="2"\n/>`,
    "命名空間前綴": `<package xmlns:dc="http://x" xml:lang="zh"><dc:title>書</dc:title></package>`,
    "認不得的具名實體": `<a>&nbsp;</a>`,
    "數值字元參照": `<a>&#8212;&#x2014;</a>`,
    "只有空白的元素": `<a>   </a>`,

    "沒有結束標籤": `<a><b></a>`,
    "結束標籤大小寫不符": `<A></a>`,
    "多出來的結束標籤": `<a/></a>`,
    "屬性沒有值": `<a x/>`,
    "屬性沒有引號": `<a x=1/>`,
    "屬性重複": `<a x="1" x="2"/>`,
    "裸的 &": `<a>a & b</a>`,
    "註解沒有結束": `<a><!-- x</a>`,
    "CDATA 沒有結束": `<a><![CDATA[x</a>`,
    "標籤名以數字開頭": `<1a/>`,
    "空文件": ``,
    "只有註解": `<!-- x -->`,
    "只有宣告": `<?xml version="1.0"?>`,
    "宣告不在最前面": `  <?xml version="1.0"?><a/>`,
    "沒有根元素只有文字": `文字`,
    "根元素之前有文字": `前面有字<a/>`,
  };

  test.each(Object.entries(AGREED))("%s", (_name, source) => {
    expect(frondAccepts(source)).toBe(oracleAccepts(source));
  });

  test.each(syntheticFixtures.map((fixture) => fixture.name))(
    "合成 fixture %s 裡的每一份 XML 兩邊都說良構",
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
 * 刻意比對照實作**嚴格**的兩格。
 *
 * 兩個都不是良構的 XML，而 `XMLValidator` 讓它們過關。嚴格的方向是安全的（壞書
 * 出聲，而不是靜默地讀出半棵樹），代價是可能擋掉一本實際流通的書——所以要有依
 * 據：樣本裡 1767 份 XML 文件**沒有一份**踩到這兩格。
 *
 * 這裡連「對照實作接受它」也一起斷言。哪天它收緊了，這條會紅——那時候該做的是
 * 把這一格搬回上面那張表，而不是讓兩邊悄悄地又一致了卻沒人知道。
 */
describe("frond 比對照實作嚴格的地方", () => {
  const STRICTER: Record<string, string> = {
    "兩個根元素": `<a/><b/>`,
    "根元素之後有文字": `<a/>後面還有字`,
  };

  test.each(Object.entries(STRICTER))("%s", (_name, source) => {
    expect(frondAccepts(source)).toBe(false);
    expect(oracleAccepts(source)).toBe(true);
  });
});

describe("讀得到子元素、屬性與文字", () => {
  test("取第一個與取全部", () => {
    const root = parse(`<manifest><item id="a"/><item id="b"/><other/></manifest>`);
    const manifest = root.child("manifest")!;

    expect(manifest.child("item")?.attribute("id")).toBe("a");
    expect(manifest.children("item").map((item) => item.attribute("id"))).toEqual(["a", "b"]);
    expect(manifest.children("missing")).toEqual([]);
    expect(manifest.child("missing")).toBeUndefined();
  });

  test("沒有的屬性是 undefined，空字串的屬性是空字串", () => {
    const a = parse(`<a x=""/>`).child("a")!;
    expect(a.attribute("x")).toBe("");
    expect(a.attribute("y")).toBeUndefined();
  });

  test("自閉合的元素沒有子元素也沒有文字", () => {
    const a = parse(`<a><b/></a>`).child("a")!;
    expect(a.child("b")?.text()).toBe("");
    expect(a.child("b")?.children("c")).toEqual([]);
  });
});

describe("命名空間前綴", () => {
  const SOURCE = `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
    <metadata><dc:title>書名</dc:title><meta property="dcterms:modified">2024-01-01</meta></metadata>
  </package>`;

  test("元素與屬性的前綴都剝掉", () => {
    const metadata = parse(SOURCE).child("package")!.child("metadata")!;
    expect(metadata.child("title")?.text()).toBe("書名");
  });

  test("換一個前綴讀出來的東西一樣", () => {
    // 前綴是文件自己選的字串。照字面比對 `dc:` 的實作會在這本書上讀不到書名，
    // 而這本書完全合規。
    const renamed = SOURCE.replaceAll("dc:", "d:").replace("xmlns:d=", "xmlns:d=");
    expect(parse(renamed).child("package")!.child("metadata")!.child("title")?.text()).toBe(
      "書名",
    );
  });

  test("xmlns 自己不是屬性", () => {
    // 它宣告的是綁定，不是這份文件在講的事。留著的話 `attribute("xmlns")` 會回答
    // 一個命名空間 URI，而沒有任何一處讀 XML 的地方想要那個。
    const packageElement = parse(SOURCE).child("package")!;
    expect(packageElement.attribute("xmlns")).toBeUndefined();
    expect(packageElement.attribute("dc")).toBeUndefined();
    expect(packageElement.attribute("version")).toBe("3.0");
  });

  test("xml:lang 與 lang 同時在而且值相同不算撞名", () => {
    // XHTML 的標準寫法，樣本裡每一份導覽文件都這樣寫。
    const html = parse(`<html xml:lang="zh-TW" lang="zh-TW"><body/></html>`).child("html")!;
    expect(html.attribute("lang")).toBe("zh-TW");
  });

  test("剝掉前綴之後撞名而且值不同就出聲", () => {
    expect(frondAccepts(`<html xml:lang="zh-TW" lang="en"/>`)).toBe(false);
  });
});

describe("文字", () => {
  test("整棵子樹的文字依文件順序接起來", () => {
    // 量到的形狀：一本書 39 個目錄項目的文字全部包在 `<span>` 裡，另一本的第二層
    // 是 `<span><small>輯一</small>・儲藏室</span>`。只讀自己那層會讀出空字串，
    // 丟掉順序會讀成「・儲藏室輯一」。
    expect(parse(`<a>前<span>言</span>後</a>`).child("a")!.text()).toBe("前言後");
    expect(parse(`<a><span>序</span></a>`).child("a")!.text()).toBe("序");
    expect(
      parse(`<a><span><small>輯一</small>・儲藏室</span></a>`).child("a")!.text(),
    ).toBe("輯一・儲藏室");
  });

  test("前後空白去掉，中間的留著", () => {
    expect(parse(`<title>\n  書名\n</title>`).child("title")!.text()).toBe("書名");
    // 中間的空白留著才不會把 `Chapter One Revised` 讀成 `ChapterOneRevised`。
    expect(parse(`<a>Chapter <em>One</em> Revised</a>`).child("a")!.text()).toBe(
      "Chapter One Revised",
    );
  });

  test("CDATA 是文字，裡面的標記不當標記", () => {
    expect(parse(`<a>前<![CDATA[<b>&未跳脫]]>後</a>`).child("a")!.text()).toBe(
      "前<b>&未跳脫後",
    );
  });

  test("註解不是文字", () => {
    expect(parse(`<a>前<!-- 註解 -->後</a>`).child("a")!.text()).toBe("前後");
  });
});

describe("實體與字元參照", () => {
  test("五個預定義實體", () => {
    expect(parse(`<a>&amp;&lt;&gt;&quot;&apos;</a>`).child("a")!.text()).toBe(`&<>"'`);
    expect(parse(`<a x="&amp;&lt;"/>`).child("a")!.attribute("x")).toBe("&<");
  });

  test("數值字元參照", () => {
    // 這一格與對照實作**不同**：`fast-xml-parser` 把 `&#8212;` 原樣留著，於是一本
    // 用數值參照寫破折號的書，書名裡會出現那串字面。照 XML 規格解才是對的。
    expect(parse(`<a>&#8212;&#x2014;&#65;</a>`).child("a")!.text()).toBe("——A");
  });

  test("認不得的具名實體原樣留著", () => {
    // 它可能由 DOCTYPE 的內部子集宣告過，而 frond 不展開那些宣告。丟錯會讓一本
    // 合規的書開不起來，留著最多是標題裡多一串字。
    expect(parse(`<a>&nbsp;</a>`).child("a")!.text()).toBe("&nbsp;");
  });

  test("壞掉的數值參照原樣留著，不當成數字", () => {
    expect(parse(`<a>&#zz;</a>`).child("a")!.text()).toBe("&#zz;");
  });
});

describe("錯誤訊息說得出哪一行", () => {
  test("行號指向出問題的那一行", () => {
    let message = "";
    try {
      parse(`<a>\n  <b>\n</a>`);
    } catch (error) {
      message = (error as EpubOpenError).message;
    }
    expect(message).toContain("test.xml 不是良構的 XML");
    expect(message).toContain("第 3 行");
  });

  test("丟的是呼叫端指定的那一種開書錯誤", () => {
    try {
      parseXml(`<a>`, { reason: "malformed-navigation-document", label: "nav.xhtml" });
      expect.unreachable();
    } catch (error) {
      expect((error as EpubOpenError).reason).toBe("malformed-navigation-document");
      expect((error as EpubOpenError).message).toContain("nav.xhtml");
    }
  });
});
