/**
 * 全書進度（fraction）——0 到 1 的比例，供拖拉定位軸與進度顯示用
 * （user story 23、24）。
 *
 * ## 為什麼用字元數而不是頁數
 *
 * 頁數會隨 viewport、字級、欄數改變，所以「第 37 頁 / 共 200 頁」在讀者調完字級
 * 之後指的是另一個位置。字元數不會——它是書的性質，不是版面的性質。定位軸因此
 * 在調字級前後指向同一段文字。
 *
 * 這也是為什麼 `RenderLocation` 同時有 `page`／`pageCount` 與 `fraction`：前者
 * 只在**這一節、這個版面**裡有意義，後者跨整本書而且穩定。CONTEXT.md 那句
 * 「CFI 精確但不可比大小，fraction 可比大小但粗」講的是第三個軸。
 *
 * ## 為什麼要等
 *
 * 字元數要把每一節的內容都讀過一次才數得出來，而那是 I/O 加解析。所以 fraction
 * 有一個「還不能用」的狀態（user story 25），而不是先給一個近似值再偷偷改掉——
 * 定位軸從錯的位置跳到對的位置，看起來像 bug。
 *
 * **這一支不碰 DOM**：數字元的那一步在 `renderer.ts`，這裡只收數字。
 */

/**
 * 一本書每一節有多少字元。
 *
 * 索引一旦建好就不會變——它是書的性質。所以這個類別沒有任何 mutator。
 */
export class ProgressIndex {
  /** 全書字元數。 */
  readonly characters: number;

  /** 第 i 節開始之前，前面各節的字元數總和。長度比節數多一（最後一格是總數）。 */
  private readonly starts: readonly number[];

  private constructor(starts: readonly number[], characters: number) {
    this.starts = starts;
    this.characters = characters;
  }

  static of(perSection: readonly number[]): ProgressIndex {
    const starts: number[] = [0];
    let running = 0;

    for (const count of perSection) {
      running += Math.max(0, count);
      starts.push(running);
    }

    return new ProgressIndex(starts, running);
  }

  /** 這本書有幾節。 */
  get sectionCount(): number {
    return this.starts.length - 1;
  }

  /** 第 `sectionIndex` 節有多少字元。 */
  charactersIn(sectionIndex: number): number {
    const start = this.starts[sectionIndex];
    const end = this.starts[sectionIndex + 1];
    if (start === undefined || end === undefined) return 0;
    return end - start;
  }

  /**
   * 某個位置的全書進度。
   *
   * 一本一個字都沒有的書（整本都是圖）進度永遠是 0——**不是 NaN**。除以零在這裡
   * 不會丟錯，它會安靜地把一個 NaN 送進定位軸，然後定位軸消失。
   */
  fractionAt(sectionIndex: number, charactersIntoSection: number): number {
    if (this.characters === 0) return 0;

    const start = this.starts[sectionIndex] ?? 0;
    const within = clamp(charactersIntoSection, 0, this.charactersIn(sectionIndex));

    return clamp((start + within) / this.characters, 0, 1);
  }

  /**
   * 一個進度落在哪一節的第幾個字元——拖拉定位軸放開時要的那個方向。
   *
   * 落在兩節交界上時算**後面那一節的開頭**，而不是前一節的結尾：讀者把定位軸
   * 拖到 50% 時期待看到的是「一半的位置」，而一節的結尾在畫面上是上一章的最後
   * 一頁。空的節（`empty-and-image-only-sections`）不會被選中，因為它的區間長度
   * 是 0。
   */
  locate(fraction: number): { sectionIndex: number; charactersIntoSection: number } {
    if (this.sectionCount === 0) {
      return { sectionIndex: 0, charactersIntoSection: 0 };
    }
    if (this.characters === 0) {
      return { sectionIndex: 0, charactersIntoSection: 0 };
    }

    const target = clamp(fraction, 0, 1) * this.characters;

    for (let index = 0; index < this.sectionCount; index += 1) {
      const end = this.starts[index + 1]!;
      if (target < end) {
        return {
          sectionIndex: index,
          charactersIntoSection: target - this.starts[index]!,
        };
      }
    }

    const last = this.sectionCount - 1;
    return { sectionIndex: last, charactersIntoSection: this.charactersIn(last) };
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
