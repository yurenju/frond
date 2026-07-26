import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import { handmadeBook, packageDocument, sectionDocument } from "./support/handmade.ts";

/**
 * readingOrder——一本書的閱讀順序，封裝格式裡的 `<spine>`（CONTEXT.md）。
 *
 * 這一組守兩件事：**順序**與**每個 Section 指到壓縮檔內的哪一份檔案**。順序錯了
 * 讀者會跳章，路徑錯了那一格開不出內容——後者在合成 fixture 上很容易假綠，因為
 * fixture 的 href 與壓縮檔的路徑長得幾乎一樣（都在 `EPUB/` 底下）。所以這裡也
 * 餵路徑帶逗號的那一份，讓「原樣照抄 href」與「解析後查表」分得開來。
 */

describe("順序", () => {
  test("EPUB 3 的三個 Section 照封裝文件的順序排", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "EPUB/section-1.xhtml",
      "EPUB/section-2.xhtml",
      "EPUB/section-3.xhtml",
    ]);
  });

  test("EPUB 2 的 readingOrder 讀法與 EPUB 3 相同", async () => {
    // 版本的差異在 metadata 與導覽載體上，readingOrder 兩版是同一個形狀。
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "EPUB/section-1.xhtml",
      "EPUB/section-2.xhtml",
      "EPUB/section-3.xhtml",
    ]);
  });

  test("每個 Section 帶著 manifest 的 id 與 media type", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.readingOrder[0]).toMatchObject({
      id: "section-1",
      path: "EPUB/section-1.xhtml",
      mediaType: "application/xhtml+xml",
    });
  });

  test("導覽文件與樣式表不在 readingOrder 裡", async () => {
    // manifest 列的是「這本書由哪些檔案組成」，readingOrder 只收 <itemref> 指到
    // 的那些。把 manifest 整份當成閱讀順序是最典型的錯法。
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.readingOrder.map((section) => section.mediaType)).toEqual([
      "application/xhtml+xml",
      "application/xhtml+xml",
      "application/xhtml+xml",
    ]);
  });
});

describe("Section 指到壓縮檔內的哪一份檔案", () => {
  test("href 帶逗號時解析到字面的那個項目", async () => {
    // toc-href-percent-comma 的第二個 Section 檔名帶逗號，manifest 用字面的
    // 逗號寫。逗號在 URL 的 path 裡是合法字元，所以解析後仍是逗號——把 href
    // 整份丟進 encodeURIComponent 的實作會在這裡找不到檔案。
    const book = await EpubBook.open(await readFixture("toc-href-percent-comma.epub"));

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "EPUB/section-1.xhtml",
      "EPUB/section-2,continued.xhtml",
      "EPUB/section-3.xhtml",
    ]);
  });
});

describe("linear=\"no\"", () => {
  test("留在 readingOrder 裡，但標記成不在線性進程上", async () => {
    // 封面頁與版權頁常寫成 linear="no"：它們在書裡，但不該出現在翻頁的進程中。
    // frond 給事實（ADR-0002）——把它們默默濾掉，消費端就再也拿不到那一格。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
          readingOrder: `    <itemref idref="cover-page" linear="no"/>
    <itemref idref="section-1"/>`,
        }),
        entries: [
          { path: "OEBPS/cover.xhtml", contents: sectionDocument("表紙") },
          { path: "OEBPS/section-1.xhtml", contents: sectionDocument("朝") },
        ],
      }),
    );

    expect(book.readingOrder.map((section) => section.linear)).toEqual([false, true]);
  });
});
