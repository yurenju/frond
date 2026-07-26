import { describe, expect, test } from "vitest";
import { PNG } from "pngjs";
import { openEpub, type EpubArchive } from "../support/epub-archive.ts";
import {
  buildFixture,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

/**
 * 每個 fixture 到底有沒有帶著它名字上的那個病。
 *
 * 這一組與 `single-ailment.test.ts` 是一體兩面：這裡問「病在不在」，那裡問
 * 「病有沒有溢出到別的檔案」。兩條都要，只有前者的話一個把所有病症寫進同一份
 * 樣式表的產生器也會全綠。
 */

function open(name: AilmentName): EpubArchive {
  return openEpub(buildFixture(name));
}

describe("樣式表裡的病症", () => {
  test("writing-mode-on-body：直排宣告在 body 而不是 html", () => {
    const book = open("writing-mode-on-body");

    expect(book.stylesheet).toMatch(/body\s*\{[^}]*writing-mode:\s*vertical-rl/);
    expect(book.stylesheet).not.toMatch(/html\s*\{[^}]*writing-mode/);
  });

  test("vertical-japanese：直排宣告在 html——這是對照組", () => {
    const book = open("vertical-japanese");

    expect(book.stylesheet).toMatch(/html\s*\{[^}]*writing-mode:\s*vertical-rl/);
    expect(book.stylesheet).not.toMatch(/body\s*\{[^}]*writing-mode/);
  });

  test("font-size-important：書用 !important 蓋掉讀者的字級", () => {
    const book = open("font-size-important");

    expect(book.stylesheet).toMatch(/font-size:\s*12px\s*!important/);
  });

  test("fixed-width-800：固定寬度讓小螢幕的內容被裁掉", () => {
    const book = open("fixed-width-800");

    expect(book.stylesheet).toMatch(/width:\s*800px/);
  });

  test("hardcoded-colors：寫死前景與背景，夜間模式失效", () => {
    const book = open("hardcoded-colors");

    expect(book.stylesheet).toMatch(/color:\s*#000000/);
    expect(book.stylesheet).toMatch(/background-color:\s*#ffffff/);
  });
});

describe("TOC href 裡的病症", () => {
  test("toc-href-percent-comma：nav 的逗號被編碼成 %2c，manifest 沒有", () => {
    const book = open("toc-href-percent-comma");

    const encoded = book.toc.filter((entry) => entry.href.includes("%2c"));
    expect(encoded.length).toBe(1);

    // 病症的形狀是 nav 與 manifest 對同一個檔名有兩種寫法。兩邊都編碼的話
    // 字串比對就會直接成功，這個 fixture 也就測不到東西了。
    const section = book.readingOrder.find(
      (item) => item.archivePath === encoded[0]!.archivePath,
    );
    expect(section?.href).toContain(",");
    expect(section?.href).not.toContain("%2c");
  });

  test("toc-href-parent-prefix：導覽文件在子目錄，href 帶 ../ 前綴", () => {
    const book = open("toc-href-parent-prefix");

    expect(book.navigationPath).toBe("EPUB/nav/nav.xhtml");
    for (const entry of book.toc) {
      expect(entry.href).toMatch(/^\.\.\//);
    }
    // 「解析得到 Section」由 epub-structure.test.ts 蓋住——這裡只釘住病症的
    // 形狀。href 若不是相對於導覽文件而是相對於封裝文件去解析，那條會紅。
  });
});

describe("readingOrder 的方向", () => {
  test("ppd-rtl-vertical：直排且 page-progression-direction=rtl", () => {
    const book = open("ppd-rtl-vertical");

    expect(book.pageProgressionDirection).toBe("rtl");
    expect(book.stylesheet).toMatch(/html\s*\{[^}]*writing-mode:\s*vertical-rl/);
  });

  test("對照組不宣告 page-progression-direction", () => {
    // 「沒宣告」與「宣告成 ltr」在規格上同義但在位元組上不同。對照組取前者，
    // 才能讓 ppd-rtl-vertical 與它之間只差那一個屬性。
    expect(open("vertical-japanese").pageProgressionDirection).toBeUndefined();
  });
});

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe("readingOrder 形狀上的病症", () => {
  test("huge-single-section：單一巨大的 Section", () => {
    const book = open("huge-single-section");

    expect(book.readingOrder.length).toBe(1);
    expect(book.text(book.readingOrder[0]!.archivePath).length).toBeGreaterThan(
      30_000,
    );
  });

  test("empty-and-image-only-sections：一個空的、一個只有圖片的", () => {
    const book = open("empty-and-image-only-sections");
    const bodies = book.readingOrder.map((section) =>
      bodyOf(book.text(section.archivePath)),
    );

    expect(bodies.filter((body) => body.trim() === "").length).toBe(1);

    const imageOnly = bodies.filter(
      (body) => body.includes("<img") && !/<p[\s>]/.test(body),
    );
    expect(imageOnly.length).toBe(1);
  });

  test("empty-and-image-only-sections：圖片是真的 PNG 且被 manifest 宣告", () => {
    const book = open("empty-and-image-only-sections");
    const image = book.manifest.find((item) => item.mediaType === "image/png");

    expect(image).toBeDefined();
    const bytes = book.bytes(image!.archivePath);
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    // 用 pngjs 真的解一次。只比對簽章的話，一份 IDAT 壞掉、CRC 算錯或 adler32
    // 寫反的 PNG 照樣會過——而那種圖在瀏覽器裡是一個破圖 icon，不是圖版。
    const decoded = PNG.sync.read(Buffer.from(bytes));
    expect(decoded.width).toBe(96);
    expect(decoded.height).toBe(128);
  });
});

function bodyOf(document: string): string {
  return document.slice(
    document.indexOf("<body>") + "<body>".length,
    document.indexOf("</body>"),
  );
}
