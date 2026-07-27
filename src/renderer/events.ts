/**
 * 有型別的事件（ADR-0005）。
 *
 * 刻意**不用 DOM 的 `EventTarget`**：`CustomEvent.detail` 在 TypeScript 裡是
 * `any`，而「不必對著 `any` 猜欄位」（user story 35）正是這個專案存在的一半理由。
 * 用自訂元素與 `CustomEvent` 會把那半個理由丟掉，ADR-0005 因此選了 class 加
 * typed emitter。
 *
 * `on()` 回傳解除訂閱的函式，而不是要求呼叫端記著同一個 listener 參考再 `off()`。
 * 後者在實務上最常見的錯法是傳一個新的箭頭函式進去解除，而那不會報錯——只會靜默
 * 地什麼都沒解除，然後 listener 隨著每一次重掛累積。
 */

/** 一個位置的完整描述。每一次 `relocate` 帶的就是它。 */
export interface RenderLocation {
  readonly sectionIndex: number;
  /** 這一節在壓縮檔內的路徑。 */
  readonly sectionPath: string;
  /** 這一節裡的第幾頁，從 0 起算。 */
  readonly page: number;
  /** 這一節共幾頁。**只在這一節內有意義**——全書頁數不是一個穩定的量。 */
  readonly pageCount: number;
  /** 目前位置的 CFI，已序列化成 `epubcfi(…)`。 */
  readonly cfi: string;
  /**
   * 全書進度，0 到 1。**整書索引建好之前是 `undefined`**（user story 25）——
   * 定位軸在那之前該停用，而不是拿一個錯的值畫上去。
   */
  readonly fraction: number | undefined;
  /** 已經在全書的第一頁。 */
  readonly atStart: boolean;
  /** 已經在全書的最後一頁。 */
  readonly atEnd: boolean;
}

export interface SectionLoadEvent {
  readonly sectionIndex: number;
  readonly sectionPath: string;
  /**
   * 這一節實際排出來的書寫方向。
   *
   * **一本書的每一節不保證相同**，所以它掛在這裡而不是掛在 `Renderer` 上。
   * 判準是 CSSOM 而不是字串比對（ADR-0010、docs/browser-quirks.md）。
   */
  readonly writingMode: "horizontal-tb" | "vertical-rl";
}

/** 整書索引建好了，`fraction` 從這一刻起有值。 */
export interface IndexedEvent {
  /** 全書的字元數。0 表示這本書一個字都沒有——那不是錯誤。 */
  readonly characters: number;
}

/**
 * 讀者按了內容裡的一個連結。
 *
 * frond **不自己跳**：翻頁、跳章屬於政策，由消費端決定（ADR-0002）。這裡給的是
 * 事實——那個連結指向書裡的哪一節、哪一個錨點。frond 唯一自己做的是擋下瀏覽器
 * 的預設行為，因為讓 iframe 自己導航過去會把整個渲染狀態丟掉。
 */
export interface LinkActivateEvent {
  /** 原樣照抄的 href。 */
  readonly href: string;
  /** 指向的那一節在 readingOrder 上的序號。指到書外時是 `undefined`。 */
  readonly sectionIndex: number | undefined;
  /** `#` 之後那一段，已解碼。 */
  readonly fragment: string | undefined;
  /** 解析後不在這本書裡（外部連結）時的絕對位址。 */
  readonly externalUrl: string | undefined;
}

export interface RendererErrorEvent {
  readonly sectionIndex: number;
  readonly sectionPath: string;
  readonly reason: RendererFailure;
  readonly message: string;
}

export type RendererFailure =
  /** 內容文件不是良構的 XML，瀏覽器整份拒絕渲染。 */
  | "malformed-content-document"
  /** 內容文件的位元組取不到。 */
  | "unreadable-section";

/**
 * 讀者選取的範圍變了（user story 48）。
 *
 * `cfi` 是一段**範圍**的 CFI，不是點——annotation 要存的就是它。取消選取時是
 * `undefined`，而不是不送事件：消費端要據此把浮動的工具列收起來，「沒有事件」
 * 表達不了那件事。
 */
export interface SelectionEvent {
  readonly cfi: string | undefined;
  /** 選取的文字。取消選取時是空字串。 */
  readonly text: string;
}

export interface RendererEvents {
  relocate: RenderLocation;
  selection: SelectionEvent;
  load: SectionLoadEvent;
  indexed: IndexedEvent;
  linkactivate: LinkActivateEvent;
  error: RendererErrorEvent;
}

export type Listener<Payload> = (event: Payload) => void;

/** 解除訂閱。呼叫兩次是安全的。 */
export type Unsubscribe = () => void;

/**
 * 型別參數的界線是 `object` 而不是 `Record<string, unknown>`。
 *
 * 後者看起來比較精確，實際上把 `interface` 全部擋在外面——interface 沒有索引
 * 簽章，所以連 `RendererEvents` 自己都通不過。改用 type alias 繞開只是把限制
 * 轉嫁給每一個定義事件的人。
 */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<Name extends keyof Events>(
    name: Name,
    listener: Listener<Events[Name]>,
  ): Unsubscribe {
    const existing = this.listeners.get(name) ?? new Set<Listener<never>>();
    existing.add(listener as Listener<never>);
    this.listeners.set(name, existing);

    return () => {
      existing.delete(listener as Listener<never>);
    };
  }

  emit<Name extends keyof Events>(name: Name, event: Events[Name]): void {
    // 先複製一份再走訪：listener 在自己的回呼裡解除訂閱是常見的寫法（一次性的
    // 監聽），而邊走訪邊改動同一個集合會漏掉後面的 listener。
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      (listener as Listener<Events[Name]>)(event);
    }
  }

  /** 全部解除。`Renderer.destroy()` 用它，避免拆掉之後還有事件送出去。 */
  clear(): void {
    this.listeners.clear();
  }
}
