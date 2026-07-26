import { expect, test } from "@playwright/test";

/**
 * TEMPORARY（#12 的驗收證據，合併前移除）。
 *
 * AC 要求「故意讓測試紅一次，確認報告仍然上傳得到」——`if: ${{ !cancelled() }}`
 * 的用意就是失敗時也要有報告，而那正是最需要它的時候。這條斷言必定失敗，三個
 * project 各紅一次。
 */
test("TEMP #12：故意失敗，用來驗證失敗時報告仍然上傳得到", () => {
  expect(1).toBe(2);
});
