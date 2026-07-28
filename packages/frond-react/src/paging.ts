/**
 * 翻頁的**政策**：鍵盤與手勢。
 *
 * ## 這個檔案在 ADR-0002 那條線的哪一邊
 *
 * 在消費端那一邊——而它出現在這個套件裡，是因為 ADR-0002 劃的是「frond 核心不做政
 * 策」，不是「政策不准有預設值」。核心層的 `Renderer` 送的是兩個獨立的事實
 * （`pointerdown`、`pointerup`，各自帶座標），「這是一次往左滑，所以是下一頁」的
 * 推論在這裡完成。
 *
 * 所以規則是：**顯式 import 才會生效**。這兩個 hook 不在任何零件裡面，`Root` 也不
 * 會偷偷幫你叫。沒有叫它們的 reader 一個手勢都不吃，就跟直接用 `Renderer` 一樣。
 *
 * ```tsx
 * function Paging() {
 *   useKeyboardPaging();
 *   useSwipePaging();
 *   return null;
 * }
 * // <Root …><Paging /><Viewport /></Root>
 * ```
 *
 * 不同意這裡的規則就別叫它們，自己接 `useReader()` 的 `next()` / `previous()`。這
 * 兩個 hook 的實作短到可以整段抄走改——那也是它們刻意寫得直白的原因。
 *
 * ## 方向
 *
 * 「往左滑是下一頁還是上一頁」取決於頁面推進方向，而那個事實**這一層拿不到**：它
 * 宣告在封裝文件裡，由 `EpubBook.metadata.pageProgressionDirection` 回報，而
 * `Renderer` 收的是 `RenderableBook` 這個窄介面（ADR-0005）。
 *
 * 所以預設值從書寫方向推：直排一律當成 `rtl`，其餘當成 `ltr`。**橫排的 RTL 語言
 * （阿拉伯文、希伯來文）推不出來**——那種書要顯式傳 `direction: "rtl"`。這件事寫在
 * 這裡而不是靜靜猜錯，是因為猜錯的症狀是「翻頁方向整本反過來」，而讀者不會知道那
 * 是一個設定問題。
 */

import { useEffect } from "react";
import { useReader } from "./context.ts";

/** 頁面推進方向。與書寫方向是兩件事——見檔頭。 */
export type PagingDirection = "ltr" | "rtl";

export interface PagingOptions {
  /**
   * 頁面推進方向。省略時由書寫方向推：`vertical-rl` → `rtl`，其餘 → `ltr`。
   *
   * 有 `EpubBook` 在手的話，正確的來源是 `book.metadata.pageProgressionDirection`
   * ——它是書自己宣告的，EPUB 2 沒有這個屬性時它回報「書沒說」，那時候再退回這裡
   * 的推論。
   */
  readonly direction?: PagingDirection | undefined;
  /** 關掉。放在這裡而不是要求消費端有條件地叫 hook——hook 不能寫在條件裡。 */
  readonly enabled?: boolean | undefined;
}

export interface KeyboardPagingOptions extends PagingOptions {
  /**
   * 除了 iframe 內的按鍵，要不要也收整份文件的。
   *
   * 預設收。焦點在工具列的按鈕上時，按鍵根本不會進到 iframe，而讀者不會覺得
   * 「我剛剛點過那顆按鈕」是翻頁失效的理由。
   */
  readonly global?: boolean | undefined;
}

export interface SwipePagingOptions extends PagingOptions {
  /** 滑多少 px 才算一次翻頁。低於這個距離的當成點擊，不動作。 */
  readonly threshold?: number | undefined;
}

/** 按鍵的共同形狀——iframe 內的 `RendererKeyEvent` 與原生的 `KeyboardEvent` 都合。 */
interface KeyLike {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
}

/**
 * 鍵盤翻頁。
 *
 * 綁的鍵：
 *
 *   - **下一頁**：`PageDown`、`Space`、`ArrowDown`，以及朝閱讀方向前進的那個橫向
 *     箭頭（`ltr` 是 `ArrowRight`，`rtl` 是 `ArrowLeft`）
 *   - **上一頁**：`PageUp`、`ArrowUp`，以及反方向的那個橫向箭頭
 *
 * `ArrowDown` / `ArrowUp` 在直排書上看起來與視覺方向不符（直排的頁是左右移動的），
 * 但它們在兩種書寫方向下都保留成「下一頁 / 上一頁」——那是這兩個鍵在所有捲動介面
 * 上的意思，而讀者的手指記得的是那個意思，不是排版方向。
 */
