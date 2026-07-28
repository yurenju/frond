import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import {
  EpubBook,
  EpubResourceError,
  type EpubResourceFailure,
  type Resource,
} from "../../../packages/frond/src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import {
  handmadeBook,
  packageDocument,
  sectionDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * 資源取用——`Renderer` 排版時要的那條路：Section 的位元組、圖片、樣式表、字型。
 *
 * ## oracle 為什麼不是產生器
 *
 * 混淆那幾條的期望值全部由這個檔案**自己算**：`node:crypto` 的 SHA-1 加上寫在
 * 這裡的 XOR。拿產生器的反向操作去驗它自己的話，對演算法的任何誤解都會在兩邊
 * 同時成立，測試照樣全綠——而症狀要到讀者的畫面上才會以整頁豆腐字的形式出現。
 * 這與 `tests/node/support/epub-archive.ts` 用外部函式庫讀自己的產出是同一條
 * 紀律。
 */

const FONT_PATH = "EPUB/fonts/obfuscated.otf";
const FIXTURE_IDENTIFIER = "urn:uuid:frond-fixture-obfuscated-font-idpf";

/** IDPF 只蓋開頭這麼多位元組。 */
const OBFUSCATED_LENGTH = 1040;

/** Adobe 那一套的演算法 URI。frond 不解它。 */
const ADOBE_ALGORITHM = "http://ns.adobe.com/pdf/enc#RC";
const IDPF_ALGORITHM = "http://www.idpf.org/2008/embedding";

/**
 * IDPF 的混淆／還原——XOR 自己是自己的反運算，所以同一個函式兩用。
 *
 * 金鑰是 identifier 去掉空白之後的 SHA-1（規格點名 space、tab、CR、LF 四個
 * 碼位），雜湊走 `node:crypto`：那是與 frond 完全無關的第三方實作。
 */
function idpfXor(bytes: Uint8Array, identifier: string): Uint8Array {
  const stripped = [...identifier]
    .filter((character) => ![0x20, 0x09, 0x0d, 0x0a].includes(character.codePointAt(0)!))
    .join("");
  const key = createHash("sha1").update(stripped, "utf8").digest();

  const out = Uint8Array.from(bytes);
  for (let index = 0; index < Math.min(out.length, OBFUSCATED_LENGTH); index += 1) {
    out[index] = out[index]! ^ key[index % key.length]!;
  }
  return out;
}

/** 壓縮檔裡實際存著的位元組——還沒有經過任何還原。 */
function storedBytes(archive: Uint8Array, path: string): Uint8Array {
  const found = unzipSync(archive)[path];
  if (found === undefined) throw new Error(`壓縮檔內沒有 ${path}`);
  return found;
}

/** 一項資源在壓縮檔內的路徑。不在包裡的資源沒有位元組可拿，測試要的都在包裡。 */
function pathOf(resource: Resource | undefined): string {
  if (resource?.location.kind !== "in-container") {
    throw new Error(`${resource?.id ?? "(找不到)"} 不在壓縮檔內`);
  }
  return resource.location.path;
}

/**
 * 讀不到位元組時丟的是哪一種失敗。
 *
 * 只用這一種寫法問，是因為 `toThrow()` 只問到「有丟東西」——而這幾條要守的正是
 * **丟的是哪一種**：consumer 靠 `reason` 分辨「這本書沒有這一項」與「這一項解不
 * 開」，兩者該做的事不同。
 */
function expectFailure(read: () => unknown, reason: EpubResourceFailure): void {
  try {
    read();
    expect.unreachable("應該丟 EpubResourceError");
  } catch (error) {
    expect(error).toBeInstanceOf(EpubResourceError);
    expect((error as EpubResourceError).reason).toBe(reason);
  }
}

