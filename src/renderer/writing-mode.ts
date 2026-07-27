/**
 * 書寫方向的偵測。
 *
 * **這件事歸 `Renderer` 不歸 `EpubBook`**（ADR-0010、#21）：它宣告在樣式表裡，
 * 判準需要 CSSOM，而 `EpubBook` 是零 DOM 的那一層。
 *
 * ## 為什麼不能用字串比對
 *
 * 三件實測到的事，每一件都足以讓字串比對漏掉一本書（`docs/browser-quirks.md`）：
 *
 * 1. **宣告可能在 `<body>` 上**，不在 `<html>` 上。InDesign 產的書就是這樣，而
 *    只讀 `documentElement` 的 library 會判成橫排（spine 踩過）。
 * 2. **冒號後面可以沒有空白**。《入境大廳》寫的是 `-epub-writing-mode:vertical-rl`，
 *    比對 `"writing-mode: vertical-rl"` 會漏掉整本書。
 * 3. **舊語法 `tb-rl` 三家都認**，而且 computed 值正規化成 `vertical-rl`。字串
 *    比對要自己認得每一種歷史寫法，CSSOM 不必。
 *
 * 前綴那一種（`-epub-` / `-webkit-`）**不在這裡處理**：Firefox 根本收不到那個
 * 宣告，所以它的 computed 值是橫排，讀 CSSOM 也讀不出來。那一格在文件還是文字的
 * 時候就補好了（`css.ts` 的 `normalisePrefixedWritingMode`），到這裡看到的已經是
 * 補過的文件。兩件事分開的理由見 ADR-0003 的實例表：一個是 frond 讀得不夠，
 * 一個是瀏覽器沒有照書做。
 */

import type { WritingMode } from "./geometry.ts";

export type WritingModeReading =
  | { readonly kind: "read"; readonly writingMode: WritingMode }
  /**
   * 讀不到。**不是「所以是橫排」**——見下。
   */
  | { readonly kind: "unreadable" };

/**
 * 從一份**已經顯示出來的**文件讀出書寫方向。
 *
 * ## 為什麼「讀不到」要與「橫排」分開
 *
 * Firefox 在 `display: none` 的 iframe 上回傳**空字串**而不是預設值
 * （`docs/browser-quirks.md` 已重現的第二條）。它不報錯，也不給一個看起來合理的
 * 錯答案——所以把空字串當成 `horizontal-tb` 的實作，症狀會是「直排書偶爾整本排
 * 成橫排」，而根因在一次讀取失敗，兩者離得很遠。
 *
 * **frond 的設計裡這個前提不出現**：它不預載隱藏的 iframe，讀書寫方向時那一份
 * 文件已經在畫面上了。所以 `unreadable` 是一條防禦而不是一條會走到的路徑——
 * `section-view.ts` 收到它就丟 `WritingModeUnreadableError`，讓它變成一個看得見
 * 的失敗。
 *
 * 分成兩格而不是回一個 `horizontal-tb` 了事，是因為那條路將來會被打開：預載下一
 * 節（隱藏的 iframe）是一個很自然的最佳化，而做那件事的人不會知道自己踩到了什麼。
 */
export function readWritingMode(document: Document): WritingModeReading {
  const view = document.defaultView;
  if (view === null) return { kind: "unreadable" };

  const root = document.documentElement;
  const rootMode = view.getComputedStyle(root).writingMode;
  const body = document.body;
  const bodyMode = body === null ? "" : view.getComputedStyle(body).writingMode;

  if (rootMode === "" && bodyMode === "") return { kind: "unreadable" };

  // **兩個都要看。** 宣告在 `<body>` 上的書（InDesign 的形狀），`<html>` 會維持
  // `horizontal-tb` 這個初始值——那是一個看起來很正常的答案，所以只讀
  // `documentElement` 的實作不會報錯，只會把整本直排書排成橫排。
  if (isVertical(bodyMode) || isVertical(rootMode)) {
    return { kind: "read", writingMode: "vertical-rl" };
  }

  return { kind: "read", writingMode: "horizontal-tb" };
}

/**
 * computed 值是不是直排。
 *
 * `vertical-rl` 與 `vertical-lr` 都算——**frond v1 一律當成 `vertical-rl` 排**
 * （CONTEXT.md：中日文的直排一律 `vertical-rl`）。`vertical-lr` 的書在樣本裡
 * 一本都沒有，而假裝支援它會讓分頁方向與實際排出來的方向相反，那比明確地當成
 * `vertical-rl` 更難查。真的遇到的時候要開一張票，不是在這裡多一個分支。
 *
 * `sideways-rl` / `sideways-lr` 同樣落在這一格。
 */
function isVertical(computed: string): boolean {
  return computed.startsWith("vertical") || computed.startsWith("sideways");
}
