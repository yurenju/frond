import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../packages/frond/src/epub/index.ts";
import { MemoryBook, type RenderableBook } from "../../../packages/frond/src/renderer/book.ts";

const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

describe("EpubBook 滿足 Renderer 對書的要求", () => {
  test("開出來的書可以直接當成 RenderableBook 用", async () => {
    // **這一條的價值在型別而不在執行期。** `RenderableBook` 是結構性的介面，
    // 沒有任何一行程式碼宣告 `EpubBook implements RenderableBook`——所以兩邊漂開
    // 的時候，唯一會紅的地方就是這一行的型別檢查。少了它，Renderer 會在某次
    // EpubBook 改欄位之後靜默地接不上，而那要到瀏覽器測試才炸。
    const book: RenderableBook = await EpubBook.open(
      readFileSync(join(FIXTURE_DIRECTORY, "vertical-japanese.epub")),
    );

    expect(book.readingOrder.length).toBeGreaterThan(0);
    expect(book.resources.length).toBeGreaterThan(0);
    expect(book.bytes(book.readingOrder[0]!.path).length).toBeGreaterThan(0);
  });
});

describe("MemoryBook", () => {
  const book = MemoryBook.of({
    sections: [
      { path: "one.xhtml", content: "<p>一</p>" },
      { path: "two.xhtml", content: "<p>二</p>", linear: false },
    ],
    resources: [
      { path: "images/a.png", mediaType: "image/png", bytes: Uint8Array.of(1, 2, 3) },
    ],
  });

  test("它就是一本 RenderableBook", () => {
    const renderable: RenderableBook = book;
    expect(renderable.readingOrder.length).toBe(2);
  });

  test("內容以 UTF-8 編碼", () => {
    expect(new TextDecoder().decode(book.bytes("one.xhtml"))).toBe("<p>一</p>");
  });

  test("linear 預設是 true，指定了就照指定的", () => {
    expect(book.readingOrder[0]!.linear).toBe(true);
    // 非線性的項目**留在清單裡**——濾掉封面頁與版權頁是政策不是事實（ADR-0002）。
    expect(book.readingOrder[1]!.linear).toBe(false);
  });

  test("內容文件與其他資源都在 resources 上，媒體型別查得到", () => {
    const paths = book.resources.map((resource) =>
      resource.location.kind === "remote" ? "(remote)" : resource.location.path,
    );

    expect(paths).toEqual(["one.xhtml", "two.xhtml", "images/a.png"]);
    expect(book.resources[2]!.mediaType).toBe("image/png");
    expect(book.resources[0]!.mediaType).toBe("application/xhtml+xml");
  });

  test("取不存在的路徑會丟，不回空位元組", () => {
    // 回空位元組的症狀是缺圖或滿頁豆腐字，而那時候沒有人查得到根因在取用這一步。
    expect(() => book.bytes("nope.xhtml")).toThrow(/nope\.xhtml/);
  });

  test("位元組形式的內容原樣收下", () => {
    const raw = MemoryBook.of({
      sections: [{ path: "x.xhtml", content: Uint8Array.of(60, 112, 62) }],
    });

    expect([...raw.bytes("x.xhtml")]).toEqual([60, 112, 62]);
  });
});