/** 宣告一份混淆資源的 `META-INF/encryption.xml`。 */
function encryptionXml(path: string, algorithm: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="${algorithm}"/>
    <enc:CipherData>
      <enc:CipherReference URI="${path}"/>
    </enc:CipherData>
  </enc:EncryptedData>
</encryption>
`;
}

describe("Section 的位元組與 media type", () => {
  test("readingOrder 上的每一項都拿得到", async () => {
    const archive = await readFixture("vertical-japanese.epub");
    const book = await EpubBook.open(archive);

    for (const section of book.readingOrder) {
      const bytes = book.bytes(section.path);

      expect(section.mediaType).toBe("application/xhtml+xml");
      // `Renderer` 要的是位元組本身：它手上只有這本書，沒有檔案系統。
      expect(new TextDecoder().decode(bytes)).toContain("<html");
    }
    expect(book.readingOrder.length).toBeGreaterThan(0);
  });

  test("拿到的是那一份 Section，不是別份", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));
    const first = new TextDecoder().decode(book.bytes(book.readingOrder[0]!.path));

    expect(first).toContain("朝の光");
    expect(first).not.toContain("坂の道");
  });
});

describe("manifest 上任一資源", () => {
  test("圖片拿得到位元組", async () => {
    const book = await EpubBook.open(
      await readFixture("empty-and-image-only-sections.epub"),
    );
    const image = book.resources.find((resource) => resource.mediaType === "image/png");

    const bytes = book.bytes(pathOf(image));
    // PNG 的簽章。拿到的是不是圖片，不能靠 media type 說了算——那是書的宣告。
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("樣式表拿得到位元組", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));
    const stylesheet = book.resources.find(
      (resource) => resource.mediaType === "text/css",
    );

    expect(new TextDecoder().decode(book.bytes(pathOf(stylesheet)))).toContain(
      "writing-mode",
    );
  });

  test("依 manifest 的 id 找得到", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.resource("stylesheet")?.mediaType).toBe("text/css");
    expect(book.resource("どこにもない-id")).toBeUndefined();
  });

  test("壓縮檔裡沒有的路徑丟明確錯誤", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expectFailure(() => book.bytes("EPUB/どこにもない.xhtml"), "missing-resource");
  });
});

describe("拿到了／在遠端／不在包裡，三種分得出來", () => {
  /** 一本 manifest 上三種情況都有的書。 */
  async function threeWays(): Promise<EpubBook> {
    return EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="narration" href="https://example.invalid/narration.mp3" media-type="audio/mpeg" properties="remote-resources"/>
    <item id="lost-plate" href="images/lost.png" media-type="image/png"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );
  }

  test("三種各自是自己的一格", async () => {
    const book = await threeWays();
    const kinds = Object.fromEntries(
      book.resources.map((resource) => [resource.id, resource.location.kind]),
    );

    // 把後兩者壓成同一個 undefined 的 API，會讓消費端分不出「這一項本來就不在
    // 包裡（合規）」與「這本書宣告了卻沒附上（書寫錯了）」——而那兩件事該做的
    // 事不同。
    expect(kinds).toEqual({
      "section-1": "in-container",
      narration: "remote",
      "lost-plate": "missing",
    });
  });

  test("缺檔與遠端都不讓這本書開不起來", async () => {
    // 缺檔只在 readingOrder 上致命（`resources.ts`：33/33 的量測）。這一條守的
    // 是既有語意不因為「開出取用 API」而被重新權衡。
    const book = await threeWays();

    expect(book.readingOrder).toHaveLength(1);
  });

  test("不在包裡的那一項，位置仍然回報得出來供診斷", async () => {
    const book = await threeWays();
    const lost = book.resource("lost-plate");

    expect(lost?.location).toEqual({ kind: "missing", path: "OEBPS/images/lost.png" });
  });
});

describe("IDPF 混淆過的字型", () => {
  test("解出來的位元組等於未混淆的原檔", async () => {
    const archive = await readFixture("obfuscated-font-idpf.epub");
    const book = await EpubBook.open(archive);

    // 期望值由這個檔案自己從壓縮檔裡的位元組算回去，用的是 node:crypto。
    const expected = idpfXor(storedBytes(archive, FONT_PATH), FIXTURE_IDENTIFIER);

    expect(book.bytes(FONT_PATH)).toEqual(expected);
  });

  test("壓縮檔裡存的確實是混淆過的位元組", async () => {
    // 少了這一條，一個什麼都不做的 restore() 也會讓上一條全綠——那時候測到的
    // 只是「fixture 沒有被混淆」。
    const archive = await readFixture("obfuscated-font-idpf.epub");
    const book = await EpubBook.open(archive);
    const stored = storedBytes(archive, FONT_PATH);
    const restored = book.bytes(FONT_PATH);

    expect([...stored.subarray(0, OBFUSCATED_LENGTH)]).not.toEqual([
      ...restored.subarray(0, OBFUSCATED_LENGTH),
    ]);
  });

  test("只蓋前 1040 個位元組，後面原樣不動", async () => {
    const archive = await readFixture("obfuscated-font-idpf.epub");
    const book = await EpubBook.open(archive);
    const stored = storedBytes(archive, FONT_PATH);
    const restored = book.bytes(FONT_PATH);

    // 蓋過頭是這個演算法最容易寫錯的一步，而它的症狀與「完全沒解」一樣：一份
    // 壞掉的字型。fixture 的長度刻意超過 1040 就是為了照出這一格。
    expect(stored.length).toBeGreaterThan(OBFUSCATED_LENGTH);
    expect([...restored.subarray(OBFUSCATED_LENGTH)]).toEqual([
      ...stored.subarray(OBFUSCATED_LENGTH),
    ]);
  });

  test("金鑰的推導會去掉 identifier 裡的空白", async () => {
    // 書把 identifier 折行寫在 XML 裡是常見的。不去空白的話，同一本書換一種
    // 排版就推出另一把金鑰。
    const identifier = "urn:uuid:frond \t\r\n handmade";
    const original = Uint8Array.from({ length: 1100 }, (_, index) => (index * 7) % 256);

    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">${identifier}</dc:identifier>
    <dc:title>字型を難読化した本</dc:title>
    <dc:language>ja</dc:language>`,
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="face" href="fonts/face.otf" media-type="font/otf"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "META-INF/encryption.xml",
            contents: encryptionXml("OEBPS/fonts/face.otf", IDPF_ALGORITHM),
          },
          {
            path: "OEBPS/fonts/face.otf",
            contents: idpfXor(original, identifier),
          },
        ],
      }),
    );

    expect(book.bytes("OEBPS/fonts/face.otf")).toEqual(original);
  });

  test("沒有宣告混淆的書，位元組原樣回傳", async () => {
    // 樣本裡 33 本全部沒有 encryption.xml，所以這是常態那一格。
    const archive = await readFixture("empty-and-image-only-sections.epub");
    const book = await EpubBook.open(archive);
    const path = "EPUB/images/plate.png";

    expect(book.bytes(path)).toEqual(storedBytes(archive, path));
  });
});

