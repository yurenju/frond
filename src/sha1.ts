/**
 * SHA-1, doing exactly one thing: hashing bytes into 20 bytes.
 *
 * ## Why it is hand-written
 *
 * IDPF font obfuscation derives its key from the book's unique identifier, and the
 * first step of that derivation is SHA-1 (`src/epub/font-obfuscation.ts`). Neither
 * of the platform's ready-made routes works:
 *
 * - **WebCrypto (`crypto.subtle.digest`)** only exists in a secure context in the
 *   browser. A reader opened over `http://` gets `crypto.subtle === undefined`, and
 *   a book with obfuscated fonts renders as tofu from cover to cover — and frond
 *   does not get to decide which origin it is deployed on. It is also async, which
 *   would stain "take the bytes of a resource", a synchronous operation, into a
 *   Promise all the way down.
 * - **`node:crypto`** only exists in Node. `EpubBook` has to run on both sides
 *   (ADR-0005).
 *
 * The third benefit of writing it by hand is the same one that motivates the
 * hand-written CRC32 in `src/test-fixtures/zip.ts`: this project's correctness
 * should not depend on how some implementation behaves in some environment.
 *
 * **It is not encryption and serves no security requirement.** IDPF obfuscation is
 * a public algorithm whose key is written inside the book itself; the point is to
 * keep the font from being usable as a standalone file, not to keep it secret. So
 * nothing here needs (or should claim) constant time or any side-channel resistance.
 *
 * Correctness is pinned entry by entry against `node:crypto` in
 * `tests/node/sha1.test.ts` — that is an independent implementation, and only using
 * it as an oracle guards against the all-green illusion where the generator and the
 * library share one wrong hash and therefore agree with each other.
 *
 * ## Why it lives under src/ rather than in epub/ or test-fixtures/
 *
 * Both sides need it: the library de-obfuscates, the fixture generator **creates**
 * obfuscation (`epub.ts`). Putting it on either side would make the other depend
 * backwards, and it depends on nothing itself.
 */

/** SHA-1's initial state (FIPS 180-4). */
const INITIAL_STATE = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];

const BLOCK_SIZE = 64;
/** The tail has to fit one `0x80` plus eight bytes of length. */
const PADDING_OVERHEAD = 9;

export const SHA1_LENGTH = 20;

export function sha1(message: Uint8Array): Uint8Array {
  const blocks = Math.ceil((message.length + PADDING_OVERHEAD) / BLOCK_SIZE);
  const padded = new Uint8Array(blocks * BLOCK_SIZE);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  // The length counts **bits**, as a big-endian 64-bit value. The high half comes
  // from division rather than a shift: a shift's operands are coerced to 32 bits
  // first, so any input over 512 MB would compute the wrong value.
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
