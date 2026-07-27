import { crc32 } from "../crc32.ts";
import { EpubOpenError } from "./errors.ts";

/**
 * ZIP reader，剛好夠讀 OCF（EPUB）容器。
 *
 * ## 為什麼不用函式庫
 *
 * frond 出貨時**零 runtime 相依**。這一支取代的是 `fflate.unzipSync`，而它之所
 * 以只有兩百行，是因為**解壓本身沒有自己寫**：`DecompressionStream('deflate-raw')`
 * 是平台內建的，Node 與三家瀏覽器都在（`tests/browser/smoke/decompression-stream.spec.ts`
 * 是那個假設的絆線）。留給這個檔案的只剩容器格式的剖析，而那是一組定長欄位。
 *
 * 換掉它順便修掉一件事：`unzipSync` 是同步的，開一本 34 MB 的書會把主執行緒鎖
 * 住將近一百毫秒。這裡的解壓落在 JS 執行緒之外並且分批重疊，實測比同步版更快。
 *
 * ## 從 central directory 讀，不是從 local header 掃
 *
 * 兩種讀法都拿得到項目。差別在 local header 的長度欄位**允許是騙人的**——寫入
 * 端若邊壓邊寫（streaming），寫 local header 時還不知道壓完多長，於是三個欄位
 * 填 0、真正的值補在資料後面的 data descriptor 裡（general purpose flag 的第 3
 * 個 bit）。central directory 沒有這個問題：它在檔案最後才寫，每個欄位都是定案
 * 的值。**照 central directory 讀，data descriptor 就自動不是一種要處理的情況**，
 * 而不是一條要記得寫的分支。
 *
 * ## 明確不支援的，一律丟錯而不是猜
 *
 * ZIP64、加密、deflate 以外的壓縮方法、多磁碟區。樣本裡（34 本書、3309 個項目）
 * 這四種**一個都沒有**——ZIP64 要書超過 4 GB 或超過 65535 個項目才會用上。
 * 它們的共同點是：猜錯的代價是**解出一批看起來像資料的垃圾**，而那會一路流到
 * 畫面上變成亂碼或壞圖，沒有人查得到根因在這裡。所以寧可開不起來。
 *
 * 有意不做的還有一項：**項目名稱不做路徑消毒**。`../` 開頭的名稱在這裡照收，
 * 因為 frond 從不拿它寫檔案——它只是一張表的鍵，而查表的那一側（`resource-path.ts`
 * 的 `resolveHref`）已經擋掉了跳出封裝根的 href。在這裡多擋一次，會讓那本書
 * 從「有一項資源指到封裝外」變成「整本開不起來」，而那是兩件不同的事。
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;

/** 三種記錄的固定長度，都不含後面接的檔名、extra field 與註解。 */
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_RECORD_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;
const ZIP64_LOCATOR_SIZE = 20;

const STORED = 0;
const DEFLATED = 8;

/** general purpose flag 的第 0 個 bit：這一項被加密過。 */
const ENCRYPTED_FLAG = 0x0001;

/**
 * ZIP64 的哨兵值。欄位滿格代表「真正的值在 ZIP64 的 extra field 裡」，而不是
 * 「這一項剛好是 4 GB」——照字面讀會得到一個荒謬的長度，然後解出垃圾。
 */
const ZIP64_SENTINEL_16 = 0xffff;
const ZIP64_SENTINEL_32 = 0xffffffff;

/** 壓縮檔註解的長度上限（欄位是 16 bit），也就是 EOCD 往回找的搜尋範圍。 */
const MAX_ARCHIVE_COMMENT_SIZE = 0xffff;

/**
 * 一批同時解壓幾項。
 *
 * 併發是效能的來源（實測 255 個項目：逐項 345 ms，併發 54 ms），但不設上限就
 * 等於讓一本書決定同時開幾條 stream，而項目數是書寫的。32 已經足夠讓解壓互相
 * 重疊——瓶頸在解壓本身，不在還能再多開幾條。
 */
const DECOMPRESSION_BATCH_SIZE = 32;

/**
 * 把整個壓縮檔讀成「路徑 → 位元組」。
 *
 * 一次全解到記憶體，與 `openContainer` 的介面是同一個決定：它之上的每一層都只
 * 看得到那張表，所以之後要換成延遲解壓或 range request，動的仍然只有這裡。
 */
