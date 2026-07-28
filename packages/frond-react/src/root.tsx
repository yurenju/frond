/**
 * `Root`——擁有 `Renderer` 的生命週期，其餘什麼都不做。
 *
 * ## 它不渲染任何元素
 *
 * 連一個 `<div>` 都沒有。這是「unstyled」在版面這一格的意思：多一層 wrapper 就多
 * 一個消費端要對付的 box，而 flex/grid 的版面對「中間多一層」特別敏感（`Viewport`
 * 與工具列本來是同一個 grid 的兩個 item，中間插一層就不是了）。
 *
 * 代價是 `Root` 與 `Viewport` 之間要靠 context 傳一個 DOM 元素——`Viewport` 掛上
 * 去之後把自己的元素交回來，`Root` 收到才開始掛書。這也是為什麼狀態機有 `idle`
 * 這一格。
 *
 * ## 為什麼 listener 從 `attach()` 的參數進去，而不是掛好之後再 `on()`
 *
 * `attach()` 回傳時第一節已經排好了，也就是說那一次的 `load` 與 `relocate` 是在
 * `attach()` 裡面送出去的（`RendererOptions.on` 的註解）。事後補掛的話，消費端會
 * 漏掉整個開書序列裡最重要的那兩個事件，而症狀是「第一次進來畫面是空的，翻一頁
 * 之後就好了」。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Renderer,
  type IndexedEvent,
  type LinkActivateEvent,
  type ReaderSettings,
  type RenderLocation,
  type RenderableBook,
  type RendererErrorEvent,
  type RendererKeyEvent,
  type RendererListeners,
  type RendererPointerEvent,
  type RendererStart,
  type SectionAnchor,
  type SectionLoadEvent,
  type SelectionEvent,
  type WritingMode,
} from "@yurenju/frond/renderer";
import {
  ReaderContext,
  type ReaderHandle,
  type ReaderInternals,
  type ReaderStatus,
} from "./context.ts";

export interface RootProps {
  /**
   * 要渲染的書。`undefined` 表示還沒選書——`status` 停在 `idle`。
   *
   * 換一本書會**整個重掛**（舊的 `destroy()`、新的 `attach()`）。這件事沒有便宜
   * 的做法，而且也不該有：iframe、資源的 blob URL、整書索引全部綁在一本書上。
   */
  readonly book: RenderableBook | undefined;
  /**
   * 第一節要渲染哪裡。對應 `RendererOptions.start`。
   *
   * **只在掛載那一刻讀一次。** 之後改它不會跳位置——那是 `goToCfi()` 的工作。這
   * 個區別要說清楚：把 `start` 做成受控的話，任何一次讓 props 重算的 re-render
   * 都可能把讀者拉回某個舊位置，而那種 bug 從畫面上看起來像「翻頁偶爾會跳回去」。
   */
  readonly start?: RendererStart | undefined;
  /**
   * 讀者設定。變動時套用到目前這本書，**不重掛**。
   *
   * 比對是逐欄位的深層比對而不是 identity，所以直接寫一個物件字面量進來是可以的
   * ——不必為了避開重複套用而自己 `useMemo`。
   */
  readonly settings?: Partial<ReaderSettings> | undefined;

  readonly onRelocate?: ((event: RenderLocation) => void) | undefined;
  readonly onLoad?: ((event: SectionLoadEvent) => void) | undefined;
  readonly onIndexed?: ((event: IndexedEvent) => void) | undefined;
  readonly onSelection?: ((event: SelectionEvent) => void) | undefined;
  readonly onLinkActivate?: ((event: LinkActivateEvent) => void) | undefined;
  readonly onError?: ((event: RendererErrorEvent) => void) | undefined;
  readonly onPointerDown?: ((event: RendererPointerEvent) => void) | undefined;
  readonly onPointerUp?: ((event: RendererPointerEvent) => void) | undefined;
  readonly onKeyDown?: ((event: RendererKeyEvent) => void) | undefined;
  readonly onKeyUp?: ((event: RendererKeyEvent) => void) | undefined;

  readonly children?: ReactNode;
}

