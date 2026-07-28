import { describe, expect, test } from "vitest";
import { ProgressIndex } from "../../../packages/frond/src/renderer/progress.ts";

describe("整書索引", () => {
  const index = ProgressIndex.of([100, 300, 100]);

  test("字元數是各節的總和", () => {
    expect(index.characters).toBe(500);
    expect(index.sectionCount).toBe(3);
    expect(index.charactersIn(1)).toBe(300);
  });

  test("進度是「前面幾節的字數加上這一節走了多少」除以總數", () => {
    expect(index.fractionAt(0, 0)).toBe(0);
    expect(index.fractionAt(1, 0)).toBe(0.2);
    expect(index.fractionAt(1, 150)).toBe(0.5);
    expect(index.fractionAt(2, 100)).toBe(1);
  });

  test("超出範圍的輸入被夾回來，不會給出負數或大於 1 的進度", () => {
    expect(index.fractionAt(0, -50)).toBe(0);
    expect(index.fractionAt(1, 99_999)).toBe(0.8);
  });

  test("節的序號超出範圍時給 0，不丟錯", () => {
    // 這條路徑走得到：索引還在建的時候位置就可能先動了。
    expect(index.fractionAt(99, 0)).toBe(0);
    expect(index.charactersIn(99)).toBe(0);
  });
});

describe("由進度回推位置", () => {
  const index = ProgressIndex.of([100, 300, 100]);

  test("落在節的中間", () => {
    expect(index.locate(0.5)).toEqual({ sectionIndex: 1, charactersIntoSection: 150 });
  });

  test("落在交界上時算後面那一節的開頭", () => {
    // 讀者拖到 20% 要看到的是第二節的開頭，不是第一節的最後一頁。
    expect(index.locate(0.2)).toEqual({ sectionIndex: 1, charactersIntoSection: 0 });
  });

  test("兩端夾得住", () => {
    expect(index.locate(-1)).toEqual({ sectionIndex: 0, charactersIntoSection: 0 });
    expect(index.locate(2)).toEqual({ sectionIndex: 2, charactersIntoSection: 100 });
  });

  test("進度與位置互為反函數", () => {
    for (const fraction of [0, 0.1, 0.35, 0.5, 0.75, 1]) {
      const { sectionIndex, charactersIntoSection } = index.locate(fraction);
      expect(index.fractionAt(sectionIndex, charactersIntoSection)).toBeCloseTo(
        fraction,
        10,
      );
    }
  });

  test("空的節不會被選中——它的區間長度是 0", () => {
    // `empty-and-image-only-sections` 的形狀：中間夾一節空白。
    const withEmpty = ProgressIndex.of([100, 0, 100]);

    expect(withEmpty.locate(0.5).sectionIndex).toBe(2);
  });
});

describe("一個字都沒有的書", () => {
  const index = ProgressIndex.of([0, 0]);

  test("進度是 0 而不是 NaN", () => {
    // 除以零不會丟錯，它會安靜地把 NaN 送進定位軸，然後定位軸消失。
    expect(index.fractionAt(0, 0)).toBe(0);
    expect(Number.isNaN(index.fractionAt(1, 0))).toBe(false);
  });

  test("回推位置給第一節的開頭", () => {
    expect(index.locate(0.5)).toEqual({ sectionIndex: 0, charactersIntoSection: 0 });
  });
});

describe("沒有任何一節的書", () => {
  const index = ProgressIndex.of([]);

  test("不丟錯", () => {
    expect(index.characters).toBe(0);
    expect(index.sectionCount).toBe(0);
    expect(index.locate(0.5)).toEqual({ sectionIndex: 0, charactersIntoSection: 0 });
  });
});
