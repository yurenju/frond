import { expect, test } from "@playwright/test";

/**
 * All three browsers recognize `DecompressionStream('deflate-raw')`.
 *
 * frond's decompression goes through it (`src/epub/zip.ts`), and without it no book opens
 * at all — an EPUB's container is a ZIP, and 3308 of the sample's 3309 entries are
 * deflated. This is frond's one platform assumption outside the ES standard, so it
 * deserves a test of its own: when the assumption fails, this is what should go red,
 * rather than "this book will not open" scattered everywhere.
 *
 * `deflate-raw` and `deflate` are two different things — the latter carries zlib's
 * two-byte header, which a ZIP entry does not have. Fed the wrong one, decompression
 * rejects, so a small piece of actual compressed data is verified alongside rather than
 * only asking whether the constructor exists: asking only that would silently pass an
 * engine that knows `deflate` but not `deflate-raw`.
 */

/** "frond" compressed with `deflate-raw`. Fixed bytes rather than compressed on the fly in the test. */
const DEFLATE_RAW_FROND = [0x4b, 0x2b, 0xca, 0xcf, 0x4b, 0x01, 0x00];

test("all three decode deflate-raw", async ({ page }) => {
  await page.goto("about:blank");

  const decoded = await page.evaluate(async (bytes) => {
    if (typeof DecompressionStream !== "function") return "no DecompressionStream";

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
