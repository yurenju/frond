import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";

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

describe("公開的進入點", () => {
  test("@yurenju/frond/epub 這個 exports 進入點開得起書", async () => {
    // 其餘測試走相對路徑（那是這個 repo 內部的寫法），但消費端拿到的是
    // package.json 的 exports 那條路——沒有人走過的話，路徑打錯了不會有東西紅。
    //
    // **那條路指向 `dist/`，不是 `src/`**，所以這條測試要 `npm run build` 跑過
    // 才有東西可以載（`npm install` 的 `prepare` 會跑，容器裡由 Dockerfile 跑）。
    // 這正是它的價值所在：它是唯一會執行到出貨產物的測試，證明 emit 出來的
    // JavaScript 真的跑得動——副檔名改寫錯了、`exports` 的路徑打錯了，都紅在
    // 這裡。
    //
    // 斷言是「開得起一本書」而不是「與相對路徑 import 到的是同一個物件」：後者
    // 在 exports 指向 src 的時代恰好成立，但那是巧合而不是要守的事實。指向
    // `dist/` 之後兩者本來就是不同的模組實例，而消費端在乎的從來是它能不能用。
    //
    // ## 為什麼 specifier 繞過一個變數
    //
    // 寫成字面的 `import("@yurenju/frond/epub")` 會讓 **tsc 也去解析那條
    // 路**，於是 `npm run typecheck` 跟著要求 `dist/` 存在——一個剛 clone 下
    // 來、還沒 build 的樹會得到 `TS2307: Cannot find module
    // '@yurenju/frond/epub'`，而那個訊息完全看不出真正的原因是「還沒 build」。
    //
    // 繞過變數之後 tsc 放棄解析（型別退成 `any`），這條測試回到它本來就該是的
    // 樣子：**一個關於執行期的斷言**。出貨產物的型別那一半不歸這裡管，那是
    // `release.yml` 用一個 repo 外的假消費端、開著 `skipLibCheck: false` 在驗的
    // 事——而那個位置比這裡準，因為它從外面看，跟真的消費端一樣。
    // `dist/` 不在的時候，Node 丟的是 `Cannot find package
    // '@yurenju/frond'`——那個訊息把人指向 `exports` 設定，而真正的原因是「還沒
    // build」。先自己說清楚。
    expect(
      existsSync(new URL("../../../dist/epub/index.js", import.meta.url)),
      "dist/ 不存在。這條測試走的是出貨產物，先跑 `npm run build`",
    ).toBe(true);

    const publishedEntryPoint = "@yurenju/frond/epub";
    const entry = await import(publishedEntryPoint);
    const book = await entry.EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.title).toBe("frond fixture — vertical-japanese");
    expect(book.readingOrder.length).toBeGreaterThan(0);
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
