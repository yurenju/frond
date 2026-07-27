import { describe, expect, test } from "vitest";
import {
  demoteImportant,
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
