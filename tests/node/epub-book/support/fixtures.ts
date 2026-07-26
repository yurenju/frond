import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * 讀一份 committed fixture 的位元組。`tests/fixtures/` 是唯一的來源。
 *
 * 回傳 `Uint8Array<ArrayBuffer>` 而不是 `Buffer`：`Buffer` 的 backing store 在
 * 型別上是 `ArrayBufferLike`（可能是 `SharedArrayBuffer`），而 `Blob` 與
 * `ArrayBuffer` 那兩條輸入路徑都要求 `ArrayBuffer`。
 */
export async function readFixture(
  fileName: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const directory = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "fixtures",
  );
  return Uint8Array.from(await readFile(join(directory, fileName)));
}
