import { createHash } from "node:crypto";

/**
 * A fingerprint of some bytes. Used for assertions like "are these two outputs exactly the
 * same" — comparing the arrays directly makes the failure message tens of thousands of
 * numbers, which shows nothing at all.
 */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
