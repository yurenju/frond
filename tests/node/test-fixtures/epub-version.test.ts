import { describe, expect, test } from "vitest";
import { PNG } from "pngjs";
import { openEpub, type EpubArchive } from "../support/epub-archive.ts";
import { buildEpub } from "../../../src/test-fixtures/epub.ts";
import {
  buildFixture,
  syntheticFixtures,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

/**
 * EPUB 版本是 fixture 的**第二個軸**（ADR-0007、ADR-0010）。
 *
 * 這一組要問的不是「病症在不在」，而是「這份產出物真的是那個 EPUB 版本嗎」。分開一個
 * 檔案的理由是失效方式不同：病症走偏會讓某一個 fixture 測錯東西，版本走偏會讓
 * **整批 EPUB 2 的 fixture 變成「EPUB 3 附一份 NCX」**——那是回溯相容那條路，
 * 不是野書那條，測了不算數（ADR-0010）。
 */

function open(name: AilmentName): EpubArchive {
  return openEpub(buildFixture(name));
}

describe("EPUB 2 這個版本", () => {
  test("封裝文件宣告 version=\"2.0\"", () => {
    expect(open("healthy-epub2").packageVersion).toBe("2.0");
  });

  test("導覽文件是 NCX，而且壓縮檔裡連 nav.xhtml 都沒有", () => {
    const book = open("healthy-epub2");

    expect(book.navigationVehicle).toBe("ncx");
    expect(book.navigationPath).toBe("EPUB/toc.ncx");
    expect(book.entryPaths.filter((path) => path.endsWith("nav.xhtml"))).toEqual([]);
    // properties 是 EPUB 3 manifest 才有的屬性。EPUB 2 的書帶著它，就是「EPUB 3
    // 附一份 NCX」那種合成物，而不是野書的形狀。
    expect(book.manifest.filter((item) => item.properties !== undefined)).toEqual([]);
  });

  test("NCX 由 manifest 宣告，且 readingOrder 用 spine 的 toc 屬性指得到它", () => {
    const book = open("healthy-epub2");
    const ncx = book.manifest.find(
      (item) => item.mediaType === "application/x-dtbncx+xml",
    );

    expect(ncx).toBeDefined();
    expect(book.readingOrderTocId).toBe(ncx!.id);
  });

  test("NCX 的每一個 navPoint 都有 navLabel、content 與 playOrder", () => {
    const book = open("healthy-epub2");
    const ncx = book.text(book.navigationPath);

    expect(book.toc.length).toBeGreaterThan(0);
    for (const entry of book.toc) {
      expect(entry.label).not.toBe("");
      expect(entry.href).not.toBe("");
    }
    // playOrder 是 NCX 自己的閱讀順序宣告，數量要與 navPoint 一致——少一個就是
    // 有 navPoint 漏了它。
    expect([...ncx.matchAll(/<navPoint /g)].length).toBe(book.toc.length);
    expect([...ncx.matchAll(/playOrder="\d+"/g)].length).toBe(book.toc.length);
    expect([...ncx.matchAll(/<navLabel>/g)].length).toBe(book.toc.length);
  });

  test("沒有 dcterms:modified——EPUB 2 沒有這個欄位", () => {
    const book = open("healthy-epub2");

    expect(book.text(book.packageDocumentPath)).not.toContain("dcterms:modified");
  });

  test("沒有 page-progression-direction——EPUB 2 沒有這個屬性", () => {
    // ADR-0010：EPUB 2 的書一律落在「書沒說」那一格，而 frond 回報缺席而不是
    // 預設值。fixture 必須真的缺席，否則 #8 的那條驗收沒有書可以餵。
    expect(open("healthy-epub2").pageProgressionDirection).toBeUndefined();
  });
});

describe("EPUB 3 沒有被改動", () => {
  const epub3 = syntheticFixtures
    .filter((fixture) => fixture.epubVersion === "epub3")
    .map((fixture) => fixture.name);

  test.for(epub3)("%s 仍宣告 version=\"3.0\"，導覽文件仍是 nav", (name) => {
    const book = open(name);

    expect(book.packageVersion).toBe("3.0");
    expect(book.navigationVehicle).toBe("nav");
  });

  test.for(epub3)("%s 裡沒有 NCX", (name) => {
    // EPUB 3 的野書幾乎都同時帶一份 NCX（ADR-0010：33 本樣本裡 31 本兩者都有），
    // 但那份 NCX 只有在「兩份導覽載體內容不一致」時才有測試價值，而那是 #23 的範圍。
    // 在它到之前，EPUB 3 的 fixture 不帶 NCX，好讓「NCX 出現」就等於 EPUB 2。
    expect(open(name).entryPaths.filter((path) => path.endsWith(".ncx"))).toEqual([]);
  });
});

describe("EPUB 版本寫在檔名上", () => {
  test.for(syntheticFixtures)(
    "$fileName 的後綴與它的 EPUB 版本一致",
    (fixture: (typeof syntheticFixtures)[number]) => {
      // 後綴只有非預設的那一種版本才帶：沒有後綴就是 EPUB 3。committed
      // fixture 與檔名的一對一是紅燈可讀性的來源，所以版本必須看得見。
      expect(fixture.fileName.endsWith("-epub2.epub")).toBe(
        fixture.epubVersion === "epub2",
      );
    },
  );

  test.for(syntheticFixtures)(
    "$fileName 宣告的版本與位元組裡的 <package version> 一致",
    (fixture: (typeof syntheticFixtures)[number]) => {
      const expected = fixture.epubVersion === "epub2" ? "2.0" : "3.0";

      expect(open(fixture.name).packageVersion).toBe(expected);
    },
  );
});

describe("封面", () => {
  test("cover-image-property：EPUB 3 走 manifest 的 properties=\"cover-image\"", () => {
    const book = open("cover-image-property");

    expect(book.cover?.foundBy).toBe("cover-image-property");
    expect(book.cover?.item.mediaType).toBe("image/png");
    expect(book.text(book.packageDocumentPath)).not.toContain('name="cover"');
  });

  test("cover-meta-name-epub2：EPUB 2 走 <meta name=\"cover\">", () => {
    const book = open("cover-meta-name-epub2");

    expect(book.cover?.foundBy).toBe("meta-name");
    expect(book.cover?.item.mediaType).toBe("image/png");
    // <meta name="cover"> 指的是 manifest 項目的 id，不是它的 href。指成 href
    // 是這條路上最典型的寫錯法，而錯了之後封面只是「找不到」不會報錯。
    expect(book.text(book.packageDocumentPath)).toContain(
      `<meta name="cover" content="${book.cover!.item.id}"/>`,
    );
  });

  test.for(["cover-image-property", "cover-meta-name-epub2"] as const)(
    "%s 的封面是真的 PNG",
    (name: AilmentName) => {
      const book = open(name);
      const decoded = PNG.sync.read(Buffer.from(book.bytes(book.cover!.item.archivePath)));

      expect(decoded.width).toBeGreaterThan(0);
      expect(decoded.height).toBeGreaterThan(0);
    },
  );

  test("沒宣告封面的書回報「沒有封面」，而不是丟錯", () => {
    // ADR-0010：兩種寫法都找不到就是這本書沒有封面，不是錯誤。
    expect(open("healthy-epub2").cover).toBeUndefined();
    expect(open("vertical-japanese").cover).toBeUndefined();
  });
});

describe("版本與封面宣告寫法的不合法組合被擋下來", () => {
  // 這兩條擋的是 #23 與 #24：它們會往這個產生器加 fixture，而這兩種組合產出的
  // 書不合規——而不合規的方式是靜默的（多一個屬性、多一個欄位），沒有東西會紅。
  const minimal = {
    title: "frond fixture",
    language: "ja",
    identifier: "urn:uuid:frond-fixture-probe",
    stylesheet: "html { line-height: 1.8; }\n",
    readingOrder: [{ path: "section-1.xhtml", title: "朝", body: "    <p>朝。</p>" }],
  } as const;

  test("EPUB 2 不能帶 page-progression-direction", () => {
    expect(() =>
      buildEpub({ ...minimal, epubVersion: "epub2", pageProgressionDirection: "rtl" }),
    ).toThrow(/page-progression-direction/);
  });

  test("EPUB 2 的封面不能走 properties=\"cover-image\"", () => {
    expect(() =>
      buildEpub({
        ...minimal,
        epubVersion: "epub2",
        cover: {
          path: "images/cover.png",
          mediaType: "image/png",
          contents: Uint8Array.of(1),
          declaredBy: ["cover-image-property"],
        },
      }),
    ).toThrow(/properties/);
  });
});
