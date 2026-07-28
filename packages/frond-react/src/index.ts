/**
 * `@yurenju/frond-react` 的公開面。
 *
 * ```tsx
 * import * as Reader from "@yurenju/frond-react";
 *
 * <Reader.Root book={book} settings={{ fontSize: 18 }}>
 *   <Reader.Viewport className="page" />
 *   <Reader.PreviousTrigger>前一頁</Reader.PreviousTrigger>
 *   <Reader.Progress className="bar" />
 *   <Reader.NextTrigger>下一頁</Reader.NextTrigger>
 * </Reader.Root>
 * ```
 *
 * ## 這一層是什麼、不是什麼
 *
 * **是**：`Renderer` 的生命週期接進 React（掛載、卸載、換書、換設定），以及把它的
 * 狀態變成可以掛 CSS 的 `data-*` 屬性。
 *
 * **不是**：frond 的第二套 API。`useReader().renderer` 直接把底下那個 `Renderer`
 * 交出去，因為 `rectsFor()`、`locate()` 這些與 React 無關的方法沒有理由在這裡再有
 * 一份鏡像——那份鏡像只會隨著 frond 的每一次擴充而落後。
 *
 * ## 樣式
 *
 * 每個零件都掛著 `data-frond-part="…"`，除此之外**一個樣式都沒有**。要外觀有兩條
 * 路，兩條可以混用：
 *
 *   1. 自己寫 CSS。`className` 一路傳到底層元素，`data-*` 屬性反映狀態。
 *   2. `import "@yurenju/frond-react/styles.css"` 拿一套堪用的預設值。它整份都在
 *      `:where()` 裡，優先權是 0，所以你的任何一條規則都蓋得過去。
 *
 * **書裡面的排版不走這裡。** 書渲染在 iframe 內（ADR-0006），外面的 CSS 進不去；
 * 字級、行高、邊界、主題一律走 `Root` 的 `settings`，那條路上壓著 ADR-0003 的權威
 * 順序。
 */

export { Root } from "./root.tsx";
export type { RootProps } from "./root.tsx";

export { Viewport } from "./viewport.tsx";
export type { ViewportProps } from "./viewport.tsx";

export { NextTrigger, PreviousTrigger } from "./triggers.tsx";
export type { TriggerProps } from "./triggers.tsx";

export { Progress } from "./progress.tsx";
export type { ProgressProps } from "./progress.tsx";

export { useReader } from "./context.ts";
export type { ReaderActions, ReaderHandle, ReaderState, ReaderStatus } from "./context.ts";

// 政策。顯式 import 才會生效——理由見 `paging.ts` 的檔頭。
export { useKeyboardPaging, useSwipePaging } from "./paging.ts";
export type {
  KeyboardPagingOptions,
  PagingDirection,
  PagingOptions,
  SwipePagingOptions,
} from "./paging.ts";

// `Slot` 也出去。`asChild` 是這個套件公開的能力，而消費端在自己的零件之間往下傳
// 那組 props 時需要同一份合併規則——手寫第二份的話，事件處理器被覆蓋掉而不是串接
// 這種錯會很難查。
export { Slot } from "./slot.tsx";
export type { SlotProps } from "./slot.tsx";
