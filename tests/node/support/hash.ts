import { createHash } from "node:crypto";

/**
 * 位元組的指紋。用在「這兩份產出物完全一樣嗎」這種斷言上——直接比陣列時，
 * 失敗訊息會是幾萬個數字，看不出任何東西。
 */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
