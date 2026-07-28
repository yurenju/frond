import { describe, expect, test } from "vitest";
import { openEpub, type EpubArchive } from "../support/epub-archive.ts";
import { buildFixture, syntheticFixtures } from "../../../packages/frond/src/test-fixtures/index.ts";

/**
 * 「一個 fixture 只帶一個病症，其餘部分保持健康」——這條紀律的執行者。
 *
 * `ailments.test.ts` 問「病在不在」，這裡問「病有沒有溢出到別的檔案」。缺了這
 * 一組，一份把所有病症寫進同一張樣式表的產生器會在那邊全綠，而 fixture 的全部
 * 價值——測試紅燈直接指向唯一一個病因——就沒了。
 *
 * 做法是把每個病症寫成一個探針，然後斷言**命中的檔案集合恰好等於**那份清單。
 * 「恰好等於」是重點：只斷言「有命中」的話，病症擴散到第二個檔案時沒有人會
 * 知道。
 */

/**
 * ADR-0007 那張 fixture 表的程式碼版本。
 *
 * 底下那條斷言比的是**集合相等**，不是「包含」。單向的「包含」只擋得住一個
 * 方向：表上有而程式碼沒有。反方向——程式碼加了一份 fixture 而 ADR 的表沒有跟上
 * ——會靜默通過，而那正是文件腐爛的實際走法。
 *
 * 順序不比：這份清單依病症分組排，`AILMENTS` 依加入的時間排，兩者都沒有語意。
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
  // 版本那一軸（ADR-0010 → #22）。EPUB 2 的健康骨架與兩種封面宣告寫法。
  "healthy-epub2",
  "cover-image-property",
  "cover-meta-name-epub2",
  // TOC 那一軸（#23）。病症的 NCX 版、兩種載體的巢狀 TOC，以及 manifest 側的
  // `../`——最後這一份演的是好書，不是病症。
  "toc-href-percent-comma-epub2",
  "toc-href-parent-prefix-epub2",
  "nested-toc",
  "nested-toc-epub2",
  "manifest-href-parent-prefix",
  // 書實際的形狀裡兩個沒有東西會亮紅燈的缺口（#24）。
  "writing-mode-prefixed-only",
  "cover-meta-name",
  // 唯一一份沒有樣本支撐、照規格合成的（#30）。理由見 ADR-0007：混淆解錯不會
  // 丟錯，症狀只在讀者的畫面上。
  "obfuscated-font-idpf",
  // 拿 34 本書實際跑一趟渲染才量到的四個病症。四者都不會報錯，只會讓讀者少看到
  // 東西——整本排錯方向、一章只翻得到第一頁、圖版與表格的下半永遠看不到。最後
  // 一份是三家分歧且 frond 修不掉的那一格，存在的理由是釘住現況。
  "writing-mode-behind-import",
  "hidden-trailing-notes",
  "plate-taller-than-page",
  "table-taller-than-page",
];

const books = new Map<string, EpubArchive>(
  syntheticFixtures.map((fixture) => [
    fixture.name,
    openEpub(buildFixture(fixture.name)),
  ]),
);

interface Probe {
  readonly symptom: string;
  /** 允許出現這個症狀的檔案，恰好這些。 */
  readonly expectedIn: readonly string[];
  readonly matches: (book: EpubArchive) => boolean;
}

