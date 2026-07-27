/**
 * SHA-1，只做一件事：把位元組雜湊成 20 個位元組。
 *
 * ## 為什麼是手寫的
 *
 * IDPF 的字型混淆用書的 unique identifier 推金鑰，而推導的第一步是 SHA-1
 * （`src/epub/font-obfuscation.ts`）。平台上現成的兩條路都不能用：
 *
 * - **WebCrypto（`crypto.subtle.digest`）** 在瀏覽器裡只存在於 secure context。
 *   一個從 `http://` 開的閱讀器會拿到 `crypto.subtle === undefined`，於是一本
 *   帶混淆字型的書在那裡整本豆腐字——而部署在什麼 origin 上不是 frond 決定的。
 *   它還是非同步的，會把「取一份資源的位元組」這個同步動作整條染成 Promise。
 * - **`node:crypto`** 只有 Node 有。`EpubBook` 兩邊都要跑（ADR-0005）。
 *
 * 手寫的第三個好處與 `src/test-fixtures/zip.ts` 手寫 CRC32 的理由相同：這個
 * 專案的正確性不該依賴某個實作在某個環境下的行為。
 *
 * **它不是加密，也不服務任何安全需求。** IDPF 的混淆是公開演算法、金鑰就寫在書
 * 裡，目的是讓字型不被當成獨立檔案取用，不是保密。所以這裡不需要（也不應該
 * 宣稱）常數時間或任何抗側通道的性質。
 *
 * 正確性由 `tests/node/sha1.test.ts` 對 `node:crypto` 逐筆比對——那是一份獨立
 * 的實作，拿它當 oracle 才擋得住「產生器與函式庫用同一份錯的雜湊，於是兩邊剛好
 * 對得起來」那種全綠的假象。
 *
 * ## 為什麼放在 src/ 底下而不在 epub/ 或 test-fixtures/ 裡
 *
 * 兩邊都要用它：函式庫解混淆、fixture 產生器**製造**混淆（`epub.ts`）。放進
 * 任一側都會讓另一側反向依賴，而它自己不依賴任何東西。
 */

/** SHA-1 的初始狀態（FIPS 180-4）。 */
const INITIAL_STATE = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

const BLOCK_SIZE = 64;
/** 尾端要塞得下 1 個 `0x80` 與 8 個位元組的長度。 */
const PADDING_OVERHEAD = 9;

export const SHA1_LENGTH = 20;

export function sha1(message: Uint8Array): Uint8Array {
  const blocks = Math.ceil((message.length + PADDING_OVERHEAD) / BLOCK_SIZE);
  const padded = new Uint8Array(blocks * BLOCK_SIZE);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  // 長度以**位元**計，big-endian 的 64 位元。高位那半靠除法而不是位移：位移的
  // 運算元先被轉成 32 位元，超過 512 MB 的輸入就會算錯。
  view.setUint32(padded.length - 8, Math.floor(message.length / 0x20000000), false);
  view.setUint32(padded.length - 4, (message.length * 8) >>> 0, false);

  const state = [...INITIAL_STATE];
  const schedule = new Uint32Array(80);

  for (let block = 0; block < blocks; block += 1) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(block * BLOCK_SIZE + index * 4, false);
    }
    for (let index = 16; index < 80; index += 1) {
      schedule[index] = rotateLeft(
        schedule[index - 3]! ^
          schedule[index - 8]! ^
          schedule[index - 14]! ^
          schedule[index - 16]!,
        1,
      );
    }

    let [a, b, c, d, e] = state as [number, number, number, number, number];
    for (let index = 0; index < 80; index += 1) {
      const next =
        (rotateLeft(a, 5) + mix(index, b, c, d) + e + constantFor(index) + schedule[index]!) >>> 0;
      e = d;
      d = c;
      c = rotateLeft(b, 30);
      b = a;
      a = next;
    }

    for (const [index, value] of [a, b, c, d, e].entries()) {
      state[index] = (state[index]! + value) >>> 0;
    }
  }

  const digest = new Uint8Array(SHA1_LENGTH);
  const digestView = new DataView(digest.buffer);
  for (const [index, word] of state.entries()) {
    digestView.setUint32(index * 4, word, false);
  }
  return digest;
}

function mix(round: number, b: number, c: number, d: number): number {
  if (round < 20) return (b & c) | (~b & d);
  if (round < 40) return b ^ c ^ d;
  if (round < 60) return (b & c) | (b & d) | (c & d);
  return b ^ c ^ d;
}

function constantFor(round: number): number {
  if (round < 20) return 0x5a827999;
  if (round < 40) return 0x6ed9eba1;
  if (round < 60) return 0x8f1bbcdc;
  return 0xca62c1d6;
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}
