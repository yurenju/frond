import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { sha1 } from "../../packages/frond/src/sha1.ts";

/**
 * 手寫的 SHA-1 對 `node:crypto` 逐筆比對。
 *
 * oracle 必須是**獨立的實作**，這一點在這裡特別要緊：fixture 產生器製造混淆、
 * 函式庫解混淆，兩邊都用同一份 `sha1()`。雜湊若是錯的，兩邊會用同一把錯的金鑰
 * 互相抵消——「解出來等於原檔」照樣綠，然後實際的書在讀者手上是滿頁豆腐字。
 * 只有第三方的實作擋得住那種假象。
 *
 * `node:crypto` 只出現在測試裡。`EpubBook` 那一側零 Node 依賴（ADR-0005）。
 */

function expected(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

function digest(text: string): string {
  return [...sha1(new TextEncoder().encode(text))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("對 node:crypto 逐筆比對", () => {
  const INPUTS = [
    "",
    "a",
    "abc",
    // 55、56、64、119、120 這幾個長度剛好踩在補位的邊界上：56 起要多補一個
    // 區塊，64 是整區塊。手寫實作最典型的錯就落在這幾格。
    "x".repeat(55),
    "x".repeat(56),
    "x".repeat(63),
    "x".repeat(64),
    "x".repeat(65),
    "x".repeat(119),
    "x".repeat(120),
    "x".repeat(1000),
    // IDPF 的金鑰推導餵進去的就是這種字串。
    "urn:uuid:0c4f0b3a-2f5e-4d1a-9f6b-1a2b3c4d5e6f",
    "非 ASCII 的識別碼——UTF-8 編碼之後才雜湊",
  ];

  test.for(INPUTS)("長度 %#", (input: string) => {
    expect(digest(input)).toBe(expected(input));
  });
});

describe("回傳的形狀", () => {
  test("永遠是 20 個位元組", () => {
    expect(sha1(new Uint8Array(0))).toHaveLength(20);
    expect(sha1(new Uint8Array(1000))).toHaveLength(20);
  });
});
