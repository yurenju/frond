import { describe, expect, test } from "vitest";
import { PNG } from "pngjs";
import { EpubBook } from "../../../src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import {
  handmadeBook,
  packageDocument,
  sectionDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * 封面圖——書櫃的縮圖來源。
 *
 * 兩種宣告寫法都要走得通，而且**不按版本分派**（ADR-0010）：樣本裡有一本 EPUB 3
 * 的封面只有 `<meta name="cover">`，按版本分派的實作會讓那本書沒有封面。規則是
 * 先找 `properties="cover-image"`，找不到才找 `<meta name="cover">`。
 */

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

describe("兩條宣告的路", () => {
  test("EPUB 3 的 properties=\"cover-image\"", async () => {
    const book = await EpubBook.open(await readFixture("cover-image-property.epub"));

    expect(book.cover?.foundBy).toBe("cover-image-property");
    expect(book.cover?.path).toBe("EPUB/images/cover.png");
    expect(book.cover?.mediaType).toBe("image/png");
  });

  test("EPUB 2 的 <meta name=\"cover\">", async () => {
    const book = await EpubBook.open(await readFixture("cover-meta-name-epub2.epub"));

    expect(book.cover?.foundBy).toBe("meta-name");
    expect(book.cover?.path).toBe("EPUB/images/cover.png");
    expect(book.cover?.mediaType).toBe("image/png");
  });

  test("EPUB 3 只用舊寫法宣告封面時也找得到", async () => {
    // ADR-0010 的實證：樣本裡有一本 EPUB 3 的封面只有 <meta name="cover">。
    // 這個形狀目前沒有 committed fixture，所以在這裡手工組一本。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>旧い書き方の本</dc:title>
    <dc:language>ja</dc:language>
    <meta name="cover" content="cover-image"/>`,
          manifest: `    <item id="cover-image" href="images/cover.png" media-type="image/png"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          { path: "OEBPS/images/cover.png", contents: PNG_SIGNATURE },
          { path: "OEBPS/section-1.xhtml", contents: sectionDocument("朝") },
        ],
      }),
    );

    expect(book.metadata.epubVersion).toBe("epub3");
    expect(book.cover?.foundBy).toBe("meta-name");
    expect(book.cover?.path).toBe("OEBPS/images/cover.png");
  });
});

describe("找到一個宣告不等於拿得到那張圖", () => {
  test("properties 指到遠端時退回 <meta name=\"cover\">", async () => {
    // ADR-0010 的規則是「先找 A，找不到就找 B」。把「找到一個指向遠端的宣告」
    // 當成「找到封面」，會讓一本兩種寫法都寫了的書沒有封面——而它的舊寫法指的
    // 正是封裝內那張圖。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>表紙が二か所にある本</dc:title>
    <dc:language>ja</dc:language>
    <meta name="cover" content="local-cover"/>`,
          manifest: `    <item id="remote-cover" href="https://example.invalid/cover.png" media-type="image/png" properties="cover-image remote-resources"/>
    <item id="local-cover" href="images/cover.png" media-type="image/png"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          { path: "OEBPS/images/cover.png", contents: PNG_SIGNATURE },
          ...HEALTHY_ENTRIES,
        ],
      }),
    );

    expect(book.cover?.foundBy).toBe("meta-name");
    expect(book.cover?.path).toBe("OEBPS/images/cover.png");
  });
});

describe("拿得到封面的位元組", () => {
  test.for(["cover-image-property.epub", "cover-meta-name-epub2.epub"])(
    "%s 的封面是真的 PNG",
    async (fileName: string) => {
      // 書櫃要的是圖本身，不是一個路徑——路徑對消費端沒有用，它手上只有這本書
      // 的位元組。尺寸來自 fixture 產生器的封面（100×160 的直立長方形），拿它
      // 當期望值可以擋掉「抓到內文圖版」那種錯（圖版是 96×128）。
      const book = await EpubBook.open(await readFixture(fileName));
      const decoded = PNG.sync.read(Buffer.from(book.cover!.bytes));

      expect(decoded.width).toBe(100);
      expect(decoded.height).toBe(160);
    },
  );
});

describe("沒有封面不是錯誤", () => {
  test("兩種寫法都沒有的書回報「沒有封面」", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.cover).toBeUndefined();
  });

  test("<meta name=\"cover\"> 指到不存在的 id 也只是沒有封面", async () => {
    // 書的封裝宣告與內容不一致是常態（ADR-0010），而讀者要的是書打得開。
    // 一本指壞了封面的書仍然讀得完，所以這裡回報「沒有封面」而不是丟錯。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>表紙を指しそこねた本</dc:title>
    <dc:language>ja</dc:language>
    <meta name="cover" content="どこにもない-id"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.cover).toBeUndefined();
  });
});
