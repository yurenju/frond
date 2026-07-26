/**
 * 決定性的 ZIP writer，剛好夠寫出 OCF（EPUB）容器。
 *
 * 為什麼不用現成的函式庫：決定性是這批 fixture 的硬需求（ADR-0007 的第一層
 * ——fixture 一重新產生，所有幾何數字都會跟著漂，而漂動的原因與 frond 的
 * 程式碼無關）。ZIP 格式裡有三個非決定性的來源，全都要顯式壓掉：
 *
 * 1. **mtime**。ZIP 每個項目都寫入 MS-DOS 時間戳。取「現在」是最常見的破口
 *    ——每跑一次產生器，檔案的位元組就換一批。這裡固定在 DOS 時間的原點
 *    1980-01-01T00:00:00。
 * 2. **項目順序**。呼叫端給定的順序原樣寫出，不排序、不平行化。
 * 3. **壓縮輸出**。deflate 的輸出是實作的函數，不是格式的函數——同一份輸入
 *    在不同 zlib 版本下可以給出不同（但都合法）的位元組。Node 的 zlib 是隨
 *    Node 版本走的，於是「換一台機器重新產生 fixture」就會產生與程式碼無關的
 *    git diff。**因此一律 stored（method 0），完全不壓縮。**合成 fixture 很
 *    小，省下的體積不值得拿決定性去換。
 *
 * 有意不支援：ZIP64、加密、data descriptor、多磁碟區、目錄項目。合成 fixture
 * 不需要，而少一條分支就少一個決定性的破口。
 */

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** 三種記錄的固定長度，都不含後面接的檔名與 extra field。 */
const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_RECORD_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

const STORED = 0;
const VERSION_NEEDED_TO_EXTRACT = 10; // 1.0 — stored、無 ZIP64
const VERSION_MADE_BY = 20;

/** MS-DOS 時間戳的原點。DOS 時間無法表示比這更早的時刻。 */
const DOS_DATE_1980_01_01 = 0x0021;
const DOS_TIME_MIDNIGHT = 0x0000;

export interface ZipEntry {
  /** 壓縮檔內的路徑，一律以 `/` 分隔，不以 `/` 開頭。 */
  readonly path: string;
  readonly contents: Uint8Array;
}

/**
 * 把項目依給定順序打包。第一個項目寫在檔案最前面——OCF 靠這一點要求
 * `mimetype` 打頭，見 `epub.ts`。
 */
export function zip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const path = encoder.encode(entry.path);
    const crc = crc32(entry.contents);

    const header = new Uint8Array(LOCAL_FILE_HEADER_SIZE + path.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, LOCAL_FILE_HEADER_SIGNATURE, true);
    headerView.setUint16(4, VERSION_NEEDED_TO_EXTRACT, true);
    headerView.setUint16(6, 0, true); // general purpose flags
    headerView.setUint16(8, STORED, true);
    headerView.setUint16(10, DOS_TIME_MIDNIGHT, true);
    headerView.setUint16(12, DOS_DATE_1980_01_01, true);
    headerView.setUint32(14, crc, true);
    headerView.setUint32(18, entry.contents.length, true);
    headerView.setUint32(22, entry.contents.length, true);
    headerView.setUint16(26, path.length, true);
    headerView.setUint16(28, 0, true); // extra field length
    header.set(path, LOCAL_FILE_HEADER_SIZE);

    const record = new Uint8Array(CENTRAL_DIRECTORY_RECORD_SIZE + path.length);
    const recordView = new DataView(record.buffer);
    recordView.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    recordView.setUint16(4, VERSION_MADE_BY, true);
    recordView.setUint16(6, VERSION_NEEDED_TO_EXTRACT, true);
    recordView.setUint16(8, 0, true);
    recordView.setUint16(10, STORED, true);
    recordView.setUint16(12, DOS_TIME_MIDNIGHT, true);
    recordView.setUint16(14, DOS_DATE_1980_01_01, true);
    recordView.setUint32(16, crc, true);
    recordView.setUint32(20, entry.contents.length, true);
    recordView.setUint32(24, entry.contents.length, true);
    recordView.setUint16(28, path.length, true);
    recordView.setUint16(30, 0, true); // extra field length
    recordView.setUint16(32, 0, true); // comment length
    recordView.setUint16(34, 0, true); // disk number start
    recordView.setUint16(36, 0, true); // internal attributes
    // external attributes 一律 0。真實的 zip(1) 會寫入 unix 權限位元，而那是
    // 跟著產生檔案的 umask 走的——又一個決定性的破口。
    recordView.setUint32(38, 0, true);
    recordView.setUint32(42, offset, true);
    record.set(path, CENTRAL_DIRECTORY_RECORD_SIZE);

    local.push(header, entry.contents);
    central.push(record);
    offset += header.length + entry.contents.length;
  }

  const centralSize = central.reduce((total, record) => total + record.length, 0);
  const end = new Uint8Array(END_OF_CENTRAL_DIRECTORY_SIZE);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  endView.setUint16(4, 0, true); // this disk
  endView.setUint16(6, 0, true); // disk with central directory
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  endView.setUint16(20, 0, true); // comment length

  return concat([...local, ...central, end]);
}

export function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

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
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
