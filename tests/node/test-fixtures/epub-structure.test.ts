import { describe, expect, test } from "vitest";
import {
  assertWellFormedXml,
  openEpub,
  type EpubArchive,
} from "../support/epub-archive.ts";
import {
  buildFixture,
  syntheticFixtures,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

/**
 * 產生器的驗收不能只是「腳本沒丟例外」。這一組把「產出物是一本合規的書」拆成
 * 可以各自變紅的斷言：manifest 宣告的東西真的在壓縮檔裡、readingOrder 指得到
 * manifest、TOC 的 href 解析得到 Section、每一份 XML 都是良構的。
 *
 * 良構性那條特別要緊：XHTML 不是 HTML。少一個結束標籤，瀏覽器不會像對 HTML
 * 那樣寬容修復，而是整份文件拒絕渲染——而產生器是用字串樣板組出來的，那正是
 * 最容易破的地方。
 */

const fixtureNames = syntheticFixtures.map((fixture) => fixture.name);

function open(name: AilmentName): EpubArchive {
  return openEpub(buildFixture(name));
}

describe("產出物是一本合規的書", () => {
  test.for(fixtureNames)("%s 的 manifest 宣告的每一項都在壓縮檔裡", (name) => {
    const book = open(name);

    for (const item of book.manifest) {
      expect(book.has(item.archivePath), `manifest 的 ${item.href}`).toBe(true);
    }
  });

  test.for(fixtureNames)("%s 的壓縮檔裡沒有 manifest 沒宣告的內容", (name) => {
    const book = open(name);
    // OCF 自己那幾個檔案不必在 manifest 裡（`encryption.xml` 只有帶混淆資源的
    // 書才有）；其餘每一項都必須被宣告，否則 EpubBook 會讀到一份與壓縮檔內容
    // 不符的清單。
    const declared = new Set([
      "mimetype",
      "META-INF/container.xml",
      "META-INF/encryption.xml",
      book.packageDocumentPath,
      ...book.manifest.map((item) => item.archivePath),
    ]);

    expect(book.entryPaths.filter((path) => !declared.has(path))).toEqual([]);
  });

  test.for(fixtureNames)("%s 的 readingOrder 非空且都是 XHTML", (name) => {
    const book = open(name);

    expect(book.readingOrder.length).toBeGreaterThan(0);
    for (const section of book.readingOrder) {
      expect(section.mediaType).toBe("application/xhtml+xml");
    }
  });

  test.for(fixtureNames)("%s 的 TOC 每一項都解析得到 readingOrder 裡的 Section", (name) => {
    const book = open(name);
    const sections = new Set(book.readingOrder.map((section) => section.archivePath));

    expect(book.toc.length).toBeGreaterThan(0);
    for (const entry of book.toc) {
      expect(sections, `TOC 的 ${entry.href}`).toContain(entry.archivePath);
    }
  });

  test.for(fixtureNames)("%s 的每一份 XML 都是良構的", (name) => {
    const book = open(name);
    const xmlPaths = book.entryPaths.filter(
      (path) => path.endsWith(".xhtml") || path.endsWith(".xml") || path.endsWith(".opf"),
    );

    expect(xmlPaths.length).toBeGreaterThan(0);
    for (const path of xmlPaths) {
      assertWellFormedXml(book.text(path), path);
    }
  });

  test.for(fixtureNames)("%s 宣告的語言與內容一致", (name) => {
    const book = open(name);

    expect(book.language).toBe("ja");
    for (const section of book.readingOrder) {
      expect(book.text(section.archivePath)).toContain('xml:lang="ja"');
    }
  });
});
