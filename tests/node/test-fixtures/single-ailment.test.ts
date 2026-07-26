import { describe, expect, test } from "vitest";
import { openEpub, type EpubArchive } from "../support/epub-archive.ts";
import { buildFixture, syntheticFixtures } from "../../../src/test-fixtures/index.ts";

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
    symptom: "直排宣告在 body",
    expectedIn: ["writing-mode-on-body"],
    matches: (book) => /body\s*\{[^}]*writing-mode/.test(book.stylesheet),
  },
  {
    symptom: "直排宣告在 html",
    expectedIn: ["vertical-japanese", "ppd-rtl-vertical"],
    matches: (book) => /html\s*\{[^}]*writing-mode/.test(book.stylesheet),
  },
  {
    symptom: "TOC 的 href 帶 percent-encoding",
    expectedIn: ["toc-href-percent-comma"],
    matches: (book) => book.toc.some((entry) => /%[0-9a-fA-F]{2}/.test(entry.href)),
  },
  {
    symptom: "TOC 的 href 帶 ../ 前綴",
    expectedIn: ["toc-href-parent-prefix"],
    matches: (book) => book.toc.some((entry) => entry.href.startsWith("../")),
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
    symptom: "帶了內文用的資源",
    expectedIn: ["empty-and-image-only-sections"],
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
    expectedIn: ["cover-image-property", "cover-meta-name-epub2"],
    matches: (book) => book.cover !== undefined,
  },
  {
    symptom: "封面走 EPUB 3 的 properties=\"cover-image\"",
    expectedIn: ["cover-image-property"],
    matches: (book) => book.cover?.foundBy === "cover-image-property",
  },
  {
    symptom: "封面走 <meta name=\"cover\">",
    expectedIn: ["cover-meta-name-epub2"],
    // ADR-0010 要求 EPUB 3 也認舊寫法，而#24 會補上「EPUB 3 只用舊寫法」那一份
    // ——屆時這裡要多一個檔名，而不是把這條探針改寬。
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
 * 的會是「瀏覽器挑了哪套字型」而不是「這本書排成什麼樣」。真書大多用 generic
 * 宣告，那是 #4 的範圍，不該污染合成 fixture 的可控性。
 *
 * 連 fallback 都不寫：`"Noto Serif CJK JP", serif` 在字型缺席時會靜默落回
 * generic，而那正是要避免的那種「不知道量到什麼」。
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
      const declarations = [...books.get(name)!.stylesheet.matchAll(/font-family:([^;}]*)/g)];

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
