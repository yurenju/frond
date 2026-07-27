/**
 * frond 自己那一層 CSS——分頁的機制本身。
 *
 * ADR-0003 的實例表第一列講的就是這裡：**書從未宣告 `column-width`，multi-column
 * 是 frond 拿來做分頁的工具，這層 CSS 本來就屬於 frond。** 所以這一支裡的每一條
 * 都帶 `!important` 而不必對照介入門檻——它們不是在覆寫書，是在鋪一層書沒有意見
 * 的地板。
 *
 * 唯一的例外是 `font-feature-settings`，理由寫在下面。
 *
 * 產生字串而不是直接操作 CSSOM，是為了讓它在 Node 裡測得起來（ADR-0009 的底層）。
 */

import type { PageMetrics, WritingMode } from "./geometry.ts";

/** 這份樣式表掛在哪個 `<style>` 上。換版面時整份換掉，不做增量修改。 */
export const LAYOUT_STYLE_ID = "frond-layout";

/** 讀者設定那份樣式表掛在哪個 `<style>` 上。 */
export const READER_STYLE_ID = "frond-reader";

export function layoutStylesheet(
  metrics: PageMetrics,
  writingMode: WritingMode,
): string {
  return [
    `:root {`,
    // 分頁容器的書寫方向必須跟著書走。
    //
    // 這不是覆寫書：書把 `writing-mode` 宣告在 `<body>` 上（InDesign 的形狀）
    // 時，`<html>` 仍然是橫排——而 `<html>` 是 frond 的分欄容器。容器橫排、
    // 內容直排的話，欄會沿著錯的軸排，畫面上是「字是直的但一屏疊了好幾頁」。
    // 這裡設的是 frond 自己那個盒子的方向，讓它與書實際排出來的方向一致。
    `  writing-mode: ${writingMode} !important;`,
    `  box-sizing: border-box !important;`,
    // 根元素的間距歸零。書在這裡留 padding 的話，欄的邊界會被推出畫面——
    // spine 為了對抗這件事掛了一個永不解除的 MutationObserver（ADR-0002）。
    // 讀者要的邊界由 iframe 在容器裡縮進來，不經過書的層疊。
    `  margin: 0 !important;`,
    `  padding: 0 !important;`,
    `  border: 0 !important;`,
    // 行內尺寸就是一頁的長度，而且是整數（geometry.ts）。寫死而不是用 100%，
    // 因為 100% 會跟著分數 DPI 的 viewport 變成分數，頁距就跟著變分數。
    `  inline-size: ${metrics.inlineSize}px !important;`,
    `  block-size: ${metrics.blockSize}px !important;`,
    `  max-inline-size: none !important;`,
    `  max-block-size: none !important;`,
    `  column-width: ${metrics.columnWidth}px !important;`,
    // 欄數與欄寬一起寫。只寫欄寬的話欄數由瀏覽器回推，而回推的結果在分數尺寸
    // 下不保證是我們算的那一個。
    `  column-count: ${metrics.columnCount} !important;`,
    `  column-gap: ${metrics.columnGap}px !important;`,
    // balance（預設值）會把內容平均攤到各欄，於是「一欄等於一頁」不再成立。
    `  column-fill: auto !important;`,
    // 溢出的欄變成可捲動的範圍，但讀者捲不動它——翻頁由 frond 控制，讀者的
    // 滑鼠滾輪把版面捲到半頁的位置會讓每一個位置的計算失去意義。
    `  overflow: hidden !important;`,
    `}`,
    ``,
    `:root > body {`,
    `  margin: 0 !important;`,
    `  padding: 0 !important;`,
    // 書寫死 `width: 800px` 時，小螢幕上右半邊被裁掉讀不到（ADR-0003 實例表）。
    // 放得下的時候這條是 no-op——它只在內容真的會被裁掉時才生效。
    `  max-inline-size: 100% !important;`,
    // 書寫 `height: 100%` 時，body 會撐成整個分欄容器的高度而把後面的內容擠掉。
    `  block-size: auto !important;`,
    `}`,
    ``,
    `:root img, :root svg, :root video, :root table {`,
    `  max-inline-size: 100% !important;`,
    `  max-block-size: 100% !important;`,
    `}`,
    ``,
    // 圖片被切成兩半跨在欄的邊界上是最刺眼的破版之一，而它在 DOM 斷言上完全
    // 看不出來。這一條不帶 !important：書自己要求圖片可以分割時，那是書的決定。
    `:root img, :root svg, :root video {`,
    `  break-inside: avoid;`,
    `}`,
    ...(writingMode === "vertical-rl" ? verticalRules() : []),
  ].join("\n");
}

/**
 * 直排才有的那幾條。
 *
 * `font-feature-settings: "vert" 1` **刻意不帶 `!important`**：它是把
 * `writing-mode` 已經蘊含的排版行為講給沒有照做的瀏覽器聽（WebKit 在直排下不
 * 自動套用 `vert`，日文句點留在左下——`docs/browser-quirks.md` 第一條），不是
 * 新增書沒有要求的效果。書自己宣告 `font-feature-settings` 時仍然是書贏。
 *
 * 三家共用同一條規則，不分支：實測強制之後 WebKit 移到右上，而 Chromium 與
 * Firefox 的結果**逐位元組不變**。分支要多一個「現在是哪一家」的判斷，而那個
 * 判斷會在瀏覽器修好之後變成沒有人記得要拿掉的東西。
 */
function verticalRules(): readonly string[] {
  return [
    ``,
    `:root {`,
    `  font-feature-settings: "vert" 1;`,
    `}`,
  ];
}
