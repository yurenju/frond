/**
 * 分頁的算術。**這一支不碰 DOM**——輸入是量到的尺寸，輸出是欄的設定與頁的位置。
 *
 * 提成純函式不是為了好看，是為了讓「一屏疊出好幾頁」這類缺陷有東西守得住。那種
 * 缺陷的成因全部在算術裡（欄寬套在錯的軸上、分數像素累積、頁數的取整方向），而
 * 算術在瀏覽器裡是最貴、最難重現的東西——留在 `section-view.ts` 裡的話，一條
 * 邊界條件要開三家瀏覽器才問得出答案。
 *
 * ## 欄沿行內軸溢出，`column-width` 量的是行內尺寸
 *
 * 這是整支的地基，而且是三家實測的（`tests/browser/renderer/multicol-geometry.spec.ts`）：
 *
 * | 書寫方向 | 行內軸 | `column-width` 量的是 | 頁往哪一軸推進 |
 * | --- | --- | --- | --- |
 * | `horizontal-tb` | 水平 | 寬度 | x |
 * | `vertical-rl` | 垂直（字由上而下） | **高度** | **y** |
 *
 * spine 踩過的「直排欄寬必須剛好等於一個 viewer 高」就是第二列，但那句話只給了
 * 結論——換一個 viewport 形狀之後該改哪個數字，要靠這張表才答得出來。
 *
 * ## 整數像素的紀律下在容器上，不是下在欄寬上
 *
 * spine 的補丁是對 `column-width` 取整（`Math.floor`），而真正該取整的是**容器
 * 的行內尺寸**。理由是 `column-width` 在規格裡只是一個建議值：欄數定下來之後，
 * 實際用的欄寬一律由容器尺寸回推。所以欄寬取了整而容器仍是分數的話，頁距
 * （`stride`）照樣是分數，翻幾十頁之後累積的誤差就變成一屏裡疊著兩個半頁。
 *
 * 這裡兩個都取整——容器取整是治本的那一個，欄寬取整讓單欄時的兩個數字對得起來。
 */

/** 書的書寫方向。frond v1 的直排一律 `vertical-rl`（CONTEXT.md）。 */
export type WritingMode = "horizontal-tb" | "vertical-rl";

/** 頁沿哪一條軸推進。 */
export type PageAxis = "x" | "y";

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** 讀者要幾欄。`"auto"` 只在橫排有意義（ADR-0003）。 */
export type ColumnChoice = 1 | 2 | "auto";

export interface ColumnRequest {
  readonly writingMode: WritingMode;
  /** 可用的版面大小，已扣掉讀者設定的邊界。 */
  readonly viewport: Viewport;
  readonly columns: 1 | 2;
  /** 欄距。它同時是相鄰兩頁之間那條看不見的縫。 */
  readonly gap: number;
}

/**
 * 一份文件的分欄設定與頁的幾何。
 *
 * `stride` 是這裡唯一需要記住的量：**相鄰兩頁在分頁軸上的距離**。它不等於
 * `inlineSize`——欄與欄之間隔著一個 `columnGap`，而那條縫落在兩頁之間，讀者
 * 看不到它。翻頁就是把捲動位置移動一個 `stride`。
 */
export interface PageMetrics {
  readonly axis: PageAxis;
  /** 容器在行內軸上的尺寸，也就是一頁看得到的長度。整數。 */
  readonly inlineSize: number;
  /** 容器在區塊軸上的尺寸。整數。 */
  readonly blockSize: number;
  readonly columnWidth: number;
  readonly columnGap: number;
  readonly columnCount: number;
  readonly stride: number;
}

/**
 * 分數像素的容忍量。
 *
 * 用在頁數的取整上：內容總長是量出來的，在分數 DPI 下最後一頁常常多出零點幾
 * 個像素，直接 `ceil` 會憑空多算一頁——而那一頁是空的。
 *
 * spine 的 `SCROLL_EPSILON = 4` 修的是同一類病，但它下在**翻頁的邊界判斷**上
 * （`scrollTop` 湊不滿於是跨不過 section 邊界）。frond 不需要那一個：頁的位置
 * 由 `stride` 的整數倍算出來，「翻到底了沒有」問的是頁碼而不是捲動座標，所以
 * 那條邊界根本不經過浮點數比較（`section-view.ts`）。
 */
const SUBPIXEL_TOLERANCE = 1;

/**
 * 雙欄的門檻。窄於這個寬度時 `"auto"` 給單欄——兩欄各剩不到 20 個西文字，
 * 行太短反而難讀。
 */
