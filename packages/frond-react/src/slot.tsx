/**
 * `asChild` 的實作——把一個零件該有的 props 交給消費端自己的元素去承接。
 *
 * ## 為什麼需要它
 *
 * 「unstyled」有兩個層次。第一個是不出樣式，那用 `className` 就解決了。第二個是
 * **不出元素**：消費端已經有自己的 `<Button>`（帶著自己的 focus ring、自己的
 * loading 狀態、自己的 design token），而 frond 的 `NextTrigger` 只想貢獻「按下去
 * 會翻頁」與「翻到底了就是 disabled」這兩件事。沒有 `asChild` 的話，消費端只能把
 * 自己的按鈕包在我們的 `<button>` 裡——巢狀的 button 是無效的 HTML，鍵盤與螢幕
 * 閱讀器都會壞掉。
 *
 * 所以這裡跟 Radix 走同一條路：`asChild` 打開時不渲染自己的元素，改成把 props
 * 併進唯一的那個 child。
 *
 * ## 合併規則
 *
 * child 的 props 贏過零件的 props，三種例外：
 *
 *   - `on*` 事件處理器兩邊都跑，**child 先**。零件那一邊是行為（翻頁），child 那
 *     一邊是消費端自己要做的事（收起選單）；哪一邊先跑都合理，跟 Radix 對齊可以
 *     少一個要記的差異。
 *   - `className` 串起來。兩邊都在描述外觀，覆寫掉任一邊都是丟資訊。
 *   - `style` 淺層合併，child 的鍵贏。
 *
 * ref 兩邊都接得到。
 */

import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  version,
  type ReactElement,
  type ReactNode,
} from "react";

type AnyProps = Record<string, unknown>;

/**
 * React 19 起 `ref` 是一個普通的 prop，`element.ref` 變成一個會印警告的相容
 * getter。18 則相反：`ref` 從來不在 props 裡。
 *
 * 兩邊都讀是不行的——在 19 上碰 `element.ref` 就會印那行警告，而那會出現在每一個
 * 用了 `asChild` 的消費端的 console 裡。所以在這裡分一次版，只讀對的那一邊。
 */
const RENDERS_REF_AS_PROP = Number.parseInt(version, 10) >= 19;

function childRefOf(element: ReactElement): unknown {
  return RENDERS_REF_AS_PROP
    ? (element.props as AnyProps)["ref"]
    : (element as unknown as AnyProps)["ref"];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assignRef(ref: unknown, node: unknown): void {
  if (typeof ref === "function") {
    // 刻意不回傳 ref callback 的回傳值。React 19 會把它當成 cleanup 函式，18 則
    // 直接忽略——兩邊語意不同的東西不要放進共用的路徑。
    (ref as (value: unknown) => void)(node);
    return;
  }
  if (isPlainObject(ref) && "current" in ref) {
    ref["current"] = node;
  }
}

function composeRefs(...refs: readonly unknown[]): (node: unknown) => void {
  return (node) => {
    for (const ref of refs) assignRef(ref, node);
  };
}

function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...slotProps };

  for (const [key, childValue] of Object.entries(childProps)) {
    const slotValue = slotProps[key];

    if (
      /^on[A-Z]/.test(key) &&
      typeof slotValue === "function" &&
      typeof childValue === "function"
    ) {
      merged[key] = (...args: readonly unknown[]) => {
        (childValue as (...a: readonly unknown[]) => void)(...args);
        (slotValue as (...a: readonly unknown[]) => void)(...args);
      };
      continue;
    }

    if (key === "className" && typeof slotValue === "string" && typeof childValue === "string") {
      merged[key] = `${slotValue} ${childValue}`;
      continue;
    }

    if (key === "style" && isPlainObject(slotValue) && isPlainObject(childValue)) {
      merged[key] = { ...slotValue, ...childValue };
      continue;
    }

    merged[key] = childValue;
  }

  return merged;
}

export interface SlotProps {
  readonly children?: ReactNode;
}

export const Slot = forwardRef<unknown, SlotProps & AnyProps>(function Slot(props, forwardedRef) {
  const { children, ...slotProps } = props;

  // `Children.only` 丟的錯訊息不錯，但它沒說是誰要求只能有一個 child。自己丟。
  if (!isValidElement(children)) {
    throw new Error(
      "asChild 要求剛好一個 React 元素當 child——收到的不是元素。" +
        "常見的原因是包了一層 fragment，或者 child 是一段文字。",
    );
  }
  if (Children.count(children) !== 1) {
    throw new Error(`asChild 要求剛好一個 React 元素當 child，收到 ${Children.count(children)} 個。`);
  }

  const child = children as ReactElement<AnyProps>;

  return cloneElement(child, {
    ...mergeProps(slotProps, child.props),
    ref: composeRefs(forwardedRef, childRefOf(child)),
  } as AnyProps);
});
