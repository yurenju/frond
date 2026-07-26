import { describe, expect, test } from "vitest";
import { EpubBook, EpubOpenError } from "../../../src/epub/index.ts";
import {
  handmadeBook,
  packageDocument,
  sectionDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * manifest 的 `href` 依 **URL 規則**相對封裝文件解析。
 *
 * 這一組守的是一條會**對好書誤報**的路：#8 的留言記了一本 Kobo 通路的書，OPF 在
 * `OEBPS/content.opf`，manifest 裡有 `href="../js/kobo.js"`，而 `js/kobo.js` 確實
 * 存在於封裝根。那是合規的書。用字串接合的實作會去找 `OEBPS/../js/kobo.js` 這個
 * 字面上的 ZIP 項目名，找不到，於是把好書判成「OPF 指向不存在的檔案」。
 *
 * 演這個形狀的 committed fixture 由 #23 產（那一軸正在平行進行）。在它落地之前，
 * 這裡用手工組的書把解析規則守住；fixture 到了之後可以再補一條端到端的。
 */

/** Kobo 那本書的形狀：OPF 在 `OEBPS/`，資源在封裝根。 */
function koboShapedBook(): Uint8Array {
  return handmadeBook({
    packageDocumentPath: "OEBPS/content.opf",
    packageDocument: packageDocument({
      manifest: `    <item id="js-kobo.js" href="../js/kobo.js" media-type="application/javascript"/>
    <item id="section-1" href="../text/section-1.xhtml" media-type="application/xhtml+xml"/>`,
      readingOrder: `    <itemref idref="section-1"/>`,
    }),
    entries: [
      { path: "js/kobo.js", contents: "var kobo = {};\n" },
      { path: "text/section-1.xhtml", contents: sectionDocument("朝") },
    ],
  });
}

describe("href 帶 ../ 走到封裝根", () => {
  test("這本書開得起來——它合規", async () => {
    const book = await EpubBook.open(koboShapedBook());

    expect(book.metadata.title).toBe("手で組んだ本");
  });

  test("Section 解析到封裝根底下的那一份檔案", async () => {
    const book = await EpubBook.open(koboShapedBook());

    // 字串接合會得到 `OEBPS/../text/section-1.xhtml`，那不是任何一個項目的名字。
    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "text/section-1.xhtml",
    ]);
  });
});

describe("解析後跳出封裝根", () => {
  test("是不合規，不是「找不到檔案」", async () => {
    // `URL` 在根目錄把多餘的 `..` 吃掉（解析成 `/evil.png`），所以這一條同時也
    // 守著「吃掉之後不能假裝它落在封裝內」。
    const archive = handmadeBook({
      packageDocumentPath: "OEBPS/content.opf",
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="escapee" href="../../evil.png" media-type="image/png"/>`,
      }),
      entries: HEALTHY_ENTRIES,
    });

    await expect(EpubBook.open(archive)).rejects.toThrow(EpubOpenError);
    await expect(EpubBook.open(archive)).rejects.toMatchObject({
      reason: "resource-outside-container",
    });
  });
});

describe("遠端資源", () => {
  test("manifest 指到別的 origin 不會讓整本書開不起來", async () => {
    // EPUB 3 允許遠端資源（宣告 properties="remote-resources" 的影音）。frond
    // 這一刀不下載它，但把它當成「指向不存在的檔案」會讓一本合規的書開不起來。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="narration" href="https://example.invalid/narration.mp3" media-type="audio/mpeg" properties="remote-resources"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "OEBPS/section-1.xhtml",
    ]);
  });
});

describe("container.xml 的 full-path 也是 URL", () => {
  test("編碼過的 full-path 找得到封裝文件", async () => {
    // full-path 與 manifest 的 href 走同一條解析——只有其中一邊記得書可以把
    // 路徑編碼過的話，另一邊就會在同一種書上壞掉。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocumentPath: "OEBPS 本体/content.opf",
        container: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS%20%E6%9C%AC%E4%BD%93/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
        packageDocument: packageDocument({}),
        entries: [
          { path: "OEBPS 本体/section-1.xhtml", contents: sectionDocument("朝") },
        ],
      }),
    );

    expect(book.readingOrder[0]?.path).toBe("OEBPS 本体/section-1.xhtml");
  });
});

describe("percent-encoding", () => {
  test("href 編碼過的字元還原成 ZIP 項目名裡的字面", async () => {
    // ZIP 的項目名是原始位元組，不是 URL。href 寫 `%20`，項目名是空白。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="text/%E6%9C%9D%20one.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          { path: "OEBPS/text/朝 one.xhtml", contents: sectionDocument("朝") },
        ],
      }),
    );

    expect(book.readingOrder[0]?.path).toBe("OEBPS/text/朝 one.xhtml");
  });
});
