import { describe, expect, test } from "vitest";
import {
  blockExtentOf,
  inlineExtentOf,
  pageAt,
  pageAxisFor,
  pageCountFor,
  pageMetrics,
  pageOffsetFor,
  resolveColumns,
  type PageMetrics,
} from "../../../src/renderer/geometry.ts";

/**
 * 分頁算術的單元測試。這一層是純函式，所以它落在測試金字塔底層（ADR-0009）——
 * 一條邊界條件不必開三家瀏覽器就問得出答案。
 *
 * 「欄沿行內軸溢出」這個前提本身不在這裡驗，那是瀏覽器的行為，由
 * `tests/browser/renderer/multicol-geometry.spec.ts` 在三家各釘一次。這裡驗的是
 * **接受那個前提之後的算術**。
 */

const VIEWPORT = { width: 800, height: 600 };

describe("分頁軸", () => {
  test("橫排的頁沿 x 推進，直排沿 y", () => {
    expect(pageAxisFor("horizontal-tb")).toBe("x");
    expect(pageAxisFor("vertical-rl")).toBe("y");
  });

  test("行內軸上的長度：橫排取寬度，直排取高度", () => {
    expect(inlineExtentOf("horizontal-tb", VIEWPORT)).toBe(800);
    expect(inlineExtentOf("vertical-rl", VIEWPORT)).toBe(600);
  });

  test("區塊軸與行內軸互補", () => {
    expect(blockExtentOf("horizontal-tb", VIEWPORT)).toBe(600);
    expect(blockExtentOf("vertical-rl", VIEWPORT)).toBe(800);
  });
});

describe("欄數", () => {
  test("直排一律單欄，即使讀者要兩欄", () => {
    // ADR-0003 的刻意簡化。讀者的偏好不是錯誤，只是此刻不適用——不丟錯。
    expect(resolveColumns("vertical-rl", 2, VIEWPORT)).toBe(1);
    expect(resolveColumns("vertical-rl", "auto", VIEWPORT)).toBe(1);
  });

  test("橫排依讀者指定", () => {
    expect(resolveColumns("horizontal-tb", 1, VIEWPORT)).toBe(1);
    expect(resolveColumns("horizontal-tb", 2, VIEWPORT)).toBe(2);
  });

  test("auto 依可用寬度決定，窄的時候給單欄", () => {
    expect(resolveColumns("horizontal-tb", "auto", { width: 1200, height: 600 })).toBe(2);
    expect(resolveColumns("horizontal-tb", "auto", { width: 480, height: 600 })).toBe(1);
  });

  test("auto 看的是行內軸而不是寬度本身——直排的行內軸是高度", () => {
    // 直排那條先被單欄規則收掉，所以這條問的是「auto 沒有把高度當寬度用」。
    // 一個 1200 高、480 寬的直排 viewport 若走到寬度判準會得到單欄；走到
    // 高度判準會得到雙欄。兩者都不對——直排的答案永遠是 1。
    expect(resolveColumns("vertical-rl", "auto", { width: 480, height: 1200 })).toBe(1);
  });
});

