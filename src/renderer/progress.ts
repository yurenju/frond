/**
 * Whole-book progress (a fraction) — a ratio from 0 to 1, for a draggable position
 * slider and for showing progress (user stories 23 and 24).
 *
 * ## Why characters rather than pages
 *
 * The page count changes with the viewport, the font size and the column count, so
 * "page 37 of 200" refers to a different position once the reader has adjusted the font
 * size. A character count does not — it is a property of the book, not of the layout. A
 * position slider therefore points at the same stretch of text before and after a font
 * size change.
 *
 * This is also why `RenderLocation` carries both `page`/`pageCount` and `fraction`: the
 * former is only meaningful **within this section and this layout**, while the latter
 * spans the whole book and is stable. CONTEXT.md's line "a CFI is exact but not
 * orderable by magnitude; a fraction is orderable but coarse" is about a third axis.
 *
 * ## Why there is a wait
 *
 * Counting characters means reading through every section's content once, and that is
 * I/O plus parsing. So the fraction has a "not usable yet" state (user story 25),
 * rather than handing out an approximation and quietly correcting it later — a slider
 * jumping from the wrong position to the right one looks like a bug.
 *
 * **This module does not touch the DOM**: the character counting itself is in
 * `renderer.ts`, and this only receives the numbers.
 */

/**
 * How many characters each section of a book has.
 *
 * Once built, the index never changes — it is a property of the book. So this class has
 * no mutators at all.
 */
export class ProgressIndex {
  /** The whole book's character count. */
  readonly characters: number;

  /** The characters in all preceding sections, before section i starts. One longer than the section count (the last slot is the total). */
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

  /** How many sections this book has. */
  get sectionCount(): number {
    return this.starts.length - 1;
  }

  /** How many characters section `sectionIndex` has. */
  charactersIn(sectionIndex: number): number {
    const start = this.starts[sectionIndex];
    const end = this.starts[sectionIndex + 1];
    if (start === undefined || end === undefined) return 0;
    return end - start;
  }

  /**
   * The whole-book progress at some position.
   *
   * A book with not a single character (all images) always has progress 0 — **not
   * NaN**. Dividing by zero does not throw here; it quietly feeds a NaN into the
   * position slider, and then the slider disappears.
   */
  fractionAt(sectionIndex: number, charactersIntoSection: number): number {
    if (this.characters === 0) return 0;

    const start = this.starts[sectionIndex] ?? 0;
    const within = clamp(charactersIntoSection, 0, this.charactersIn(sectionIndex));

    return clamp((start + within) / this.characters, 0, 1);
  }

  /**
   * Which section a progress value falls in, and at which character — the direction
   * needed when a dragged position slider is released.
   *
   * Landing exactly on a boundary counts as **the start of the later section** rather
   * than the end of the earlier one: a reader dragging the slider to 50% expects to see
   * "the halfway position", and the end of a section is, on screen, the last page of the
   * previous chapter. Empty sections (`empty-and-image-only-sections`) are never
   * selected, because their interval has length 0.
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
