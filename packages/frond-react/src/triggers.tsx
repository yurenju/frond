/**
 * 翻頁的兩個按鈕。
 *
 * ## 「上一頁／下一頁」是事實，「往左滑」才是政策
 *
 * 這兩個零件按下去呼叫 `previous()` 與 `next()`，而那是**閱讀順序**上的前後——與
 * 頁面推進方向、書寫方向都無關。一本 `rtl` 的直排書，「下一頁」仍然是下一頁，只是
 * 它畫在畫面的左邊。ADR-0002 拒絕的是 frond 去決定「往左滑等於下一頁」那一類事
 * 情，而不是拒絕承認閱讀順序有前後。
 *
 * 所以這兩個按鈕沒有違反那條線，`useSwipePaging()` 才在線的另一邊——它在
 * `paging.ts`，而且要顯式 import。
 *
 * ## 版面順序也是政策
 *
 * 這裡不決定哪一顆畫在左邊。`rtl` 的書通常要把「下一頁」放左邊，但那是消費端的
 * CSS——`Viewport` 的 `data-writing-mode` 與 `EpubBook.metadata.pageProgressionDirection`
 * 是判斷的依據，兩者都拿得到。
 */

import { forwardRef, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from "react";
import { dataAttr, useReader } from "./context.ts";
import { Slot } from "./slot.tsx";

export interface TriggerProps extends ComponentPropsWithoutRef<"button"> {
  /** 不渲染自己的 `<button>`，把 props 併進唯一的 child。見 `slot.tsx`。 */
  readonly asChild?: boolean;
}

/**
 * 建兩個只差在方向的零件。
 *
 * 抽出來不是為了省那十行，是為了讓「兩顆按鈕的行為完全對稱」變成程式碼結構保證的
 * 事——分開寫的話，日後只補其中一顆的那次修改不會有任何東西紅。
 */
function createTrigger(
  part: string,
  displayName: string,
  pick: (handle: ReturnType<typeof useReader>) => {
    readonly act: () => Promise<void>;
    readonly atBoundary: boolean;
  },
) {
  const Trigger = forwardRef<HTMLButtonElement, TriggerProps>(function Trigger(
    { asChild = false, onClick, disabled, ...rest },
    forwardedRef,
  ): ReactNode {
    const handle = useReader();
    const { act, atBoundary } = pick(handle);

    // 三種情況都是「現在按不了」：消費端自己說 disabled、還沒掛好、已經到底。
    const isDisabled = disabled === true || handle.renderer === undefined || atBoundary;

    const Component = asChild ? Slot : "button";

    return (
      <Component
        // `type="button"` 排在展開之前，消費端覆寫得掉。沒有它的話，這顆按鈕放進
        // 任何一個 `<form>` 裡都會變成 submit——那是原生 `<button>` 的預設值，而
        // 症狀是翻一頁整個頁面重新載入。
        type="button"
        {...rest}
        ref={forwardedRef}
        disabled={isDisabled}
        data-frond-part={part}
        data-disabled={dataAttr(isDisabled)}
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          if (event.defaultPrevented || isDisabled) return;
          void act();
        }}
      />
    );
  });

  Trigger.displayName = displayName;
  return Trigger;
}

export const NextTrigger = createTrigger("next-trigger", "NextTrigger", (handle) => ({
  act: handle.next,
  atBoundary: handle.location?.atEnd ?? false,
}));

export const PreviousTrigger = createTrigger("previous-trigger", "PreviousTrigger", (handle) => ({
  act: handle.previous,
  atBoundary: handle.location?.atStart ?? false,
}));