export async function readZip(
  archive: Uint8Array,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const directory = readCentralDirectory(archive, view);

  const entries = new Map<string, Uint8Array>();
  for (let at = 0; at < directory.length; at += DECOMPRESSION_BATCH_SIZE) {
    const batch = directory.slice(at, at + DECOMPRESSION_BATCH_SIZE);
    const contents = await Promise.all(batch.map((entry) => contentsOf(archive, view, entry)));
    batch.forEach((entry, index) => entries.set(entry.path, contents[index]!));
  }
  return entries;
}

interface DirectoryEntry {
  readonly path: string;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

function readCentralDirectory(
  archive: Uint8Array,
  view: DataView,
): readonly DirectoryEntry[] {
  const end = findEndOfCentralDirectory(archive, view);

  // 多磁碟區的壓縮檔：這一份只是其中一片，其餘的位元組根本不在手上。
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
    throw unsupported("這個壓縮檔分成多片（multi-disk），frond 只讀單一檔案");
  }

  const count = view.getUint16(end + 10, true);
  const offset = view.getUint32(end + 16, true);
  const size = view.getUint32(end + 12, true);
  if (
    count === ZIP64_SENTINEL_16 ||
    offset === ZIP64_SENTINEL_32 ||
    size === ZIP64_SENTINEL_32 ||
    hasZip64Locator(view, end)
  ) {
    throw unsupported("這個壓縮檔是 ZIP64，frond 不支援");
  }

