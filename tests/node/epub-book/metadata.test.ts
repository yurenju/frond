import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../packages/frond/src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import {
  handmadeBook,
  packageDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * metadata——一本書對自己的宣告。書櫃靠它排架，所以這一組是「拿到書名、作者、
 * 語言」那條驗收。
 *
 * ## 頁面推進方向不是書寫方向
 *
 * `page-progression-direction` 講的是**翻頁往哪個方向前進**，宣告在封裝文件裡，
 * 由 `EpubBook` 回報。**書寫方向（直排／橫排）不在這裡**——它寫在樣式表裡，要有
 * CSSOM 才判得準，所以由 `Renderer` 回報（ADR-0010、CONTEXT.md）。把兩者混成一個
 * 欄位，直排的 LTR 書與橫排的 RTL 書就會拿到同一個答案。
 */

describe("書名、語言、識別碼", () => {
  test("EPUB 3 讀得到", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.title).toBe("frond fixture — vertical-japanese");
    expect(book.metadata.language).toBe("ja");
    expect(book.metadata.identifier).toBe("urn:uuid:frond-fixture-vertical-japanese");
  });

  test("EPUB 2 讀得到——identifier 帶著 opf:scheme 也一樣", async () => {
    // EPUB 2 的 dc:identifier 寫成 `<dc:identifier opf:scheme="uuid">`。ADR-0010：
    // 原樣取出，不解讀它自稱是哪一種識別碼，也不據此正規化。
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.metadata.title).toBe("frond fixture — healthy-epub2");
    expect(book.metadata.language).toBe("ja");
    expect(book.metadata.identifier).toBe("urn:uuid:frond-fixture-healthy-epub2");
  });
});

describe("作者", () => {
  test("多位作者依文件順序全部讀出來", async () => {
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>二人で書いた本</dc:title>
    <dc:language>ja</dc:language>
    <dc:creator opf:role="aut">佐藤 花子</dc:creator>
    <dc:creator opf:role="aut">鈴木 太郎</dc:creator>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.metadata.authors).toEqual(["佐藤 花子", "鈴木 太郎"]);
  });

  test("沒宣告作者的書拿到空清單，不是丟錯", async () => {
    // 合成 fixture 全部沒有 dc:creator。書沒說作者不是壞書。
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.authors).toEqual([]);
  });
});

describe("頁面推進方向", () => {
  test("書宣告 rtl 就回報 rtl", async () => {
    const book = await EpubBook.open(await readFixture("ppd-rtl-vertical.epub"));

    expect(book.metadata.pageProgressionDirection).toBe("rtl");
  });

  test("EPUB 3 沒宣告時回報「書沒說」，不是 ltr", async () => {
    // ADR-0010：把「書沒說」與「書說了 ltr」壓成同一個值，消費端就無法分辨——
    // 而那正是它需要分辨的（spine 要據此決定左滑是上一頁還是下一頁）。
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.pageProgressionDirection).toBeUndefined();
  });

  test("EPUB 2 一律落在「書沒說」那一格", async () => {
    // EPUB 2 根本沒有這個屬性。frond 不因此發明一個預設值（ADR-0010）。
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.metadata.pageProgressionDirection).toBeUndefined();
  });

  test("書宣告 ltr 與書沒說是兩個不同的回答", async () => {
    const declared = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          readingOrderAttributes: ' page-progression-direction="ltr"',
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );
    const silent = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({}),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(declared.metadata.pageProgressionDirection).toBe("ltr");
    expect(silent.metadata.pageProgressionDirection).toBeUndefined();
  });
});
