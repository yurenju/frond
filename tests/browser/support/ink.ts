import { PNG } from "pngjs";

/**
 * Pixel-level analysis tools.
 *
 * Why smoke tests need to look at pixels: a DOM assertion cannot see whether the right
 * glyph was picked. Full-width Han characters are mostly equal-width, so for the two
 * defect classes "picked the horizontal glyph instead of the vertical one" and "picked a
 * face from the wrong region", the computed style reports honestly and every geometric
 * invariant passes — only the drawn pixels are wrong.
 *
 * There is deliberately no golden-screenshot comparison here. frond has no reference
 * implementation to serve as an oracle, so an expected value for "this character should
 * look like this" does not exist, and inventing one as a golden only creates maintenance
 * burden. The assertions are made on structural properties — which quadrant the ink falls
 * in, whether two renders match — and those need no knowledge of the right answer.
 */

/** A pixel below this luminance counts as ink. The background is pure white and the text pure black, leaving the middle to antialiasing. */
const INK_LUMINANCE_THRESHOLD = 200;

export interface InkAnalysis {
  /** The number of inked pixels. 0 means the whole block is blank — usually that the character never rendered at all. */
  readonly pixelCount: number;
  /** The ink's centroid, normalized to [0, 1], with the origin at the top left. null when there is no ink. */
  readonly centroid: { readonly x: number; readonly y: number } | null;
}

export function analyseInk(png: Buffer): InkAnalysis {
  const image = PNG.sync.read(png);
  const { width, height, data } = image;

  let inkPixels = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = data[offset] ?? 0;
      const green = data[offset + 1] ?? 0;
      const blue = data[offset + 2] ?? 0;
      const alpha = data[offset + 3] ?? 0;

      if (alpha === 0) continue;

      // Rec. 601 luma — all that is needed here is a stable light/dark criterion, not colour
      // accuracy.
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
      if (luminance >= INK_LUMINANCE_THRESHOLD) continue;

      inkPixels += 1;
      weightedX += x;
      weightedY += y;
    }
  }

  return {
    pixelCount: inkPixels,
    centroid:
      inkPixels === 0
        ? null
        : {
            x: weightedX / inkPixels / width,
            y: weightedY / inkPixels / height,
          },
  };
}

/**
 * Decodes to raw RGBA bytes, for comparing two screenshots pixel by pixel.
 *
 * It compares decoded pixels rather than PNG bytes: a PNG's encoding may carry
 * differences unrelated to what is on screen (metadata, compression choices), and those
 * would give the wrong answer to "do these two renders match".
 */
export function decodePixels(png: Buffer): Buffer {
  return PNG.sync.read(png).data;
}
