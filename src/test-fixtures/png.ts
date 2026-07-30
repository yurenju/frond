import { crc32 } from "../crc32.ts";
import { concat } from "./zip.ts";

/**
 * A deterministic PNG writer. Only enough for 8-bit greyscale, non-interlaced images.
 *
 * Why not pngjs (which the repo already has): pngjs's IDAT goes through `node:zlib`, and
 * deflate's output is a function of the implementation rather than of the format — the
 * same image can compress to different (but all valid) bytes under different Node
 * versions, so "regenerate the fixtures on another machine" produces a git diff unrelated
 * to any code. The IDAT here always uses **stored (uncompressed) deflate blocks** — a
 * valid form of the deflate format that every decoder accepts, and whose output is fully
 * determined by the input.
 *
 * This trade-off differs from `zip.ts`'s, and the two reasons should not be conflated: on
 * that side, once stored is chosen compression is no longer a variable at all, and writing
 * it by hand buys something else (see the top of that file).
 *
 * The cost is that images are larger than compressed ones. Fixture images are only a few
 * KB, so it is a good trade.
 */

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const BIT_DEPTH_8 = 8;
const COLOR_TYPE_GRAYSCALE = 0;
const FILTER_NONE = 0;

/** IHDR's content length, fixed by the format. */
const IHDR_SIZE = 13;

/** Every chunk's frame: 4 bytes of length + 4 bytes of type + 4 bytes of CRC. */
const CHUNK_FRAME_SIZE = 12;
const CHUNK_TYPE_OFFSET = 4;
const CHUNK_DATA_OFFSET = 8;

/** A stored block's frame: 1 byte of BFINAL/BTYPE + LEN + NLEN. */
const STORED_BLOCK_HEADER_SIZE = 5;

/** A deflate stored block has a 16-bit length field. */
const MAX_STORED_BLOCK = 0xffff;

export interface GrayscaleImage {
  readonly width: number;
  readonly height: number;
  /** The greyscale value at `(x, y)`, 0–255. */
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

  // Each row is prefixed with a filter byte. Always None — filters exist to help
  // compression, and nothing is compressed here.
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

/** Wraps bytes into a zlib stream whose content is entirely deflate stored blocks. */
function zlibStored(data: Uint8Array): Uint8Array {
  // CMF 0x78 = deflate with a 32 KiB window. FLG 0x01 makes (CMF<<8 | FLG) divisible by
  // 31, which is the zlib header's check condition.
  const parts: Uint8Array[] = [Uint8Array.from([0x78, 0x01])];

  for (let offset = 0; offset < data.length || offset === 0; offset += MAX_STORED_BLOCK) {
    const length = Math.min(MAX_STORED_BLOCK, data.length - offset);
    const isFinal = offset + length >= data.length;
    const block = new Uint8Array(STORED_BLOCK_HEADER_SIZE + length);
    block[0] = isFinal ? 1 : 0; // BFINAL + BTYPE=00 (stored)
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
