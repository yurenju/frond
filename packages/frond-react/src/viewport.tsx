/**
 * `Viewport`——書排在這個元素裡。
 *
 * ## 這是外觀的分界線，而且分得比看起來硬
 *
 * frond 把每一節渲染在一個 iframe 內（ADR-0006），所以**外面的 CSS 進不去**。這
 * 個元素能改的是它自己：多大、什麼形狀、什麼陰影、什麼圓角、旁邊留多少。書裡面的
 * 字級、行高、邊界、主題一律走 `Root` 的 `settings`——那條路上壓著 ADR-0003 的權威
 * 順序（讀者設定 > frond 修正 > 書的宣告），而繞過它就等於繞過那個順序。
 *
 * 這不是限制，是這個套件的形狀：`Viewport` 是一個**盒子**，不是一張紙。
 *
 * ## 尺寸要自己給
 *
 * 這裡不設任何寬高。`Renderer` 量的是這個元素的 box，而那個 box 是版面的產物——
 * grid item、`aspect-ratio`、`100dvh` 減去工具列，每一種都合理，我們挑哪一種都是
 * 在替消費端做版面決定。高度塌成 0 的時候畫面是空白的，那是這裡最常見的第一個
 * 問題，所以 `styles.css` 的預設樣式給了一組值。
 */

import {
  forwardRef,
  useCallback,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { dataAttr, useReaderInternals } from "./context.ts";
import { Slot } from "./slot.tsx";

export interface ViewportProps extends ComponentPropsWithoutRef<"div"> {
  /** 不渲染自己的 `<div>`，把 props 併進唯一的 child。見 `slot.tsx`。 */
  readonly asChild?: boolean;
}

export const Viewport = forwardRef<HTMLDivElement, ViewportProps>(function Viewport(
  { asChild = false, ...rest },
  forwardedRef,
): ReactNode {
  const { status, writingMode, location, setViewport } = useReaderInternals();

  /**
   * **identity 必須穩定。**
   *
   * ref callback 換一個新的函式，React 會先用 `null` 呼叫舊的、再用節點呼叫新的。
   * 寫成 inline 箭頭函式的話那是**每一次 render 都發生一次**，於是 `Root` 那邊
   * 收到的是一次 `setViewport(null)` 接一次 `setViewport(node)`。
   *
   * 那一對在同一個批次裡，最後的值與原本相同，所以 React 會 bail out——今天它剛好
   * 不會重掛書。但那條路的安全性建立在「兩次呼叫落在同一個批次」上，而那不是我們
   * 控制得了的事；沒落在同一批的那一刻，症狀是每次 render 都重建一次 iframe。
   *
   * `useCallback` 把那整條路關掉：ref 只在真的掛載與卸載時被呼叫。
   */
  const attachRef = useCallback(
    (node: HTMLDivElement | null) => {
      // 兩個人要這個節點：`Root`（拿去 `attach()`）與消費端自己的 ref。
      setViewport(node);
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef !== null) forwardedRef.current = node;
    },
    [setViewport, forwardedRef],
  );

  const Component = asChild ? Slot : "div";

  return (
    <Component
      {...rest}
      ref={attachRef}
      data-frond-part="viewport"
      data-state={status}
      // 書寫方向是**書排出來的結果**，不是設定——所以它只在這裡當屬性出現，沒有
      // 對應的 prop 可以設。橫排要雙欄、直排要單欄那種版面差異靠它掛 CSS。
      data-writing-mode={writingMode}
      data-at-start={dataAttr(location?.atStart)}
      data-at-end={dataAttr(location?.atEnd)}
    />
  );
});
