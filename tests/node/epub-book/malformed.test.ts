import { describe, expect, test } from "vitest";
import { EpubBook, EpubOpenError, type EpubOpenFailure } from "../../../src/epub/index.ts";
import {
  handmadeBook,
  pack,
  packageDocument,
  sectionDocument,
} from "./support/handmade.ts";

/**
 * 壞書——**明確的錯誤，而不是靜默失敗或半開的狀態**（#8）。
 *
 * 斷言下在 `reason` 上而不是訊息的字面：訊息是給人看的，會隨措辭改寫；`reason`
 * 是公開 API 的一部分，書櫃靠它分辨「這個檔案根本不是書」（直接不收）與「這本
 * 書的封裝壞了」（值得告訴讀者）。
 *
 * 這些形狀沒有一種產得出 committed fixture——fixture 產生器只寫得出合規的書
 * （ADR-0007），所以這一組的書逐位元組手工組。
 */

async function reasonOf(archive: Uint8Array): Promise<EpubOpenFailure> {
  try {
    await EpubBook.open(archive);
  } catch (error) {
    if (error instanceof EpubOpenError) {
      // 訊息一併檢查非空：reason 是給程式看的，人還是要看得懂發生什麼事。
      expect(error.message).not.toBe("");
      return error.reason;
    }
    throw error;
  }
  throw new Error("這本書開起來了，但它不該開得起來");
}

const healthyEntries = [
  { path: "OEBPS/section-1.xhtml", contents: sectionDocument("朝") },
];

describe("容器層", () => {
  test("不是 zip", async () => {
    // 下載到一半、拿到別的檔案、或根本是一份純文字。
    const notAZip = new TextEncoder().encode("這不是一個壓縮檔，只是一段文字。");

    expect(await reasonOf(notAZip)).toBe("not-a-zip");
  });

  test("空的位元組也是「不是 zip」", async () => {
    expect(await reasonOf(new Uint8Array(0))).toBe("not-a-zip");
  });

  test("缺 META-INF/container.xml", async () => {
    // 一個沒有容器的 ZIP 可能是任何東西——.cbz、.docx、作者自己壓的資料夾。
    const archive = handmadeBook({
      container: null,
      packageDocument: packageDocument({}),
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("missing-container");
  });

  test("container.xml 不是良構的 XML", async () => {
    const archive = handmadeBook({
      container: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0"><rootfiles>`,
      packageDocument: packageDocument({}),
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("malformed-container");
  });

  test("container.xml 沒有指出封裝文件的位置", async () => {
    const archive = handmadeBook({
      container: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles/>
</container>
`,
      packageDocument: packageDocument({}),
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("malformed-container");
  });

  test("container.xml 指到的封裝文件不在壓縮檔內", async () => {
    const archive = pack([
      { path: "mimetype", contents: "application/epub+zip" },
      {
        path: "META-INF/container.xml",
        contents: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
      },
      ...healthyEntries,
    ]);

    expect(await reasonOf(archive)).toBe("missing-package-document");
  });
});

describe("封裝文件", () => {
  test("不是良構的 XML", async () => {
    const archive = handmadeBook({
      packageDocument: `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0"><metadata><dc:title>閉じていない`,
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("malformed-package-document");
  });

  test("沒有 <manifest>", async () => {
    const archive = handmadeBook({
      packageDocument: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>manifest のない本</dc:title>
  </metadata>
  <spine/>
</package>
`,
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("malformed-package-document");
  });

  test("沒有宣告 version——OEBPS 1.2 與 OEB 1.0 就長這樣", async () => {
    // ADR-0010 把 EPUB 2 之前的封裝格式劃在界線外：不讀，開書時以明確錯誤拒絕。
    const archive = handmadeBook({
      packageDocument: packageDocument({}).replace(' version="3.0"', ""),
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("unsupported-package-version");
  });

  test("宣告的版本不在支援範圍內", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({ version: "1.2" }),
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("unsupported-package-version");
  });
});

describe("OPF 指向不存在的檔案", () => {
  test("manifest 的 href 在壓縮檔內找不到", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="missing" href="images/どこにもない.png" media-type="image/png"/>`,
      }),
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("missing-resource");
  });

  test("readingOrder 指向 manifest 沒有的 id", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({
        readingOrder: `    <itemref idref="section-1"/>
    <itemref idref="section-2"/>`,
      }),
      entries: healthyEntries,
    });

    expect(await reasonOf(archive)).toBe("unknown-reading-order-item");
  });
});
