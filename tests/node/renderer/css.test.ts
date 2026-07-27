import { describe, expect, test } from "vitest";
import {
  demoteImportant,
  inlineImports,
  mapStylesheet,
  normalisePageBreaks,
  normalisePrefixedWritingMode,
  relativiseFontSizes,
  rewriteUrls,
} from "../../../src/renderer/css.ts";

/**
 * 對書的樣式表做的每一次改寫。
 *
 * 這一組測試裡有一半在問「**沒有**改到什麼」——不動的部分逐字元不變，是這一層
 * 最重要的性質。改寫是對書的介入（ADR-0003），介入多了一格而沒有人發現，正是
 * 那份封閉清單存在的理由；而「多改了一處」在畫面上多半看不出來，只有逐字元比對
 * 抓得到。
 */

describe("宣告的定位", () => {
  test("選擇器裡的冒號不是宣告", () => {
    // 正規表示式最典型的錯法：`a:hover` 的冒號被當成屬性與值的分隔。
    const css = "a:hover { color: red }";
    const seen: string[] = [];

    mapStylesheet(css, (declaration) => {
      seen.push(declaration.property);
      return undefined;
    });

    expect(seen).toEqual(["color"]);
  });

  test("@media 裡面裝的是規則，不是宣告", () => {
    const seen: string[] = [];

    mapStylesheet("@media (min-width: 40em) { p { color: red } }", (declaration) => {
      seen.push(declaration.property);
      return undefined;
    });

    // `min-width: 40em` 在 at-rule 的前綴裡，不是一條宣告。
    expect(seen).toEqual(["color"]);
  });

  test("字串與 url() 裡的分號不切開宣告", () => {
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

  test("註解裡的東西不算數", () => {
    const seen: string[] = [];

    mapStylesheet("p { /* color: red; */ margin: 0 }", (declaration) => {
      seen.push(declaration.property);
      return undefined;
    });

    expect(seen).toEqual(["margin"]);
  });

  test("不動的時候逐字元不變，連空白與註解都留著", () => {
    const css = `@charset "utf-8";

/* 書自己的註解 */
p   {
  margin : 0 0 1em ;
  text-indent:1em
}
`;

    expect(mapStylesheet(css, () => undefined)).toBe(css);
  });

  test("!important 從值裡切開，屬性名轉小寫", () => {
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

describe("前綴的 writing-mode", () => {
  test("補一條無前綴的等價宣告", () => {
    // 《入境大廳》的形狀：兩個前綴都寫了，無前綴的一次都沒有。
    const css = `body {
  -epub-writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
}`;

    const rewritten = normalisePrefixedWritingMode(css);

    expect(rewritten).toContain("-epub-writing-mode: vertical-rl");
    expect(rewritten).toContain("-webkit-writing-mode: vertical-rl");
    expect(rewritten.match(/[^-]writing-mode: vertical-rl/g)?.length).toBe(2);
  });

  test("原本那條留著，不是換掉", () => {
    const rewritten = normalisePrefixedWritingMode(
      "body { -epub-writing-mode: vertical-rl }",
    );

    expect(rewritten).toContain("-epub-writing-mode");
  });

  test("!important 跟著補上去", () => {
    const rewritten = normalisePrefixedWritingMode(
      "body { -webkit-writing-mode: vertical-rl !important }",
    );

    expect(rewritten).toContain("writing-mode: vertical-rl !important");
  });

  test("已經有無前綴宣告的書不會被動到", () => {
    const css = "html { writing-mode: vertical-rl }";
    expect(normalisePrefixedWritingMode(css)).toBe(css);
  });

  test("舊語法 tb-rl 不需要處理——三家都認", () => {
    // docs/browser-quirks.md 量到的：三家都認、computed 值正規化成 vertical-rl。
    const css = "html { writing-mode: tb-rl }";
    expect(normalisePrefixedWritingMode(css)).toBe(css);
  });
});

describe("page-break-*", () => {
  test("always 換成換一欄", () => {
    const rewritten = normalisePageBreaks("h1 { page-break-before: always }");

    expect(rewritten).toContain("page-break-before: always");
    expect(rewritten).toContain("break-before: column");
  });

  test("avoid 兩邊同名", () => {
    expect(normalisePageBreaks("figure { page-break-inside: avoid }")).toContain(
      "break-inside: avoid",
    );
  });

  test("left 與 right 退成換一欄——分欄版面沒有對開頁", () => {
    expect(normalisePageBreaks("h1 { page-break-before: left }")).toContain(
      "break-before: column",
    );
  });

  test("認不得的值不動", () => {
    const css = "h1 { page-break-before: recto }";
    expect(normalisePageBreaks(css)).toBe(css);
  });

  test("書已經用現代寫法時不重複補", () => {
    const css = "h1 { break-before: column }";
    expect(normalisePageBreaks(css)).toBe(css);
  });
});

describe("拿掉 !important", () => {
  const OVERRIDDEN = new Set(["font-size"]);

  test("讀者覆寫過的屬性，旗標拿掉、值不動", () => {
    const rewritten = demoteImportant("p { font-size: 12px !important }", OVERRIDDEN);

    expect(rewritten).toContain("font-size: 12px");
    expect(rewritten).not.toContain("!important");
  });

  test("讀者沒有覆寫的屬性，旗標留著", () => {
    // ADR-0003 的門檻：沒有讀者設定就沒有東西被擋住，也就沒有介入的理由。
    const css = "p { color: #000 !important }";
    expect(demoteImportant(css, OVERRIDDEN)).toBe(css);
  });

  test("同一個屬性沒帶 !important 的那幾條不動", () => {
    const css = "p { font-size: 12px }";
    expect(demoteImportant(css, OVERRIDDEN)).toBe(css);
  });

  test("style 屬性裡的 !important 也拿得掉", () => {
    // 這才是關鍵的一格：層疊規則裡沒有任何位置贏得了 inline 的 !important。
    expect(
      demoteImportant("font-size: 12px !important; color: red", OVERRIDDEN, "declarations"),
    ).toBe("font-size: 12px; color: red");
  });
});

describe("絕對字級換算成 rem", () => {
  test("px 依 16px 的基準換算", () => {
    expect(relativiseFontSizes("p { font-size: 12px }")).toContain("font-size: 0.75rem");
    expect(relativiseFontSizes("h1 { font-size: 32px }")).toContain("font-size: 2rem");
  });

  test("pt 先換成 px 再換算", () => {
    // 12pt = 16px = 1rem。
    expect(relativiseFontSizes("p { font-size: 12pt }")).toContain("font-size: 1rem");
  });

  test("書自己的字級層次原封不動", () => {
    const rewritten = relativiseFontSizes(`h1 { font-size: 32px }
p { font-size: 16px }`);

    // 2 : 1，與換算前逐項相同——讀者調字級時整份文件按同一個比例縮放。
    expect(rewritten).toContain("font-size: 2rem");
    expect(rewritten).toContain("font-size: 1rem");
  });

  test("巢狀的絕對字級不連乘", () => {
    // 這是選 rem 而不是 em 的全部理由。em 會讓 span 變成 0.75 × 0.625。
    const rewritten = relativiseFontSizes(`p { font-size: 12px }
p span { font-size: 10px }`);

    expect(rewritten).toContain("font-size: 0.75rem");
    expect(rewritten).toContain("font-size: 0.625rem");
  });

  test("已經是相對單位的不動", () => {
    for (const value of ["1.2em", "0.9rem", "120%", "larger", "medium"]) {
      const css = `p { font-size: ${value} }`;
      expect(relativiseFontSizes(css)).toBe(css);
    }
  });

  test("複合值不動——算錯比不算更糟", () => {
    const css = "p { font-size: calc(12px + 1vw) }";
    expect(relativiseFontSizes(css)).toBe(css);
  });

  test("!important 跟著留在換算後的宣告上", () => {
    // 換算與拿掉旗標是兩個獨立的改寫，各自只做一件事。
    expect(relativiseFontSizes("p { font-size: 12px !important }")).toContain(
      "font-size: 0.75rem !important",
    );
  });

  test("style 屬性裡的絕對字級也換算", () => {
    expect(relativiseFontSizes("font-size: 24px; color: red", "declarations")).toBe(
      "font-size: 1.5rem; color: red",
    );
  });
});

describe("url() 的改寫", () => {
  const resolve = (reference: string): string | undefined =>
    reference === "images/plate.png" ? "blob:https://example/abc" : undefined;

  test("相對路徑換成解析後的位址", () => {
    expect(rewriteUrls("p { background: url(images/plate.png) }", resolve)).toContain(
      'url("blob:https://example/abc")',
    );
  });

  test("帶引號的寫法一樣認得", () => {
    expect(rewriteUrls(`p { background: url("images/plate.png") }`, resolve)).toContain(
      'url("blob:https://example/abc")',
    );
    expect(rewriteUrls(`p { background: url('images/plate.png') }`, resolve)).toContain(
      'url("blob:https://example/abc")',
    );
  });

  test("解析不出來的原樣留著", () => {
    const css = "p { background: url(data:image/gif;base64,AAAA) }";
    expect(rewriteUrls(css, resolve)).toBe(css);
  });

  test("@import 的 url() 也換得到——它不在任何一條宣告裡", () => {
    expect(rewriteUrls("@import url(images/plate.png);", resolve)).toContain(
      'url("blob:https://example/abc")',
    );
  });

  test("註解裡的 url() 不動", () => {
    const css = "/* url(images/plate.png) */ p { margin: 0 }";
    expect(rewriteUrls(css, resolve)).toBe(css);
  });

  test("@font-face 的字型也走同一條路", () => {
    const rewritten = rewriteUrls(
      `@font-face { font-family: "書"; src: url(images/plate.png) format("opentype") }`,
      resolve,
    );

    expect(rewritten).toContain('url("blob:https://example/abc") format("opentype")');
  });
});

/**
 * `@import` 的就地展開。
 *
 * 這一支的存在理由是實書量到的：樣本裡四本書的內容文件只 `<link>` 一支聚合檔，
 * 而那支檔案除了 `@charset` 之外只有 `@import` 字串——不展開就等於整份樣式表
 * 消失，四本直排書全部排成橫排（`src/renderer/css.ts` 的 `inlineImports`）。
 *
 * 兩種寫法各測一次不是為了覆蓋率：`writing-mode-behind-import` 那份 fixture 只
 * 演字串寫法（那是量到的那一種），`url()` 寫法是同一支展開器的另一個分支，而
 * 純字串函式測得起來的東西不該為它多產一本書（ADR-0007）。
 */
describe("@import 的展開", () => {
  /** 展開器只回傳「這個位址對應的 CSS」，路徑怎麼解是 document-source 的事。 */
  const expand = (reference: string): string | undefined =>
    reference === "book-style.css" ? "html { writing-mode: vertical-rl }" : undefined;

  test("字串寫法展得開——樣本裡量到的就是這一種", () => {
    expect(inlineImports(`@import "book-style.css";`, expand)).toBe(
      "html { writing-mode: vertical-rl }",
    );
  });

  test("單引號與 url() 兩種寫法一樣認得", () => {
    for (const rule of [
      `@import 'book-style.css';`,
      "@import url(book-style.css);",
      `@import url("book-style.css");`,
    ]) {
      expect(inlineImports(rule, expand)).toBe("html { writing-mode: vertical-rl }");
    }
  });

  test("展開的位置就是 @import 原本的位置——層疊看順序", () => {
    expect(
      inlineImports(`p { color: red }\n@import "book-style.css";\np { color: blue }`, expand),
    ).toBe("p { color: red }\nhtml { writing-mode: vertical-rl }\np { color: blue }");
  });

  test("展不開的原樣留著，不刪掉", () => {
    // 刪掉會讓查問題的人看不出書本來要求了什麼，而一個解析不到的 @import 與
    // 沒有它對畫面是同一件事。
    const css = `@import "missing.css";\np { margin: 0 }`;
    expect(inlineImports(css, expand)).toBe(css);
  });

  test("帶媒體查詢的包一層 @media，那個條件不能弄丟", () => {
    expect(inlineImports(`@import "book-style.css" print;`, expand)).toBe(
      "@media print {\nhtml { writing-mode: vertical-rl }\n}",
    );
    expect(
      inlineImports(`@import "book-style.css" screen and (min-width: 30em);`, expand),
    ).toBe(
      "@media screen and (min-width: 30em) {\nhtml { writing-mode: vertical-rl }\n}",
    );
  });

  test("layer() 與 supports() 的寫法原樣留著", () => {
    // 兩者改變的是層疊的分層與條件，而把文字插進來重現不了那件事。
    for (const rule of [
      `@import "book-style.css" layer(book);`,
      `@import "book-style.css" supports(display: grid);`,
    ]) {
      expect(inlineImports(rule, expand)).toBe(rule);
    }
  });

  test("註解與字串裡的 @import 不是 at-rule", () => {
    for (const css of [
      `/* @import "book-style.css"; */ p { margin: 0 }`,
      `p { content: "@import \\"book-style.css\\";" }`,
    ]) {
      expect(inlineImports(css, expand)).toBe(css);
    }
  });

  test("區塊裡面的 @import 不合規，原樣留著", () => {
    const css = `@media print { @import "book-style.css"; }`;
    expect(inlineImports(css, expand)).toBe(css);
  });

  test("一個 @import 都沒有的樣式表逐字元不變", () => {
    const css = `@charset "UTF-8";\n/* 書自己的 */\nhtml { font-family: "書" }\n`;
    expect(inlineImports(css, expand)).toBe(css);
  });

  test("同一份樣式表裡多個 @import 全部展開", () => {
    const two = (reference: string): string | undefined =>
      reference === "a.css" ? "p { margin: 0 }" : reference === "b.css" ? "p { padding: 0 }" : undefined;

    expect(inlineImports(`@import "a.css";\n@import "b.css";`, two)).toBe(
      "p { margin: 0 }\np { padding: 0 }",
    );
  });
});

describe("@import 的邊界", () => {
  const expand = (): string | undefined => "p { margin: 0 }";

  test("名字只是開頭像 @import 的 at-rule 不動", () => {
    // 少了 lookahead 的話 `@imports` 也會命中，而那條規則會被整段吃掉。
    const css = "@imports-are-fun x;\np { color: red }";
    expect(inlineImports(css, expand)).toBe(css);
  });

  test("大小寫不拘", () => {
    expect(inlineImports(`@IMPORT "a.css";`, expand)).toBe("p { margin: 0 }");
  });

  test("認不出位址的 @import 原樣留著", () => {
    const css = "@import ;";
    expect(inlineImports(css, expand)).toBe(css);
  });
});