const PROBES: readonly Probe[] = [
  {
    symptom: "font-size 被 !important 鎖住",
    expectedIn: ["font-size-important"],
    matches: (book) => book.stylesheet.includes("!important"),
  },
  {
    symptom: "固定寬度",
    expectedIn: ["fixed-width-800"],
    matches: (book) => /\bwidth:\s*\d+px/.test(book.stylesheet),
  },
  {
    symptom: "寫死顏色",
    expectedIn: ["hardcoded-colors"],
    matches: (book) => /(^|[\s;{])(background-)?color:/m.test(book.stylesheet),
  },
  {
    symptom: "直排宣告在 body，屬性名無前綴",
    expectedIn: ["writing-mode-on-body"],
    // `[^-\w]` 是這條探針的全部重點：少了它，`-epub-writing-mode` 裡的
    // `writing-mode` 也會命中，於是位置那個病症與語法那個病症在探針上分不開
    // ——而那兩份 fixture 存在的理由正是它們是**不同**的病（#24）。
    matches: (book) => /body\s*\{[^}]*[^-\w]writing-mode:/.test(book.stylesheet),
  },
  {
    symptom: "直排只用帶前綴的屬性名宣告",
    expectedIn: ["writing-mode-prefixed-only"],
    matches: (book) =>
      /-(?:epub|webkit)-writing-mode:/.test(book.stylesheet),
  },
  {
    symptom: "直排宣告在 html",
    expectedIn: ["vertical-japanese", "ppd-rtl-vertical"],
    matches: (book) => /html\s*\{[^}]*writing-mode/.test(book.stylesheet),
  },
  {
    symptom: "TOC 的 href 帶 percent-encoding",
    expectedIn: ["toc-href-percent-comma", "toc-href-percent-comma-epub2"],
    matches: (book) => book.toc.some((entry) => /%[0-9a-fA-F]{2}/.test(entry.href)),
  },
  {
    symptom: "TOC 的 href 帶 ../ 前綴",
    expectedIn: ["toc-href-parent-prefix", "toc-href-parent-prefix-epub2"],
    matches: (book) => book.toc.some((entry) => entry.href.startsWith("../")),
  },
  {
    symptom: "manifest 的 href 帶 ../ 前綴",
    // TOC 側那兩份是病症，這一份是**好書**：`../` 走到封裝根而目標確實存在，
    // 合規且解得開。分成兩條探針是因為兩者在 fixture 上不能互相頂替——把
    // manifest 側的誤報擋住，靠的不是 TOC 側有沒有 `../`。
    expectedIn: ["manifest-href-parent-prefix"],
    matches: (book) => book.manifest.some((item) => item.href.startsWith("../")),
  },
  {
    symptom: "TOC 有第二層",
    expectedIn: ["nested-toc", "nested-toc-epub2"],
    matches: (book) => book.tocTree.some((node) => node.children.length > 0),
  },
  {
    symptom: "宣告了 page-progression-direction",
    expectedIn: ["ppd-rtl-vertical"],
    matches: (book) => book.pageProgressionDirection !== undefined,
  },
  {
    symptom: "readingOrder 只有一個 Section",
    expectedIn: ["huge-single-section"],
    matches: (book) => book.readingOrder.length === 1,
  },
  {
    symptom: "有空的或沒有文字的 Section",
    expectedIn: ["empty-and-image-only-sections"],
    matches: (book) =>
      book.readingOrder.some((section) => !/<p[\s>]/.test(book.text(section.archivePath))),
  },
  {
    symptom: "宣告了混淆過的資源",
    expectedIn: ["obfuscated-font-idpf"],
    matches: (book) => book.entryPaths.includes("META-INF/encryption.xml"),
  },
  {
    symptom: "帶了骨架以外的資源",
    // `manifest-href-parent-prefix` 也在這裡：它的單點差異需要一份真的存在於
    // 封裝根的檔案來承載——「目標確實存在」正是那份 fixture 的重點，拿掉檔案
    // 它就變成一本壞書了。混淆字型那一份同理：病症長在一份資源上，那份資源
    // 必須真的在包裡。
    expectedIn: [
      "empty-and-image-only-sections",
      "manifest-href-parent-prefix",
      "obfuscated-font-idpf",
      "plate-taller-than-page",
    ],
    // 「不是 XHTML 也不是 CSS」不夠精確：NCX 與封面圖也落在那一格，於是這個探針
    // 會被 EPUB 2 與封面的 fixture 一起命中，而它們帶的不是內文資源。要問的是
    // 「除了骨架自己的東西之外，還有沒有多帶內容」。
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
    symptom: "宣告了封面",
    expectedIn: [
      "cover-image-property",
      "cover-meta-name",
      "cover-meta-name-epub2",
    ],
    matches: (book) => book.cover !== undefined,
  },
  {
    symptom: "封面走 EPUB 3 的 properties=\"cover-image\"",
    expectedIn: ["cover-image-property"],
    matches: (book) => book.cover?.foundBy === "cover-image-property",
  },
  {
    symptom: "封面走 <meta name=\"cover\">",
    // 兩個版本都在這裡，而這正是重點：ADR-0010 要求兩條路都走得通且**不按版本
    // 分派**，所以舊寫法必須同時出現在 EPUB 2 與 EPUB 3 的 fixture 上（#24）。
    expectedIn: ["cover-meta-name", "cover-meta-name-epub2"],
    matches: (book) => book.cover?.foundBy === "meta-name",
  },
];

describe("一個 fixture 只帶一個病症", () => {
  test("ADR-0007 的 fixture 表與產生器的清單完全一致", () => {
    const names = syntheticFixtures.map((fixture) => fixture.name);

    expect(
      [...names].sort(),
      "ADR-0007 的 fixture 表與 REQUIRED_BY_ADR_0007 要跟著一起改。",
    ).toEqual([...REQUIRED_BY_ADR_0007].sort());
  });

  test("檔名就是病症名加 .epub", () => {
    for (const fixture of syntheticFixtures) {
      expect(fixture.fileName).toBe(`${fixture.name}.epub`);
    }
  });

  test.for(PROBES)("$symptom 只出現在指定的檔案裡", (probe: Probe) => {
    const matched = [...books]
      .filter(([, book]) => probe.matches(book))
      .map(([name]) => name);

    expect([...matched].sort()).toEqual([...probe.expectedIn].sort());
  });
});

/**
 * generic family（`serif` / `sans-serif` / …）在合成 fixture 裡是禁區。
 *
 * 三家瀏覽器對 generic family 的 CJK 解析並不一致（#4）——用 generic 的話量到
 * 的會是「瀏覽器挑了哪套字型」而不是「這本書排成什麼樣」。實際的書大多用 generic
 * 宣告，那是 #4 的範圍，不該污染合成 fixture 的可控性。
 *
 * 連 fallback 都不寫：`"Noto Serif CJK JP", serif` 在字型缺席時會靜默落回
 * generic，而那正是要避免的那種「不知道量到什麼」。
 *
 * **看的是這本書裡每一份 CSS，不只 `<link>` 到的那一份。** 只看第一份的話，
 * 宣告搬進被 `@import` 的檔案（`writing-mode-behind-import` 就是這個形狀）之後
 * 這條檢查會靜默地什麼都沒查——而那份檔案裡照樣可以寫 generic family。
 */
describe("指名字面，不用 generic family", () => {
  const GENERIC_FAMILIES = [
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
  ];

  test.for(syntheticFixtures.map((fixture) => fixture.name))(
    "%s 的 font-family 只指名字面",
    (name: string) => {
      const book = books.get(name)!;
      const everyStylesheet = book.manifest
        .filter((item) => item.mediaType === "text/css")
        .map((item) => book.text(item.archivePath))
        .join("\n");
      const declarations = [...everyStylesheet.matchAll(/font-family:([^;}]*)/g)];

      expect(declarations.length).toBeGreaterThan(0);
      for (const [, value] of declarations) {
        // 先把引號括起來的字面拿掉，否則 "Noto Serif CJK JP" 裡的 Serif 會被
        // 誤判成 generic family。
        const withoutNamedFaces = value!.replaceAll(/"[^"]*"|'[^']*'/g, "");
        for (const generic of GENERIC_FAMILIES) {
          expect(withoutNamedFaces).not.toContain(generic);
        }
      }
    },
  );
});