  const entries: DirectoryEntry[] = [];
  let at = offset;
  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_DIRECTORY_RECORD_SIZE > archive.length) {
      throw notAZip(`central directory 的第 ${index + 1} 項超出檔案結尾`);
    }
    if (view.getUint32(at, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw notAZip(`central directory 的第 ${index + 1} 項沒有正確的簽章`);
    }

    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const pathLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localHeaderOffset = view.getUint32(at + 42, true);
    const path = decodePath(archive, at + CENTRAL_DIRECTORY_RECORD_SIZE, pathLength);

    if ((flags & ENCRYPTED_FLAG) !== 0) {
      throw unsupported(`${path} 被加密過，frond 不解密`);
    }
    if (method !== STORED && method !== DEFLATED) {
      throw unsupported(`${path} 用的壓縮方法是 ${method}，frond 只讀 stored 與 deflate`);
    }
    if (
      compressedSize === ZIP64_SENTINEL_32 ||
      uncompressedSize === ZIP64_SENTINEL_32 ||
      localHeaderOffset === ZIP64_SENTINEL_32
    ) {
      throw unsupported(`${path} 的長度或位置要 ZIP64 才表達得了，frond 不支援`);
    }

    // 目錄項目沒有內容，只是給檔案總管看的結構。收進表裡的話，`has("OEBPS/")`
    // 會回答「有」，而那個路徑取不出任何位元組。
    if (!path.endsWith("/")) {
      entries.push({
        path,
        method,
        crc,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }
    at += CENTRAL_DIRECTORY_RECORD_SIZE + pathLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * 從檔案結尾往回找 EOCD。
 *
 * **只比簽章是不夠的**：那四個位元組可以合法地出現在壓縮資料裡，或出現在壓縮檔
 * 自己的註解裡。所以每個候選位置都要再問一次「它宣告的註解長度，剛好等於它後面
 * 剩下的位元組嗎」——真正的 EOCD 一定對得起來，撞到的假簽章幾乎不會。
 */
function findEndOfCentralDirectory(archive: Uint8Array, view: DataView): number {
  const earliest = Math.max(
    0,
    archive.length - END_OF_CENTRAL_DIRECTORY_SIZE - MAX_ARCHIVE_COMMENT_SIZE,
  );
  for (let at = archive.length - END_OF_CENTRAL_DIRECTORY_SIZE; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(at + 20, true);
    if (at + END_OF_CENTRAL_DIRECTORY_SIZE + commentLength === archive.length) return at;
  }
  throw notAZip("找不到 ZIP 的 end of central directory 記錄");
}

/** ZIP64 的 locator 就貼在 EOCD 前面。有它就代表真正的目錄資訊在 ZIP64 那一套裡。 */
function hasZip64Locator(view: DataView, end: number): boolean {
  const at = end - ZIP64_LOCATOR_SIZE;
  if (at < 0) return false;
  return view.getUint32(at, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE;
}

/**
 * 項目名稱一律當 UTF-8 解。
 *
 * ZIP 原本的字集是 CP437，UTF-8 要靠 general purpose flag 的第 11 個 bit 宣告。
 * 這裡不分兩條路，因為 EPUB 規定容器內的路徑就是 UTF-8，而樣本裡 3309 個項目
 * **沒有一個**的名稱含非 ASCII 位元組——兩種解法在那批書上結果完全相同。多寫
 * 一張 CP437 對照表換不到任何一本已知的書。
 */
function decodePath(archive: Uint8Array, at: number, length: number): string {
  return new TextDecoder().decode(archive.subarray(at, at + length));
}

async function contentsOf(
  archive: Uint8Array,
  view: DataView,
  entry: DirectoryEntry,
): Promise<Uint8Array> {
  const header = entry.localHeaderOffset;
  if (
    header + LOCAL_FILE_HEADER_SIZE > archive.length ||
    view.getUint32(header, true) !== LOCAL_FILE_HEADER_SIGNATURE
  ) {
    throw notAZip(`${entry.path} 的 local file header 不在 central directory 說的位置上`);
  }

  // extra field 的長度要讀 local header 自己的那一格——同一個項目在兩處的 extra
  // field 允許不一樣長（寫入端常在 local 這側補對齊用的填充），拿 central 的長度
  // 來算資料起點會偏掉。
  const pathLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  const start = header + LOCAL_FILE_HEADER_SIZE + pathLength + extraLength;
  if (start + entry.compressedSize > archive.length) {
    throw notAZip(`${entry.path} 的資料超出檔案結尾，這個壓縮檔不完整`);
  }

  const raw = archive.subarray(start, start + entry.compressedSize);
  const contents =
    entry.method === STORED ? raw.slice() : await inflateRaw(raw, entry.path);

  if (contents.length !== entry.uncompressedSize) {
    throw notAZip(
      `${entry.path} 解出 ${contents.length} 個位元組，但目錄說是 ${entry.uncompressedSize} 個`,
    );
  }
  // CRC 對不上代表位元組壞了。不擋的話壞掉的內容會一路流到畫面上——一本下載到
  // 一半的書會變成「這一章是亂碼」，而那時候沒有人查得到根因在解壓。
  if (crc32(contents) !== entry.crc) {
    throw notAZip(`${entry.path} 的 CRC 對不上，這一項的位元組壞了`);
  }
  return contents;
}

async function inflateRaw(raw: Uint8Array, path: string): Promise<Uint8Array> {
  // `deflate-raw` 不是 `deflate`：後者帶 zlib 的表頭，而 ZIP 的項目裡沒有那兩個
  // 位元組。餵錯的話每一項都會解壓失敗。
  const stream = new DecompressionStream("deflate-raw");

  // 寫入不能先 await：`write()` 要等讀取端把資料收走才 resolve（背壓），先等它
  // 就是死鎖。但它也不能不接——資料壞掉時 writable 與 readable **兩側都會**
  // reject，而沒人接的那一側會變成 unhandled rejection：測試照樣綠，行程在別的
  // 地方炸掉。所以這裡讓它並行跑、把錯誤吞掉，真正的錯誤由讀取端回報。
  const written = (async () => {
    const writer = stream.writable.getWriter();
    // 型別上 `Uint8Array` 的底層可能是 `SharedArrayBuffer`，而 `write()` 的簽章
    // 不收那一種。實際上這一段永遠是 `readZip` 收到的那個壓縮檔的一小片，不是
    // 共享記憶體——這裡斷言的是那件事，不是繞過檢查。
    await writer.write(raw as Uint8Array<ArrayBuffer>);
    await writer.close();
  })().catch(() => undefined);

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const reader = stream.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch (cause) {
    await written;
    throw notAZip(`${path} 的 deflate 資料解不開`, { cause });
  }
  await written;

  const contents = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    contents.set(chunk, at);
    at += chunk.length;
  }
  return contents;
}

function notAZip(detail: string, options?: ErrorOptions): EpubOpenError {
  return new EpubOpenError("not-a-zip", `這些位元組不是讀得動的 ZIP：${detail}`, options);
}

function unsupported(detail: string): EpubOpenError {
  return new EpubOpenError("unsupported-zip-feature", detail);
}