export function useKeyboardPaging(options: KeyboardPagingOptions = {}): void {
  const { renderer, next, previous, writingMode } = useReader();
  const { enabled = true, global = true } = options;
  const direction = options.direction ?? (writingMode === "vertical-rl" ? "rtl" : "ltr");

  useEffect(() => {
    if (!enabled || renderer === undefined) return;

    const forwardArrow = direction === "rtl" ? "ArrowLeft" : "ArrowRight";
    const backwardArrow = direction === "rtl" ? "ArrowRight" : "ArrowLeft";

    const act = (event: KeyLike): boolean => {
      // 組合鍵一律讓開。`Cmd+ArrowRight` 是「跳到行尾」之類的系統手勢，攔下來只會
      // 讓人以為瀏覽器壞了。輸入法組字中（`isComposing`）同理。
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false;

      switch (event.key) {
        case "PageDown":
        case "ArrowDown":
        case forwardArrow:
          void next();
          return true;
        case " ":
          // Shift+Space 是往回，那是瀏覽器捲動的慣例。
          void (event.shiftKey ? previous() : next());
          return true;
        case "PageUp":
        case "ArrowUp":
        case backwardArrow:
          void previous();
          return true;
        default:
          return false;
      }
    };

    const unsubscribe = renderer.on("keydown", (event) => {
      act(event);
    });

    if (!global) return unsubscribe;

    const onDocumentKeyDown = (event: KeyboardEvent): void => {
      // 讀者正在打字（搜尋框、筆記）時不要翻頁。`isContentEditable` 涵蓋所見即所得
      // 的編輯器，前兩個涵蓋一般的表單控制項。
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (
          target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT"
        ) {
          return;
        }
      }

      // 處理掉才 preventDefault。沒攔的鍵要維持原本的行為，其中就包括 Tab。
      if (act(event)) event.preventDefault();
    };

    const view = window;
    view.addEventListener("keydown", onDocumentKeyDown);

    return () => {
      unsubscribe();
      view.removeEventListener("keydown", onDocumentKeyDown);
    };
  }, [renderer, next, previous, direction, enabled, global]);
}

/**
 * 滑動翻頁。
 *
 * 事實來自 `Renderer` 的 `pointerdown` / `pointerup`——iframe 的邊界擋住冒泡，那兩
 * 個事件是消費端唯一收得到書裡指標動作的管道（`events.ts` 的註解說明了為什麼 frond
 * 送的是原始的按下與放開，而不是一個算好的手勢）。
 *
 * 兩種情況不翻頁，因為讀者當下在做別的事：
 *
 *   - 起點落在**已經選取的文字**上——那是在調整選取範圍
 *   - 起點落在**連結**上——`linkactivate` 會接著送出來，翻頁會跟它打架
 */
export function useSwipePaging(options: SwipePagingOptions = {}): void {
  const { renderer, next, previous, writingMode } = useReader();
  const { enabled = true, threshold = 40 } = options;
  const direction = options.direction ?? (writingMode === "vertical-rl" ? "rtl" : "ltr");

  useEffect(() => {
    if (!enabled || renderer === undefined) return;

    let start: { x: number; y: number } | undefined;

    const unsubscribeDown = renderer.on("pointerdown", (event) => {
      start = event.hasSelection || event.isLink ? undefined : { x: event.x, y: event.y };
    });

    const unsubscribeUp = renderer.on("pointerup", (event) => {
      const from = start;
      start = undefined;
      if (from === undefined) return;

      const dx = event.x - from.x;
      const dy = event.y - from.y;

      // 主導軸決定這是橫滑還是直滑。兩軸都沒過門檻的話當成點擊——而點擊要不要翻頁
      // 是另一個政策，不在這個 hook 裡。
      if (Math.abs(dx) >= Math.abs(dy)) {
        if (Math.abs(dx) < threshold) return;
        // 往閱讀方向的**反向**滑，內容才會往前推進：ltr 的書往左滑是下一頁。
        const forward = direction === "rtl" ? dx > 0 : dx < 0;
        void (forward ? next() : previous());
        return;
      }

      if (Math.abs(dy) < threshold) return;
      void (dy < 0 ? next() : previous());
    });

    return () => {
      unsubscribeDown();
      unsubscribeUp();
    };
  }, [renderer, next, previous, direction, enabled, threshold]);
}
