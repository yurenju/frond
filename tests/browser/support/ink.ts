import { PNG } from "pngjs";

/**
 * 像素層的分析工具。
 *
 * 為什麼冒煙測試需要看像素：DOM 斷言看不出字形取對了沒有。全形漢字多半等寬，
 * 所以「取到橫排字符而不是直排字符」與「取到錯誤區域的字面」這兩類缺陷，
 * computed style 會老實回報、幾何不變量會全數通過，只有畫出來的像素是錯的。
 *
 * 這裡刻意不做 golden 截圖比對。frond 沒有參考實作可以當 oracle，「這個字應該
 * 長這樣」的期望值不存在，捏造成 golden 只會製造維護負擔。斷言下在結構性質上
 * ——墨水落在哪個象限、兩次渲染是否相同——那些性質不需要知道正確答案。
 */

/** 低於這個亮度的像素算是墨水。背景是純白，文字是純黑，中間留給抗鋸齒。 */
const INK_LUMINANCE_THRESHOLD = 200;

export interface InkAnalysis {
  /** 有墨水的像素數。0 代表整塊空白——通常意味著字根本沒渲染出來。 */
  readonly pixelCount: number;
  /** 墨水重心，正規化到 [0, 1]，原點在左上角。沒有墨水時為 null。 */
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

      // Rec. 601 luma——這裡只需要一個穩定的深淺判準，不需要色彩精確度。
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
 * 解碼成原始 RGBA 位元組，供兩張截圖的逐像素比對使用。
 *
 * 比的是解碼後的像素而不是 PNG 位元組：PNG 的編碼結果可能帶有與畫面無關的
 * 差異（中繼資料、壓縮選擇），那會讓「兩次渲染是否相同」這個問題答錯。
 */
export function decodePixels(png: Buffer): Buffer {
  return PNG.sync.read(png).data;
}
