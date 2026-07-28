/**
 * `Progress`——全書讀到哪了。
 *
 * ## 為什麼是唯讀的，不是一根可以拖的定位軸
 *
 * 拖曳定位需要的東西這個套件全都給得出來（`useReader().goToFraction()`），但**滑桿
 * 本身不該由我們出**：那是一個一般性的控制項，消費端多半已經有一個（自己的設計系
 * 統、Radix 的 `Slider`、或者就是 `<input type="range">`），而我們寫的那一個必然
 * 在鍵盤操作、觸控命中區、RTL 這幾件事上比不過。
 *
 * 所以這裡只出「顯示進度」這一格，拖曳留給消費端：
 *
 * ```tsx
 * const { location, goToFraction } = useReader();
 * <input type="range" min={0} max={1} step={0.001}
 *        value={location?.fraction ?? 0}
 *        disabled={location?.fraction === undefined}
 *        onChange={(e) => void goToFraction(e.currentTarget.valueAsNumber)} />
 * ```
 *
 * ## `fraction` 會有一段時間是 undefined
 *
 * 整書索引是 `attach()` 之後在背景建的（frond 的 user story 25），在那之前沒有全書
 * 進度可言。這裡把那一格畫成 `data-state="indeterminate"` 而不是 0——畫成 0 的話讀
 * 者看到的是「我在書的最前面」，而那是一句假話。
 */

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { useReader } from "./context.ts";
import { Slot } from "./slot.tsx";

export interface ProgressProps extends ComponentPropsWithoutRef<"div"> {
  /** 不渲染自己的 `<div>`，把 props 併進唯一的 child。見 `slot.tsx`。 */
  readonly asChild?: boolean;
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  { asChild = false, style, ...rest },
  forwardedRef,
): ReactNode {
  const { location } = useReader();
  const fraction = location?.fraction;

  const Component = asChild ? Slot : "div";

  return (
    <Component
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      {...(fraction === undefined ? {} : { "aria-valuenow": fraction })}
      {...rest}
      ref={forwardedRef}
      data-frond-part="progress"
      data-state={fraction === undefined ? "indeterminate" : "loaded"}
      style={{
        // 進度以 custom property 出去，而不是直接設 `width`。差別在於消費端因此
        // 可以決定它是一條長條、一個圓弧、一個 `scaleX`，還是根本不畫——設
        // `width` 的話我們就替它選了「長條」那一種。
        ...(fraction === undefined ? {} : { ["--frond-progress" as string]: String(fraction) }),
        ...style,
      }}
    />
  );
});
