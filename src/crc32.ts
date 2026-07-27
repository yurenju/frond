/**
 * CRC32（IEEE 802.3 那一版），ZIP 每個項目的完整性校驗。
 *
 * 讀寫兩端共用同一份：`src/test-fixtures/zip.ts` 寫入時算，`src/epub/zip.ts`
 * 讀出時驗。**共用是刻意的**——兩份實作可以同時錯得一樣，於是產生器寫出來的
 * fixture 用自己的讀取器讀得回來，測試全綠，而任何一個外部工具都打不開它。
 * 一份實作的話，錯了就是對照實作（`node:zlib`、`fflate`）那一側立刻紅燈。
 *
 * 手寫的理由與 `src/sha1.ts` 相同：平台上沒有這個函式，而 `EpubBook` 兩邊都要
 * 跑（ADR-0005）。它不是密碼學雜湊，不服務任何安全需求——CRC32 偵測的是傳輸
 * 與儲存的意外損壞，刻意的竄改它擋不住，也不該拿它擋。
 */

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  // 用索引而不是 `for…of`：讀取端每開一本書就要對整本的位元組算一次，而迭代器
  // 在這個迴圈裡佔的比重量得出來（34 MB 的書上，換掉之後這一支從 150 ms 掉到
  // 40 ms 上下）。
  for (let at = 0; at < bytes.length; at += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[at]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
