import { expect, test } from "@playwright/test";

/**
 * 三家瀏覽器都認得 `DecompressionStream('deflate-raw')`。
 *
 * frond 的解壓走這一支（`src/epub/zip.ts`），沒有它就開不了任何一本書——EPUB
 * 的容器是 ZIP，而樣本裡 3309 個項目有 3308 個是 deflate。這是 frond 對平台
 * 唯一一項「不在 ES 標準裡」的假設，所以它值得一條自己的測試：假設不成立時
 * 該紅的是這一條，而不是散在各處的「這本書開不起來」。
 *
 * `deflate-raw` 與 `deflate` 是兩種不同的東西——後者帶 zlib 的兩位元組表頭，
 * 而 ZIP 的項目裡沒有那個表頭。餵錯的話解壓會拒絕，所以這裡連同一小段實際的
 * 壓縮資料一起驗，不只問建構子在不在：只問建構子的話，一個認得 `deflate` 卻
 * 不認得 `deflate-raw` 的引擎會靜默地通過。
 */

/** `deflate-raw` 壓過的 "frond"。固定位元組，不在測試裡即時壓一份。 */
const DEFLATE_RAW_FROND = [0x4b, 0x2b, 0xca, 0xcf, 0x4b, 0x01, 0x00];

test("三家都解得開 deflate-raw", async ({ page }) => {
  await page.goto("about:blank");

  const decoded = await page.evaluate(async (bytes) => {
    if (typeof DecompressionStream !== "function") return "沒有 DecompressionStream";

    const stream = new DecompressionStream("deflate-raw");
    const writer = stream.writable.getWriter();
    void writer.write(new Uint8Array(bytes));
    void writer.close();

    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return new TextDecoder().decode(out);
  }, DEFLATE_RAW_FROND);

  expect(decoded).toBe("frond");
});
