import { crc32 } from "../crc32.ts";
import { concat } from "./zip.ts";

/**
 * 決定性的 PNG writer。只夠寫出 8-bit 灰階、無交錯的圖。
 *
 * 為什麼不用 pngjs（repo 裡已經有了）：pngjs 的 IDAT 走 `node:zlib`，而 deflate
 * 的輸出是實作的函數不是格式的函數——同一張圖在不同 Node 版本下可以壓出不同
 * （但都合法）的位元組，於是「換一台機器重新產生 fixture」就會生出與程式碼無關
 * 的 git diff。這裡的 IDAT 一律用 **stored（未壓縮）的 deflate 區塊**——那是
 * deflate 格式合法的一種，任何解碼器都吃，而且輸出完全由輸入決定。
 *
 * 這一條與 `zip.ts` 的取捨不同，別把兩邊的理由混在一起：`zip.ts` 那邊 stored
 * 之後就沒有壓縮這個變數了，手寫買到的是別的東西（見該檔頂端）。
 *
 * 代價是圖片比壓縮過的大。fixture 的圖只有幾 KB，這筆交易划算。
 */

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const BIT_DEPTH_8 = 8;
const COLOR_TYPE_GRAYSCALE = 0;
const FILTER_NONE = 0;

/** IHDR 的內容長度，由格式固定。 */
const IHDR_SIZE = 13;

/** 每個 chunk 的框架：4 bytes 長度 + 4 bytes 型別 + 4 bytes CRC。 */
const CHUNK_FRAME_SIZE = 12;
const CHUNK_TYPE_OFFSET = 4;
const CHUNK_DATA_OFFSET = 8;

/** stored 區塊的框架：1 byte 的 BFINAL/BTYPE + LEN + NLEN。 */
const STORED_BLOCK_HEADER_SIZE = 5;

/** deflate 的 stored 區塊有 16 bit 的長度欄位。 */
const MAX_STORED_BLOCK = 0xffff;

export interface GrayscaleImage {
  readonly width: number;
  readonly height: number;
  /** `(x, y)` 對應的灰階值，0–255。 */
  readonly sample: (x: number, y: number) => number;
}

export function encodePng(image: GrayscaleImage): Uint8Array {
  const header = new Uint8Array(IHDR_SIZE);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, image.width);
  headerView.setUint32(4, image.height);
  header[8] = BIT_DEPTH_8;
  header[9] = COLOR_TYPE_GRAYSCALE;
  header[10] = 0; // compression method: deflate
  header[11] = 0; // filter method
  header[12] = 0; // interlace: none

  // 每一列前面加一個 filter 位元組。一律取 None——filter 的用處是幫助壓縮，
  // 而這裡根本不壓縮。
  const raw = new Uint8Array((image.width + 1) * image.height);
  let at = 0;
  for (let y = 0; y < image.height; y += 1) {
    raw[at] = FILTER_NONE;
    at += 1;
    for (let x = 0; x < image.width; x += 1) {
      raw[at] = image.sample(x, y) & 0xff;
      at += 1;
    }
  }

  return concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(CHUNK_FRAME_SIZE + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, CHUNK_TYPE_OFFSET);
  out.set(data, CHUNK_DATA_OFFSET);
  view.setUint32(CHUNK_DATA_OFFSET + data.length, crc32(concat([typeBytes, data])));
  return out;
}

/** 把位元組包成 zlib 串流，內容全部是 deflate 的 stored 區塊。 */
function zlibStored(data: Uint8Array): Uint8Array {
  // CMF 0x78 = deflate、32 KiB 視窗。FLG 0x01 讓 (CMF<<8 | FLG) 能被 31 整除，
  // 那是 zlib header 的檢查條件。
  const parts: Uint8Array[] = [Uint8Array.from([0x78, 0x01])];

  for (let offset = 0; offset < data.length || offset === 0; offset += MAX_STORED_BLOCK) {
    const length = Math.min(MAX_STORED_BLOCK, data.length - offset);
    const isFinal = offset + length >= data.length;
    const block = new Uint8Array(STORED_BLOCK_HEADER_SIZE + length);
    block[0] = isFinal ? 1 : 0; // BFINAL + BTYPE=00（stored）
    const view = new DataView(block.buffer);
    view.setUint16(1, length, true);
    view.setUint16(3, ~length & 0xffff, true);
    block.set(
      data.subarray(offset, offset + length),
      STORED_BLOCK_HEADER_SIZE,
    );
    parts.push(block);
    if (isFinal) break;
  }

  const checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, adler32(data));
  parts.push(checksum);

  return concat(parts);
}

function adler32(data: Uint8Array): number {
  const MODULO = 65521;
  let low = 1;
  let high = 0;
  for (const byte of data) {
    low = (low + byte) % MODULO;
    high = (high + low) % MODULO;
  }
  return ((high << 16) | low) >>> 0;
}
