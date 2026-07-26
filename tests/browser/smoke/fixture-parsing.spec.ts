import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import {
  syntheticFixtures,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

/**
 * 合成 fixture 裡的每一份 XML 在三家瀏覽器裡真的解得開。
 *
 * fixture 的產生器是用字串樣板組出來的，而 **XHTML 不是 HTML**：少一個結束
 * 標籤、屬性沒加引號、`&` 沒跳脫，瀏覽器不會像對 HTML 那樣寬容修復，而是整份
 * 文件拒絕渲染。那個失敗模式在 Node 層看不見——`EpubBook` 讀 metadata 不需要
 * 建 DOM——會一路撐到 `Renderer` 才炸，而且炸在離病因很遠的地方。
 *
 * 這裡刻意用瀏覽器自己的 DOMParser 而不是 Node 的 XML 函式庫（那條由
 * `tests/node/test-fixtures/epub-structure.test.ts` 蓋）：要問的就是「這三個
 * 引擎吃不吃」，那只有這三個引擎能回答。
 *
 * 檔名清單從產生器取，不在這裡抄一份。抄一份的話，加一個病症時這支測試會
 * 靜默地不涵蓋它——而「沒有涵蓋」是不會變紅的。
 */

const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

/** XHTML 與其餘 XML（container.xml、package.opf）的 media type 不同。 */
const XHTML = "application/xhtml+xml";
const XML = "application/xml";

test("解析失敗真的偵測得到", async ({ page }) => {
  // 沒有這一條，下面十條在「怎麼問都答沒問題」的環境裡也會全綠——而那正是
  // 這種測試最典型的失效方式。三家回報解析錯誤的方式並不相同（有的塞
  // parsererror 元素、有的連命名空間都不一樣），所以要各自證明一次。
  const failures = await parse(page, [
    { path: "broken.xhtml", source: "<a><b></a>", mediaType: XHTML },
  ]);

  expect(failures.length).toBe(1);
});

for (const fixture of syntheticFixtures) {
  test(`${fixture.name} 的 XML 在這個引擎裡解得開`, async ({ page }) => {
    const documents = xmlDocumentsIn(fixture.name);

    expect(documents.length).toBeGreaterThan(0);
    expect(await parse(page, documents)).toEqual([]);
  });
}

interface XmlDocument {
  readonly path: string;
  readonly source: string;
  readonly mediaType: string;
}

function xmlDocumentsIn(name: AilmentName): XmlDocument[] {
  const entries = unzipSync(readFileSync(join(FIXTURE_DIRECTORY, `${name}.epub`)));
  const decoder = new TextDecoder();

  return Object.entries(entries)
    // `.ncx` 也在裡面：EPUB 2 的導覽文件是 XML，而它同樣是字串樣板組出來的。
    // 副檔名清單漏掉它的話這支測試會**靜默地不涵蓋**它——而「沒有涵蓋」不會變紅。
    .filter(([path]) => /\.(xhtml|xml|opf|ncx)$/.test(path))
    .map(([path, bytes]) => ({
      path,
      source: decoder.decode(bytes),
      mediaType: path.endsWith(".xhtml") ? XHTML : XML,
    }));
}

/** 回傳解不開的文件，每份一則訊息。全部解得開時回傳空陣列。 */
async function parse(
  page: Page,
  documents: readonly XmlDocument[],
): Promise<string[]> {
  return page.evaluate((sources) => {
    const parser = new DOMParser();
    return sources
      .map(({ path, source, mediaType }) => {
        const parsed = parser.parseFromString(
          source,
          mediaType as DOMParserSupportedType,
        );
        // 解析失敗時三家都會回一份帶 parsererror 的文件，而不是丟例外。
        const error = parsed.querySelector("parsererror");
        return error === null ? null : `${path}: ${error.textContent ?? ""}`;
      })
      .filter((message): message is string => message !== null);
  }, documents as XmlDocument[]);
}
