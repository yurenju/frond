/**
 * 讀者設定——權威順序裡最高的那一層（ADR-0003：`讀者設定 > frond 修正 > 書的宣告`）。
 *
 * ADR-0003 說「frond 拒絕自己修，就有義務讓上層修得動」，所以這個覆寫面不是加分
 * 項而是必要條件。清單也是那份 ADR 訂的：字型、字級、行高、邊界、單欄／雙欄／
 * 自動（僅橫排）、主題。
 *
 * **明確不做對齊**（左對齊／左右對齊），ADR-0003 明列。
 *
 * ## 沒有設定就沒有介入
 *
 * 每一個欄位都可以是 `undefined`，而 `undefined` 與「設成書的預設值」是兩件不同
 * 的事：沒設的欄位，frond 一個字都不會覆寫，書自己的宣告原封不動（ADR-0003 的
 * 「書自己的字型與排版在我沒有主動調整時被完整保留」，user story 45）。
 *
 * 這條界線在 `overriddenProperties()` 上變成機器讀得懂的東西——它回答「該拿掉書
 * 的哪幾個 `!important`」，而答案只包含讀者真的設過的那幾項。
 */

import type { ColumnChoice, Margin } from "./geometry.ts";

/** 主題的前景與背景。任何 CSS 顏色值都可以。 */
export interface Theme {
  readonly foreground: string;
  readonly background: string;
}

export interface ReaderSettings {
  /**
   * 指名的字面。**指名而不是 generic family**：三家瀏覽器對 `serif` 的 CJK
   * 解析並不一致（#4），而讀者設定是權威順序裡唯一能合法指名的一層
   * （ADR-0004）。
   */
  readonly fontFamily: string | undefined;
  /** 字級，px。 */
  readonly fontSize: number | undefined;
  /** 行高，倍數（無單位）。 */
  readonly lineHeight: number | undefined;
  /**
   * 版面的邊界，px。純量是四邊等距，物件版依書寫方向分軸（`geometry.ts` 的
   * `Margin`）。
   *
   * 它**不是**注入書的 CSS，而是把 iframe 在容器裡縮進來——見
   * `section-view.ts`。邊界因此完全不經過書的層疊，也不必跟書的 `body` padding
   * 打架。
   */
  readonly margin: Margin;
  /** 欄數。直排一律單欄，設了也不生效（ADR-0003）。 */
  readonly columns: ColumnChoice;
  readonly theme: Theme | undefined;
}

/**
 * 什麼都沒設的讀者。
 *
 * 邊界是唯一有預設值的欄位——0 的話文字會貼著螢幕邊，那不是「書自己的宣告」，
 * 是 frond 沒有給版面。這個值屬於 frond 自己的那一層（ADR-0003 的第一列：
 * 分頁用的版面本來就屬於 frond）。
 */
export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: undefined,
  fontSize: undefined,
  lineHeight: undefined,
  margin: 24,
  columns: "auto",
  theme: undefined,
};

/** 套用一份局部設定。沒提到的欄位保持原樣。 */
export function withSettings(
  base: ReaderSettings,
  patch: Partial<ReaderSettings>,
): ReaderSettings {
  return { ...base, ...patch };
}

/**
 * 讀者實際覆寫了哪幾個 CSS 屬性。
 *
 * 這份集合是介入的**範圍**：只有落在裡面的屬性，才會把書宣告上的 `!important`
 * 拿掉（`css.ts` 的 `demoteImportant`）。讀者沒設字級時 `font-size` 不在裡面，
 * 書的 `font-size: 12px !important` 原樣留著——那是 ADR-0003 的門檻，不是疏漏。
 *
 * `font` 這個縮寫屬性只要三個字型相關設定有任何一個被覆寫就列進來：它一條就能
 * 同時寫死字級、行高與字面，留著 `!important` 等於留下一個繞道。
 */
export function overriddenProperties(
  settings: ReaderSettings,
): ReadonlySet<string> {
  const properties = new Set<string>();

  if (settings.fontSize !== undefined) properties.add("font-size");
  if (settings.fontFamily !== undefined) properties.add("font-family");
  if (settings.lineHeight !== undefined) properties.add("line-height");
  if (
    settings.fontSize !== undefined ||
    settings.fontFamily !== undefined ||
    settings.lineHeight !== undefined
  ) {
    properties.add("font");
  }

  if (settings.theme !== undefined) {
    properties.add("color");
    properties.add("background");
    properties.add("background-color");
    properties.add("background-image");
  }

  return properties;
}

/**
 * 讀者設定那份注入的樣式表。
 *
 * 每一條都帶 `!important`，而且**在書的 `!important` 被拿掉之後才有意義**——
 * 兩件事要一起做才贏得了（`css.ts` 的 `demoteImportant` 與 `relativiseFontSizes`）。
 * 只注入這一份的話，書的 `p { font-size: 12px !important }` 照樣贏，因為它的
 * 選擇器比較specific。
 *
 * ## 為什麼字級只設在根元素，其餘設在每一個元素上
 *
 * 字級要保留書自己的層次（標題比正文大），所以只設根元素，讓比例靠繼承與
 * `rem` 往下傳。字面、行高與顏色沒有這個顧慮——讀者說「用這個字面」就是整本都用，
 * 所以直接蓋到每一個元素上，書在後代元素上宣告的值才蓋不回來。
 */
export function readerStylesheet(settings: ReaderSettings): string {
  const rules: string[] = [];

  if (settings.fontSize !== undefined) {
    rules.push(`:root { font-size: ${settings.fontSize}px !important; }`);
  }

  const everything: string[] = [];
  if (settings.fontFamily !== undefined) {
    everything.push(`font-family: ${settings.fontFamily} !important;`);
  }
  if (settings.lineHeight !== undefined) {
    everything.push(`line-height: ${settings.lineHeight} !important;`);
  }
  if (settings.theme !== undefined) {
    everything.push(`color: ${settings.theme.foreground} !important;`);
  }
  if (everything.length > 0) {
    rules.push(`:root, :root * { ${everything.join(" ")} }`);
  }

  if (settings.theme !== undefined) {
    // 背景分兩條：底色只給根元素，其餘一律透明。
    //
    // 書把背景寫死在 `body` 或某個包裝 div 上是常態（`hardcoded-colors`），而
    // 那一塊白色會蓋在讀者的深色底上。全部設成讀者的底色也不對——那會讓書用
    // 底色區分的引文區塊消失。透明是唯一一個「讓底色透出來、又不假裝書沒有
    // 分區」的答案。
    //
    // 代價要講清楚：**設了主題就等於放棄書自己的配色**。那是主題這件事本身的
    // 代價，不是這裡的實作選擇——user story 43 要的正是它。
    rules.push(`:root { background-color: ${settings.theme.background} !important; }`);
    rules.push(`:root *:not(:root) { background-color: transparent !important; }`);
  }

  return rules.join("\n");
}