describe("欄的設定", () => {
  test("橫排單欄：欄寬等於可用寬度，頁距多一個欄距", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: VIEWPORT,
      columns: 1,
      gap: 40,
    });

    expect(metrics.axis).toBe("x");
    expect(metrics.inlineSize).toBe(800);
    expect(metrics.blockSize).toBe(600);
    expect(metrics.columnWidth).toBe(800);
    expect(metrics.columnCount).toBe(1);
    // 下一頁的第一欄落在一頁之後再隔一個欄距——那條縫在兩頁之間，讀者看不到。
    expect(metrics.stride).toBe(840);
  });

  test("直排單欄：欄寬取的是高度", () => {
    const metrics = pageMetrics({
      writingMode: "vertical-rl",
      viewport: VIEWPORT,
      columns: 1,
      gap: 40,
    });

    expect(metrics.axis).toBe("y");
    // 這一條是 spine 那句「直排欄寬必須剛好等於一個 viewer 高」的機器版本。
    // 若欄寬跟著寬度走，這裡會是 800，而畫面上會一屏疊出好幾頁。
    expect(metrics.inlineSize).toBe(600);
    expect(metrics.columnWidth).toBe(600);
    expect(metrics.blockSize).toBe(800);
    expect(metrics.stride).toBe(640);
  });

  test("橫排雙欄：兩欄加中間那條縫剛好填滿可用寬度", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 1000, height: 600 },
      columns: 2,
      gap: 40,
    });

    expect(metrics.columnWidth).toBe(480);
    expect(metrics.columnCount).toBe(2);
    expect(metrics.columnWidth * 2 + metrics.columnGap).toBe(metrics.inlineSize);
    // 頁距與單欄是同一個式子：雙欄時頁內那條縫剛好湊回來。
    expect(metrics.stride).toBe(1040);
  });

  test("分數尺寸一律取整——分數 DPI 下的頁距不能是分數", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 800.4, height: 600.6 },
      columns: 1,
      gap: 0,
    });

    expect(metrics.inlineSize).toBe(800);
    expect(metrics.blockSize).toBe(600);
    expect(metrics.columnWidth).toBe(800);
    expect(Number.isInteger(metrics.stride)).toBe(true);
  });

  test("極窄的 viewport 仍給得出可用的設定，不會出現 0 或負數", () => {
    const metrics = pageMetrics({
      writingMode: "horizontal-tb",
      viewport: { width: 10, height: 10 },
      columns: 2,
      gap: 40,
    });

    expect(metrics.inlineSize).toBeGreaterThan(0);
    expect(metrics.columnWidth).toBeGreaterThan(0);
  });
});

describe("頁數與頁的位置", () => {
  const metrics: PageMetrics = pageMetrics({
    writingMode: "horizontal-tb",
    viewport: VIEWPORT,
    columns: 1,
    gap: 40,
  });

  test("內容剛好一屏就是一頁", () => {
    expect(pageCountFor(metrics, metrics.inlineSize)).toBe(1);
  });

  test("空文件仍然是一頁，不是零頁", () => {
    // 零頁沒有任何消費端處理得了——頁碼會變成 1/0，翻頁的邊界判斷會全部翻掉。
    expect(pageCountFor(metrics, 0)).toBe(1);
  });

  test("三頁的內容總長換算回三頁", () => {
    // 三欄之間有兩條縫，所以總長是三個頁距少一個欄距。
    const extent = metrics.stride * 3 - metrics.columnGap;
    expect(pageCountFor(metrics, extent)).toBe(3);
  });

  test("多出零點幾個像素不會憑空多一頁", () => {
    // 分數 DPI 下最常見的那一格。無條件進位會回報一頁空白的第四頁。
    expect(pageCountFor(metrics, metrics.inlineSize + 0.4)).toBe(1);
    expect(pageCountFor(metrics, metrics.stride * 3 - metrics.columnGap + 0.4)).toBe(3);
  });

  test("頁的位置是頁距的整數倍", () => {
    expect(pageOffsetFor(metrics, 0)).toBe(0);
    expect(pageOffsetFor(metrics, 1)).toBe(840);
    expect(pageOffsetFor(metrics, 3)).toBe(2520);
  });

  test("捲動位置換算回頁碼，取最近的一頁", () => {
    expect(pageAt(metrics, 0)).toBe(0);
    expect(pageAt(metrics, 840)).toBe(1);
    // 瀏覽器把捲動位置調整了零點幾個像素——回報的頁碼不能因此退回上一頁。
    expect(pageAt(metrics, 839.6)).toBe(1);
    expect(pageAt(metrics, 840.4)).toBe(1);
  });

  test("頁碼與頁位置互為反函數", () => {
    for (let page = 0; page < 20; page += 1) {
      expect(pageAt(metrics, pageOffsetFor(metrics, page))).toBe(page);
    }
  });
});
