import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";

/**
 * 合成 fixture 的 XHTML 在三家瀏覽器裡真的解得開。
 *
 * fixture 的產生器是用字串樣板組出來的，而 **XHTML 不是 HTML**：少一個結束
 * 標籤、屬性沒加引號、`&` 沒跳脫，瀏覽器不會像對 HTML 那樣寬容修復，而是整份
 * 文件拒絕渲染。那個失敗模式在 Node 層看不見——`EpubBook` 讀 metadata 不需要
 * 建 DOM——會一路撐到 `Renderer` 才炸，而且炸在離病因很遠的地方。
 *
 * 這裡刻意用瀏覽器自己的 DOMParser 而不是 Node 的 XML 函式庫（那條由
 * `tests/node/test-fixtures/epub-structure.test.ts` 蓋）：要問的就是「這三個
 * 引擎吃不吃」，那只有這三個引擎能回答。
 */

const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

const FIXTURE_NAMES = [
  "vertical-japanese",
  "writing-mode-on-body",
  "toc-href-percent-comma",
  "toc-href-parent-prefix",
  "font-size-important",
  "fixed-width-800",
  "hardcoded-colors",
  "ppd-rtl-vertical",
  "huge-single-section",
  "empty-and-image-only-sections",
];

test("解析失敗真的偵測得到", async ({ page }) => {
  // 沒有這一條，下面十條在「怎麼問都答沒問題」的環境裡也會全綠——而那正是
  // 這種測試最典型的失效方式。三家回報解析錯誤的方式並不相同（有的塞
  // parsererror 元素、有的連命名空間都不一樣），所以要各自證明一次。
  const failures = await parse(page, [
    { path: "broken.xhtml", source: "<a><b></a>" },
  ]);

  expect(failures.length).toBe(1);
});

for (const name of FIXTURE_NAMES) {
  test(`${name} 的 XHTML 在這個引擎裡解得開`, async ({ page }) => {
    const entries = unzipSync(
      readFileSync(join(FIXTURE_DIRECTORY, `${name}.epub`)),
    );
    const decoder = new TextDecoder();
    const documents = Object.entries(entries)
      .filter(([path]) => path.endsWith(".xhtml"))
      .map(([path, bytes]) => ({ path, source: decoder.decode(bytes) }));

    expect(documents.length).toBeGreaterThan(0);

    expect(await parse(page, documents)).toEqual([]);
  });
}

interface XhtmlDocument {
  readonly path: string;
  readonly source: string;
}

/** 回傳解不開的文件，每份一則訊息。全部解得開時回傳空陣列。 */
async function parse(
  page: Page,
  documents: readonly XhtmlDocument[],
): Promise<string[]> {
  return page.evaluate((sources) => {
    const parser = new DOMParser();
    return sources
      .map(({ path, source }) => {
        const parsed = parser.parseFromString(source, "application/xhtml+xml");
        // 解析失敗時三家都會回一份帶 parsererror 的文件，而不是丟例外。
        const error = parsed.querySelector("parsererror");
        return error === null ? null : `${path}: ${error.textContent ?? ""}`;
      })
      .filter((message): message is string => message !== null);
  }, documents as XhtmlDocument[]);
}
