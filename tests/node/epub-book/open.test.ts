import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../src/epub/index.ts";
import { readFixture } from "./support/fixtures.ts";

/**
 * 開書——消費端把一本書的位元組交給 `EpubBook`，其餘的它不必知道。
 *
 * 這一組守的是**入口**：三種輸入型別都收得下，兩種 EPUB 版本都開得起來。解壓與
 * 容器格式（OCF 的 `mimetype`、`META-INF/container.xml`、封裝文件的位置）是
 * `EpubBook` 的義務，不是消費端的——書櫃只想給一個 `File` 然後拿到書名。
 *
 * 斷言一律下在公開 API 上（#8）：這裡看得到的東西，就是消費端看得到的東西。
 */

describe("三種輸入型別", () => {
  // 期望值來自 fixture 產生器的樣板（`src/test-fixtures/ailments.ts` 的
  // baseSpec）：書名是 `frond fixture — <病症名>`。寫成字面而不是回頭去問產生器
  // ——拿產生器算一次期望值，等於讓斷言與被測程式各自去問同一個可能錯的來源。
  const title = "frond fixture — vertical-japanese";

  test("ArrayBuffer", async () => {
    const bytes = await readFixture("vertical-japanese.epub");
    const book = await EpubBook.open(bytes.buffer);

    expect(book.metadata.title).toBe(title);
  });

  test("Blob", async () => {
    const book = await EpubBook.open(
      new Blob([await readFixture("vertical-japanese.epub")]),
    );

    expect(book.metadata.title).toBe(title);
  });

  test("File", async () => {
    const book = await EpubBook.open(
      new File([await readFixture("vertical-japanese.epub")], "vertical-japanese.epub", {
        type: "application/epub+zip",
      }),
    );

    expect(book.metadata.title).toBe(title);
  });
});

describe("EPUB 3", () => {
  test("開得起來，並回報自己是 EPUB 3", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.epubVersion).toBe("epub3");
  });
});

describe("零 DOM 依賴", () => {
  test("跑這一組測試的環境裡沒有 DOM", async () => {
    // ADR-0005 的雙層切分：`EpubBook` 零 DOM 依賴，這是它能在 Node 裡跑、測試
    // 落在金字塔底層的原因（ADR-0009）。這條斷言釘住的是**測試環境**——有人把
    // Vitest 的 environment 換成 jsdom 的話，上面每一條測試就不再證明這件事了，
    // 而那種退化沒有任何其他東西會紅。
    expect(globalThis.document).toBeUndefined();
    expect(globalThis.DOMParser).toBeUndefined();

    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.readingOrder.length).toBeGreaterThan(0);
  });
});

describe("EPUB 2", () => {
  test("開得起來，並回報自己是 EPUB 2", async () => {
    // EPUB 2 從第一天就在範圍內（ADR-0010），不是「先做 EPUB 3 再回頭補」。
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.metadata.epubVersion).toBe("epub2");
    expect(book.metadata.title).toBe("frond fixture — healthy-epub2");
  });
});