/** 一次 render 之間會變的那些狀態，收成一顆——省下五次連續的 setState。 */
interface Snapshot {
  readonly status: ReaderStatus;
  readonly location: RenderLocation | undefined;
  readonly writingMode: WritingMode | undefined;
  readonly settings: ReaderSettings | undefined;
  readonly failure: RendererErrorEvent | undefined;
}

const IDLE: Snapshot = {
  status: "idle",
  location: undefined,
  writingMode: undefined,
  settings: undefined,
  failure: undefined,
};

export function Root(props: RootProps): ReactNode {
  const { book, children } = props;

  const [viewport, setViewport] = useState<HTMLElement | null>(null);
  const [renderer, setRenderer] = useState<Renderer | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>(IDLE);

  // 事件處理器與 `start` / `settings` 從這裡讀，不進掛載那個 effect 的相依陣列。
  // 進去的話，消費端每寫一個箭頭函式當 handler 就會重掛一次書——而「重掛一次書」
  // 是 iframe 重建、字型重等、頁數重量，讀者看到的是畫面閃一下然後回到第一頁。
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  /** 上一次送進 `applySettings` 的那份 patch。受控那條路靠它擋掉重複套用。 */
  const appliedSettings = useRef<Partial<ReaderSettings> | undefined>(undefined);

  useEffect(() => {
    if (book === undefined || viewport === null) {
      setRenderer(undefined);
      setSnapshot(IDLE);
      return;
    }

    setSnapshot({ ...IDLE, status: "loading" });

    // `attach()` 是非同步的，而 StrictMode 會在它 resolve 之前就把 cleanup 跑掉。
    // 沒有這個旗標的話，那一次掛載的 iframe 會永遠留在 DOM 裡——沒有人持有它，
    // 也沒有人 destroy 它，而畫面上是兩本書疊在一起。
    let cancelled = false;
    let attached: Renderer | undefined;

    const listeners: RendererListeners = {
      relocate: (event) => {
        setSnapshot((current) => ({ ...current, location: event }));
        latest.current.onRelocate?.(event);
      },
      load: (event) => {
        setSnapshot((current) => ({
          ...current,
          writingMode: event.writingMode,
          // 前一節壞掉、這一節排出來了——`status` 該跟著回到 `ready`。
          // `failure` 不清：它是「發生過什麼」的紀錄，不是現在的狀態。
          status: current.status === "error" ? "ready" : current.status,
        }));
        latest.current.onLoad?.(event);
      },
      indexed: (event) => latest.current.onIndexed?.(event),
      selection: (event) => latest.current.onSelection?.(event),
      linkactivate: (event) => latest.current.onLinkActivate?.(event),
      error: (event) => {
        setSnapshot((current) => ({ ...current, status: "error", failure: event }));
        latest.current.onError?.(event);
      },
      pointerdown: (event) => latest.current.onPointerDown?.(event),
      pointerup: (event) => latest.current.onPointerUp?.(event),
      keydown: (event) => latest.current.onKeyDown?.(event),
      keyup: (event) => latest.current.onKeyUp?.(event),
    };

    const initialSettings = latest.current.settings;
    appliedSettings.current = initialSettings;

    void Renderer.attach(book, viewport, {
      on: listeners,
      settings: initialSettings ?? {},
      ...(latest.current.start === undefined ? {} : { start: latest.current.start }),
    }).then(
      (instance) => {
        if (cancelled) {
          instance.destroy();
          return;
        }
        attached = instance;
        setRenderer(instance);
        setSnapshot((current) => ({
          ...current,
          status: current.status === "error" ? "error" : "ready",
          location: instance.location,
          writingMode: instance.writingMode,
          settings: instance.settings,
        }));
      },
      (reason: unknown) => {
        if (cancelled) return;
        // `attach()` 整個失敗（相對於某一節渲染失敗）沒有 `error` 事件可收——
        // 那個事件的形狀綁在「哪一節壞了」上，而這裡連第一節都還沒掛上去。
        //
        // `reason` 借用 `unreadable-section`：`RendererFailure` 是 frond 的封閉
        // 清單，這一層沒有資格往裡面加一個成員。第 0 節取不到內容確實是它描述的
        // 那件事，而 `message` 帶著真正的原因。
        setSnapshot((current) => ({
          ...current,
          status: "error",
          failure: {
            sectionIndex: 0,
            sectionPath: "",
            reason: "unreadable-section",
            message: reason instanceof Error ? reason.message : String(reason),
          },
        }));
      },
    );

    return () => {
      cancelled = true;
      attached?.destroy();
      attached = undefined;
      setRenderer(undefined);
      setSnapshot(IDLE);
    };
  }, [book, viewport]);

  // 受控的讀者設定。相依陣列裡放的是 props.settings 的 identity，所以這個 effect
  // 幾乎每次 render 都會跑——真正擋住重複套用的是下面那次深層比對。
  const settingsProp = props.settings;
  useEffect(() => {
    if (renderer === undefined) return;
    if (sameSettings(appliedSettings.current, settingsProp)) return;

    appliedSettings.current = settingsProp;
    void renderer.applySettings(settingsProp ?? {}).then(() => {
      setSnapshot((current) => ({ ...current, settings: renderer.settings }));
    });
  }, [renderer, settingsProp]);

  const value = useMemo<ReaderHandle & ReaderInternals>(() => {
    const act = async (run: (instance: Renderer) => Promise<void>): Promise<void> => {
      if (renderer === undefined) return;
      await run(renderer);
    };

    return {
      renderer,
      status: snapshot.status,
      location: snapshot.location,
      writingMode: snapshot.writingMode,
      settings: snapshot.settings,
      failure: snapshot.failure,
      setViewport,

      next: () => act((instance) => instance.next()),
      previous: () => act((instance) => instance.previous()),
      goToSection: (index: number, anchor?: SectionAnchor) =>
        act((instance) =>
          anchor === undefined ? instance.goToSection(index) : instance.goToSection(index, anchor),
        ),
      goTo: (target) => act((instance) => instance.goTo(target)),
      goToCfi: (cfi: string) => act((instance) => instance.goToCfi(cfi)),
      goToFraction: (fraction: number) => act((instance) => instance.goToFraction(fraction)),
      applySettings: (patch: Partial<ReaderSettings>) =>
        act(async (instance) => {
          await instance.applySettings(patch);
          setSnapshot((current) => ({ ...current, settings: instance.settings }));
        }),
    };
  }, [renderer, snapshot]);

  return <ReaderContext.Provider value={value}>{children}</ReaderContext.Provider>;
}

/**
 * 兩份設定 patch 是不是同一件事。
 *
 * 比對而不是看 identity，是為了讓 `<Root settings={{ fontSize }} />` 這種寫法
 * 成立——那是每一個人第一次都會寫的寫法，而 identity 比對會讓它每次 render 都送
 * 一次 `applySettings`，也就是每次 render 都重排一次版面。
 *
 * 深度只到兩層是因為 `ReaderSettings` 就只有兩層（`margin` 與 `theme` 是物件，其
 * 餘是純量）。寫一個泛用的深層比對在這裡是多餘的，而且會讓「這個型別長什麼樣子」
 * 從程式碼裡消失。
 */
function sameSettings(
  a: Partial<ReaderSettings> | undefined,
  b: Partial<ReaderSettings> | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ReaderSettings>;
  for (const key of keys) {
    if (!sameValue(a[key], b[key])) return false;
  }
  return true;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  const entries = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of entries) {
    if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
  }
  return true;
}
