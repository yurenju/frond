/**
 * `Root` 與其他零件之間那條線。
 *
 * ## 這裡放的是事實與動作，沒有政策
 *
 * ADR-0002 把事實劃給 frond、政策劃給消費端，而 `Renderer` 是那條線在核心層的落
 * 點：`next()` 是一個動作而不是一個事件處理器。這個 context 是同一條線在 React 層
 * 的落點——它把 `Renderer` 那些**必須靠著 React 的生命週期才拿得到**的東西（現在
 * 是哪一個 renderer、目前在哪一頁、掛好了沒）搬進 React 的資料流，動作則原樣轉出
 * 去，一個都不包成手勢。
 *
 * 手勢與鍵盤在 `paging.ts`，而且要顯式 import 才會生效。
 */

import { createContext, useContext } from "react";
import type {
  ReaderSettings,
  RenderLocation,
  Renderer,
  RendererErrorEvent,
  SectionAnchor,
  WritingMode,
} from "@yurenju/frond/renderer";

/**
 * 這個 reader 現在處於哪一格。
 *
 * `idle` 與 `loading` 是分開的兩格，不是一格。前者的意思是「還沒有東西可以掛」
 * （沒有給 `book`，或者 `Viewport` 還沒進 DOM），後者是「正在掛」。消費端對兩者的
 * 處置通常不同——前者該顯示「選一本書」，後者該顯示轉圈——而合成一格之後，那個
 * 區別要靠消費端自己去比對 props 才推得回來。
 */
export type ReaderStatus = "idle" | "loading" | "ready" | "error";

export interface ReaderState {
  /**
   * 底下那個 `Renderer`。還沒掛好時是 `undefined`。
   *
   * **公開它是刻意的。** 這一層包的是生命週期，不是 API 表面；`rectsFor()`、
   * `locate()` 這類與 React 無關的方法沒有理由再抄一次，抄了反而變成一份會跟著
   * frond 漂移的鏡像。
   */
  readonly renderer: Renderer | undefined;
  readonly status: ReaderStatus;
  /** 目前位置。第一次 `relocate` 之前是 `undefined`。 */
  readonly location: RenderLocation | undefined;
  /** 目前這一節排出來的書寫方向。**一本書的每一節不保證相同。** */
  readonly writingMode: WritingMode | undefined;
  /** 解析出來的完整讀者設定——`Renderer` 的權威值，不是傳進去的那份 patch。 */
  readonly settings: ReaderSettings | undefined;
  /** 最近一次渲染失敗。`status` 回到 `ready` 時不清掉，它是紀錄不是狀態。 */
  readonly failure: RendererErrorEvent | undefined;
}

/**
 * 動作。每一個都對應 `Renderer` 上同名的方法。
 *
 * 還沒掛好時全部是 no-op 而不是丟錯：這些東西會被接到按鈕上，而一個在載入中被按
 * 到的按鈕不該讓整棵樹爆掉。
 */
export interface ReaderActions {
  next(): Promise<void>;
  previous(): Promise<void>;
  goToSection(index: number, anchor?: SectionAnchor): Promise<void>;
  goTo(target: { readonly path: string; readonly fragment?: string | undefined }): Promise<void>;
  goToCfi(cfi: string): Promise<void>;
  goToFraction(fraction: number): Promise<void>;
  /**
   * 套一份讀者設定。
   *
   * `Root` 有 `settings` prop 的時候兩者會共存，而規則是「**prop 下一次變動時
   * 蓋過去**」：這裡設的值會一直有效，直到 `settings` prop 本身變成另一個值。
   * 換句話說，prop 是受控的那條路，這個方法是不受控的那條路，兩條都留著。
   */
  applySettings(patch: Partial<ReaderSettings>): Promise<void>;
}

export interface ReaderHandle extends ReaderState, ReaderActions {}

/** `Viewport` 用它把自己的元素交給 `Root`。不在公開面上。 */
export interface ReaderInternals {
  readonly setViewport: (element: HTMLElement | null) => void;
}

export const ReaderContext = createContext<(ReaderHandle & ReaderInternals) | undefined>(
  undefined,
);

/**
 * 讀 reader 的狀態與動作。必須在 `Root` 底下。
 *
 * 這是這個套件真正的公開面——五個零件都只是它加上一組 `data-*` 屬性。要畫一個
 * 這裡沒有提供的東西（自訂的定位軸、章名列、書籤按鈕）時走這條路，不必等我們
 * 多出一個零件。
 */
export function useReader(): ReaderHandle {
  return useReaderInternals();
}

/** 同一個值，但看得到 `ReaderInternals`。只給這個套件自己的零件用。 */
export function useReaderInternals(): ReaderHandle & ReaderInternals {
  const value = useContext(ReaderContext);
  if (value === undefined) {
    throw new Error("frond-react 的零件與 useReader() 必須用在 <Root> 底下。");
  }
  return value;
}

/** 屬性存在即為真——`data-disabled` 這種只看有沒有的屬性用它。 */
export function dataAttr(condition: boolean | undefined): "" | undefined {
  return condition === true ? "" : undefined;
}
