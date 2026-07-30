import { describe, expect, test } from "vitest";
import { ProgressIndex } from "../../../src/renderer/progress.ts";

describe("the whole-book index", () => {
  const index = ProgressIndex.of([100, 300, 100]);

  test("the character count is the sum of the sections", () => {
    expect(index.characters).toBe(500);
    expect(index.sectionCount).toBe(3);
    expect(index.charactersIn(1)).toBe(300);
  });

  test("progress is \"the preceding sections' characters plus how far into this one\" over the total", () => {
    expect(index.fractionAt(0, 0)).toBe(0);
    expect(index.fractionAt(1, 0)).toBe(0.2);
    expect(index.fractionAt(1, 150)).toBe(0.5);
    expect(index.fractionAt(2, 100)).toBe(1);
  });

  test("out-of-range input is clamped, never giving progress below 0 or above 1", () => {
    expect(index.fractionAt(0, -50)).toBe(0);
    expect(index.fractionAt(1, 99_999)).toBe(0.8);
  });

  test("an out-of-range section index gives 0 rather than throwing", () => {
    // This path is reachable: the position can move while the index is still being built.
    expect(index.fractionAt(99, 0)).toBe(0);
    expect(index.charactersIn(99)).toBe(0);
  });
});

describe("recovering a position from a progress value", () => {
  const index = ProgressIndex.of([100, 300, 100]);

  test("landing in the middle of a section", () => {
    expect(index.locate(0.5)).toEqual({ sectionIndex: 1, charactersIntoSection: 150 });
  });

  test("landing on a boundary counts as the start of the later section", () => {
    // A reader dragging to 20% expects to see the start of section two, not the last page of
    // section one.
    expect(index.locate(0.2)).toEqual({ sectionIndex: 1, charactersIntoSection: 0 });
  });

  test("both ends are clamped", () => {
    expect(index.locate(-1)).toEqual({ sectionIndex: 0, charactersIntoSection: 0 });
    expect(index.locate(2)).toEqual({ sectionIndex: 2, charactersIntoSection: 100 });
  });

  test("progress and position are inverses of each other", () => {
    for (const fraction of [0, 0.1, 0.35, 0.5, 0.75, 1]) {
      const { sectionIndex, charactersIntoSection } = index.locate(fraction);
      expect(index.fractionAt(sectionIndex, charactersIntoSection)).toBeCloseTo(
        fraction,
        10,
      );
    }
  });

  test("an empty section is never selected — its interval has length 0", () => {
    // The `empty-and-image-only-sections` shape: a blank section in the middle.
    const withEmpty = ProgressIndex.of([100, 0, 100]);

    expect(withEmpty.locate(0.5).sectionIndex).toBe(2);
  });
});

describe("a book with not a single character", () => {
  const index = ProgressIndex.of([0, 0]);

  test("progress is 0 rather than NaN", () => {
    // Dividing by zero does not throw; it quietly feeds a NaN into the position slider, and
    // then the slider disappears.
    expect(index.fractionAt(0, 0)).toBe(0);
    expect(Number.isNaN(index.fractionAt(1, 0))).toBe(false);
  });

  test("recovering a position gives the start of the first section", () => {
    expect(index.locate(0.5)).toEqual({ sectionIndex: 0, charactersIntoSection: 0 });
  });
});

describe("a book with no sections at all", () => {
  const index = ProgressIndex.of([]);

  test("does not throw", () => {
    expect(index.characters).toBe(0);
    expect(index.sectionCount).toBe(0);
    expect(index.locate(0.5)).toEqual({ sectionIndex: 0, charactersIntoSection: 0 });
  });
});