describe("不支援的混淆方式", () => {
  /** 一本用 `algorithm` 宣告混淆了一份資源的書。 */
  function obfuscatedWith(algorithm: string): Uint8Array {
    return handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="face" href="fonts/face.otf" media-type="font/otf"/>`,
      }),
      entries: [
        ...HEALTHY_ENTRIES,
        {
          path: "META-INF/encryption.xml",
          contents: encryptionXml("OEBPS/fonts/face.otf", algorithm),
        },
        { path: "OEBPS/fonts/face.otf", contents: Uint8Array.from({ length: 1100 }) },
      ],
    });
  }

  test("Adobe 那套給明確錯誤，不吐壞位元組", async () => {
    // 兩套的金鑰推導與長度都不同，拿 IDPF 去解 Adobe **一定**得到壞位元組。
    // 而壞字型在畫面上的症狀是滿頁豆腐字——那時候沒有人查得到根因在解碼，所以
    // 這裡寧可讓消費端拿到一個說得出原因的錯誤。
    const book = await EpubBook.open(obfuscatedWith(ADOBE_ALGORITHM));

    expectFailure(() => book.bytes("OEBPS/fonts/face.otf"), "unsupported-obfuscation");
    // 訊息要說得出是哪一套演算法——「不支援」而不說是什麼，查的人還是得自己
    // 去翻壓縮檔。
    expect(() => book.bytes("OEBPS/fonts/face.otf")).toThrow(ADOBE_ALGORITHM);
  });

  test("真的加密過的資源同樣是明確錯誤", async () => {
    const book = await EpubBook.open(
      obfuscatedWith("http://www.w3.org/2001/04/xmlenc#aes256-cbc"),
    );

    expectFailure(() => book.bytes("OEBPS/fonts/face.otf"), "unsupported-obfuscation");
  });

  test("這本書照樣開得起來，其他資源照樣拿得到", async () => {
    // 解不開的是那一項字型，不是這本書。讀者要的是書打得開（ADR-0010）。
    const book = await EpubBook.open(obfuscatedWith(ADOBE_ALGORITHM));

    expect(book.readingOrder).toHaveLength(1);
    expect(new TextDecoder().decode(book.bytes("OEBPS/section-1.xhtml"))).toContain(
      "<html",
    );
  });

  test("IDPF 混淆但書沒有 identifier 時，說得出金鑰推不出來", async () => {
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:title>識別碼のない本</dc:title>
    <dc:language>ja</dc:language>`,
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="face" href="fonts/face.otf" media-type="font/otf"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "META-INF/encryption.xml",
            contents: encryptionXml("OEBPS/fonts/face.otf", IDPF_ALGORITHM),
          },
          { path: "OEBPS/fonts/face.otf", contents: Uint8Array.from({ length: 1100 }) },
        ],
      }),
    );

    expect(book.metadata.identifier).toBeUndefined();
    expectFailure(() => book.bytes("OEBPS/fonts/face.otf"), "missing-obfuscation-key");
  });
});

