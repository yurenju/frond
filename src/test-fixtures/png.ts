import { concat, crc32 } from "./zip.ts";

/**
 * 決定性的 PNG writer。只夠寫出 8-bit 灰階、無交錯的圖。
 *
 * 為什麼不用 pngjs（repo 裡已經有了）：同 `zip.ts` 的理由，deflate 的輸出是
 * 實作的函數而不是格式的函數。這裡的 IDAT 一律用 **stored（未壓縮）的 deflate
 * 區塊**——那是 deflate 格式合法的一種，任何解碼器都吃，而且輸出完全由輸入
 * 決定，換一個 zlib 版本也不會漂。
 *
 * 代價是圖片比壓縮過的大。fixture 的圖只有幾 KB，這筆交易划算。
 */

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const BIT_DEPTH_8 = 8;
const COLOR_TYPE_GRAYSCALE = 0;
const FILTER_NONE = 0;

/** deflate 的 stored 區塊有 16 bit 的長度欄位。 */
const MAX_STORED_BLOCK = 0xffff;

export interface GrayscaleImage {
  readonly width: number;
  readonly height: number;
  /** `(x, y)` 對應的灰階值，0–255。 */
  readonly sample: (x: number, y: number) => number;
}

export function encodePng(image: GrayscaleImage): Uint8Array {
  const header = new Uint8Array(13);
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
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(concat([typeBytes, data])));
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
    const block = new Uint8Array(5 + length);
    block[0] = isFinal ? 1 : 0; // BFINAL + BTYPE=00（stored）
    const view = new DataView(block.buffer);
    view.setUint16(1, length, true);
    view.setUint16(3, ~length & 0xffff, true);
    block.set(data.subarray(offset, offset + length), 5);
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
