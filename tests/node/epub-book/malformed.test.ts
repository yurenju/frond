import { describe, expect, test } from "vitest";
import { EpubBook, EpubOpenError, type EpubOpenFailure } from "../../../src/epub/index.ts";
import {
  handmadeBook,
  pack,
  packageDocument,
  HEALTHY_ENTRIES,
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
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("missing-container");
  });

  test("container.xml 不是良構的 XML", async () => {
    const archive = handmadeBook({
      container: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0"><rootfiles>`,
      packageDocument: packageDocument({}),
      entries: HEALTHY_ENTRIES,
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
      entries: HEALTHY_ENTRIES,
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
      ...HEALTHY_ENTRIES,
    ]);

    expect(await reasonOf(archive)).toBe("missing-package-document");
  });
});

describe("封裝文件", () => {
  test("不是良構的 XML", async () => {
    const archive = handmadeBook({
      packageDocument: `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0"><metadata><dc:title>閉じていない`,
      entries: HEALTHY_ENTRIES,
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
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("malformed-package-document");
  });

  test("沒有宣告 version——OEBPS 1.2 與 OEB 1.0 就長這樣", async () => {
    // ADR-0010 把 EPUB 2 之前的封裝格式劃在界線外：不讀，開書時以明確錯誤拒絕。
    const archive = handmadeBook({
      packageDocument: packageDocument({}).replace(' version="3.0"', ""),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("unsupported-package-version");
  });

  test("宣告的版本不在支援範圍內", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({ version: "1.2" }),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("unsupported-package-version");
  });

  test("version=\"3\" 少了小數點仍是 EPUB 3", async () => {
    // 判準是**主版本**而不是 `"3."` 這個前綴：照前綴比會把這種寫法誤拒，而
    // ADR-0010 劃在界線外的是 EPUB 2 之前的封裝格式，不是少一個小數點的書。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({ version: "3" }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.metadata.epubVersion).toBe("epub3");
  });
});

describe("OPF 指向不存在的檔案", () => {
  /**
   * 缺檔**只在 readingOrder 上致命**。
   *
   * 量到的依據（樣本那 33 本商業書，見 `resources.ts`）：照「manifest 缺任一項就
   * 拒開」的規則，34/34 全開得起來——沒有一本是靠它擋下來的；而把任何一項不在
   * readingOrder 上的資源拿掉，34/34 整本開不起來，暴露面是 1533 項。收益零、
   * 爆炸半徑 1533，權衡的方向由 ADR-0010 定：讀者要的是書打得開。
   */
  test("readingOrder 上的內容文件缺檔，整本拒開", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="section-2" href="section-2.xhtml" media-type="application/xhtml+xml"/>`,
        readingOrder: `    <itemref idref="section-1"/>
    <itemref idref="section-2"/>`,
      }),
      // section-2 宣告了，但只有 section-1 在壓縮檔裡。
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("missing-resource");
  });

  test("不在 readingOrder 上的資源缺檔，書照樣開得起來", async () => {
    // 一本漏了裝飾用插圖的書仍然讀得完。整本拒開等於讓一張圖決定讀者能不能讀。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="missing" href="images/どこにもない.png" media-type="image/png"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.readingOrder.map((section) => section.path)).toEqual([
      "OEBPS/section-1.xhtml",
    ]);
  });

  test("封面宣告了但圖不在包裡，書開得起來、只是沒有封面", async () => {
    // 「找到宣告」與「拿得到圖」是兩件事。書櫃缺一張縮圖，不該連書都收不進去。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.cover).toBeUndefined();
    expect(book.readingOrder).toHaveLength(1);
  });

  test("manifest 的 href 解析後跳出封裝根，仍然當場拒書", async () => {
    // 這與缺檔不是同一件事：跳出封裝根是不合規，也是路徑穿越的形狀，而樣本裡
    // 一本都沒有——放寬它沒有任何量到的好處。
    const archive = handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="escapee" href="../../外に出た.png" media-type="image/png"/>`,
      }),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("resource-outside-container");
  });

  test("readingOrder 指向 manifest 沒有的 id", async () => {
    const archive = handmadeBook({
      packageDocument: packageDocument({
        readingOrder: `    <itemref idref="section-1"/>
    <itemref idref="section-2"/>`,
      }),
      entries: HEALTHY_ENTRIES,
    });

    expect(await reasonOf(archive)).toBe("unknown-reading-order-item");
  });
});