describe("封面與資源走同一條路", () => {
  test("解不開的封面等於沒有封面，不是開不起來", async () => {
    // 同一個路徑在同一本書上只能有一種答案：封面若繞過還原直接讀壓縮檔，
    // `book.cover.bytes` 與 `book.bytes(cover.path)` 就會給出兩批不同的位元組。
    // 而拿不到封面的處置早就定好了——那不是錯誤（ADR-0010）。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>表紙が復号できない本</dc:title>
    <dc:language>ja</dc:language>
    <meta name="cover" content="cover-image"/>`,
          manifest: `    <item id="cover-image" href="images/cover.png" media-type="image/png"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "META-INF/encryption.xml",
            contents: encryptionXml("OEBPS/images/cover.png", ADOBE_ALGORITHM),
          },
          { path: "OEBPS/images/cover.png", contents: Uint8Array.from({ length: 64 }) },
        ],
      }),
    );

    expect(book.cover).toBeUndefined();
    expect(book.readingOrder).toHaveLength(1);
  });
});

describe("encryption.xml 的 URI 也是 URL", () => {
  test("編碼過的 URI 對得上壓縮檔的項目名", async () => {
    // 字型的檔名帶空白是常見的，而 URI 裡的它是 percent-encoded 的。這一條與
    // manifest、TOC 走的是同一條解析。
    const original = Uint8Array.from({ length: 1100 }, (_, index) => (index * 13) % 256);
    const identifier = "urn:uuid:frond-handmade";

    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="face" href="fonts/Noto%20Serif.otf" media-type="font/otf"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "META-INF/encryption.xml",
            contents: encryptionXml("OEBPS/fonts/Noto%20Serif.otf", IDPF_ALGORITHM),
          },
          {
            path: "OEBPS/fonts/Noto Serif.otf",
            contents: idpfXor(original, identifier),
          },
        ],
      }),
    );

    expect(book.bytes("OEBPS/fonts/Noto Serif.otf")).toEqual(original);
  });
});