const TWO_COLUMN_MIN_INLINE_SIZE = 700;

export function pageAxisFor(writingMode: WritingMode): PageAxis {
  return writingMode === "vertical-rl" ? "y" : "x";
}

/** 行內軸上的可用長度：橫排是寬度，直排是高度。 */
export function inlineExtentOf(
  writingMode: WritingMode,
  viewport: Viewport,
): number {
  return writingMode === "vertical-rl" ? viewport.height : viewport.width;
}

/** 區塊軸上的可用長度——與 `inlineExtentOf` 互補的那一條。 */
export function blockExtentOf(
  writingMode: WritingMode,
  viewport: Viewport,
): number {
  return writingMode === "vertical-rl" ? viewport.width : viewport.height;
}

/**
 * 讀者要的欄數落到實際的欄數。
 *
 * **直排一律單欄**，不管讀者要什麼——ADR-0003 明列這是刻意的簡化假設，直排多欄
 * 會讓分頁幾何的複雜度明顯上升。讀者在直排書上把欄數設成 2 不是錯誤，是一個此刻
 * 不適用的偏好；照樣渲染成單欄，不丟錯。
 */
export function resolveColumns(
  writingMode: WritingMode,
  choice: ColumnChoice,
  viewport: Viewport,
): 1 | 2 {
  if (writingMode === "vertical-rl") return 1;
  if (choice !== "auto") return choice;
  return inlineExtentOf(writingMode, viewport) >= TWO_COLUMN_MIN_INLINE_SIZE
    ? 2
    : 1;
}

export function pageMetrics(request: ColumnRequest): PageMetrics {
  const { writingMode, viewport, columns, gap } = request;

  const inlineSize = Math.max(1, Math.floor(inlineExtentOf(writingMode, viewport)));
  const blockSize = Math.max(1, Math.floor(blockExtentOf(writingMode, viewport)));

  // 欄寬由容器回推，不是反過來——見檔頭〈整數像素的紀律下在容器上〉。
  const columnWidth = Math.max(
    1,
    Math.floor((inlineSize - gap * (columns - 1)) / columns),
  );

  return {
    axis: pageAxisFor(writingMode),
    inlineSize,
    blockSize,
    columnWidth,
    columnGap: gap,
    columnCount: columns,
    // 下一頁的第一欄起點落在 `inlineSize + gap`：一頁裝滿之後還隔著一個欄距。
    // 單欄與雙欄都是這個值——雙欄時頁內那一條縫也是 gap，剛好湊回同一個式子。
    stride: inlineSize + gap,
  };
}

/**
 * 內容總長換算成頁數。
 *
 * @param scrollExtent 文件在分頁軸上的總長（`scrollWidth` 或 `scrollHeight`）
 */
export function pageCountFor(metrics: PageMetrics, scrollExtent: number): number {
  return Math.max(
    1,
    Math.ceil((scrollExtent - SUBPIXEL_TOLERANCE) / metrics.stride),
  );
}

/** 第 `page` 頁（從 0 起算）在分頁軸上的捲動位置。 */
export function pageOffsetFor(metrics: PageMetrics, page: number): number {
  return page * metrics.stride;
}

/**
 * **捲動位置**落在第幾頁。
 *
 * 取最近的整數：捲動位置永遠是 `stride` 的整數倍（frond 自己設的），只是分數 DPI
 * 下瀏覽器會把它調整零點幾個像素。無條件捨去會讓「剛翻到第 3 頁」變成回報第 2 頁。
 */
export function pageAt(metrics: PageMetrics, offset: number): number {
  return Math.max(0, Math.round(offset / metrics.stride));
}

/**
 * **內容裡的某個位置**落在第幾頁。
 *
 * 與 `pageAt` 的差別是取整的方向，而那個差別不是細節：內容的位置落在一頁**裡面
 * 的任何地方**，不是 `stride` 的整數倍。取最近的整數會讓一頁的後半段被算成下一頁
 * ——症狀是「用 CFI 跳回剛才那一頁，落到了下一頁」，而且只有位置剛好偏後的時候才
 * 發生，所以看起來像隨機的。
 *
 * 容差往正向補一個像素，讓剛好落在頁首、卻被量成差零點幾個像素的字元算進這一頁
 * 而不是上一頁。
 */
export function pageContaining(metrics: PageMetrics, offset: number): number {
  return Math.max(
    0,
    Math.floor((offset + SUBPIXEL_TOLERANCE) / metrics.stride),
  );
}
