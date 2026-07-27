/**
 * frond 對書的每一次介入，逐項登記——ADR-0003 要求的那份**封閉清單**。
 *
 * > frond 介入的每一項都登記成封閉清單並寫在文件裡，加一項要說明理由。危險不在
 * > 第一天而在第三十天：「反正已經覆寫 column-width 了，line-height 也順手調一下
 * > 吧」，然後半年後沒人記得為什麼書的排版跟原作者設計的不一樣。
 *
 * 所以這份清單放在程式碼裡而不是只放在文件裡：`interventions.test.ts` 比的是
 * **集合相等**，多一項少一項都會紅。文件會漂，測試不會。
 *
 * ## 四種理由，不是兩種
 *
 * ADR-0003 的正文說「只有兩種情況才成立」，但它的實例表其實用到四種。分清楚是有
 * 必要的：前兩種是**真的覆寫了書**，後兩種不是，而把它們混在一起會讓「frond 覆寫
 * 了幾件事」這個問題答不出來。
 *
 * | 理由 | 覆寫了書嗎 | ADR-0003 的依據 |
 * | --- | --- | --- |
 * | `content-unreadable` | 是 | 正文理由 1：溢出被裁、重疊、空白頁 |
 * | `reader-blocked` | 是 | 正文理由 2：書用 `!important` 蓋掉讀者的選擇 |
 * | `frond-own-layer` | 否 | 實例表第一列：書從未宣告 `column-width`，分頁用的 CSS 本來就屬於 frond |
 * | `syntax-translation` | 否 | 實例表的前綴那一列：瀏覽器沒有照書做，翻譯宣告不改變書的意圖 |
 *
 * 只有前兩種需要對照門檻。後兩種是「frond 在做自己的事」與「把書的意思照原樣講
 * 一次給聽不懂的瀏覽器聽」。
 */

export type InterventionReason =
  /** 內容讀不到——溢出被裁、重疊、空白頁。 */
  | "content-unreadable"
  /** 讀者設定被書擋住。 */
  | "reader-blocked"
  /** 分頁機制本身的 CSS，書從未宣告過這一層。 */
  | "frond-own-layer"
  /** 書的意圖不變，只換一種瀏覽器認得的寫法。 */
  | "syntax-translation";

export interface Intervention {
  readonly id: string;
  /** frond 做了什麼。 */
  readonly what: string;
  readonly reason: InterventionReason;
  /** 為什麼這一項過得了門檻。 */
  readonly why: string;
  /** 哪一支實作它。 */
  readonly where: string;
  /**
   * 只在讀者設了某一項時才發生嗎。
   *
   * `reader-blocked` 那幾項全部是 `true`——沒有讀者設定就沒有東西被擋住，門檻
   * 就不成立。這個欄位讓那條規則變成可以被斷言的東西。
   */
  readonly onlyWhenReaderOverrides: boolean;
}

export const INTERVENTIONS: readonly Intervention[] = [
  {
    id: "multicol-pagination",
    what: "在 documentElement 上寫 column-width／column-gap／column-fill／行內與區塊尺寸／overflow",
    reason: "frond-own-layer",
    why: "分頁是 frond 的職責，multi-column 是它的工具。書從未宣告過這一層，所以這不是覆寫（ADR-0003 實例表第一列）",
    where: "src/renderer/layout.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "integer-page-geometry",
    what: "容器的行內尺寸與欄寬一律取整數像素",
    reason: "frond-own-layer",
    why: "同上，這是分頁那一層的參數。分數尺寸會讓頁距累積誤差，症狀是一屏疊出好幾頁（spine 踩過）",
    where: "src/renderer/geometry.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "reset-root-box",
    what: "把 documentElement 與 body 的 margin／padding 歸零",
    reason: "frond-own-layer",
    why: "版面的邊界由 frond 在 iframe 外層給（讀者設定的 margin），書的根元素間距會把欄的邊界推出畫面——spine 為此掛了一個永不解除的 MutationObserver",
    where: "src/renderer/layout.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "unprefix-writing-mode",
    what: "-epub-／-webkit- 前綴的 writing-mode，補一條無前綴的等價宣告",
    reason: "syntax-translation",
    why: "Firefox 兩種前綴都不認，只寫前綴的書在它上面整本排成橫排。書的意圖沒有被改變，改的只是語法（ADR-0003 實例表、docs/browser-quirks.md）",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "column-break",
    what: "page-break-* 補一條 break-* 的等價宣告",
    reason: "syntax-translation",
    why: "page 這個斷點類型在分欄版面下不生效，書要求換頁的地方會接著排下去。補上 column 是把同一個意圖講成分欄版面聽得懂的話",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "vertical-punctuation",
    what: "直排時在 documentElement 上注入 font-feature-settings: \"vert\" 1",
    reason: "syntax-translation",
    why: "WebKit 在直排下不自動套用 vert，日文句點留在左下（docs/browser-quirks.md 第一條）。另外兩家自動套用，強制之後結果不變。這是把 writing-mode 已經蘊含的排版行為講給沒有照做的瀏覽器聽，不是新增書沒要求的效果——所以刻意**不帶 !important**，書自己宣告 font-feature-settings 時仍然是書贏",
    where: "src/renderer/layout.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "cap-overflowing-boxes",
    what: "body 與 img／svg／video／table 加上 max-inline-size: 100%",
    reason: "content-unreadable",
    why: "書寫死 width: 800px 時小螢幕上右半邊被裁掉讀不到（ADR-0003 實例表）。放得下的時候這條是 no-op，所以它只在內容真的會被裁掉時才生效",
    where: "src/renderer/layout.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "demote-important",
    what: "拿掉書在讀者覆寫過的那幾個屬性上的 !important（樣式表與 style 屬性都算）",
    reason: "reader-blocked",
    why: "外部樣式表打不贏書寫在 style 屬性裡的 !important——層疊規則裡沒有任何位置贏得了它。範圍嚴格限於讀者實際設過的屬性（settings.ts 的 overriddenProperties）",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: true,
  },
  {
    id: "relativise-font-size",
    what: "讀者設了字級時，把書的絕對 font-size 換算成 rem",
    reason: "reader-blocked",
    why: "光拿掉 !important 不夠：絕對值本身就讓那一段脫離繼承鏈，讀者調字級對它無效。換算保留書自己的字級**比例**，放棄的是絕對值——而那個意圖與 user story 42 直接衝突，ADR-0003 已裁定讀者贏",
    where: "src/renderer/css.ts",
    onlyWhenReaderOverrides: true,
  },
  {
    id: "reader-stylesheet",
    what: "注入讀者設定的字面／字級／行高／顏色，全部帶 !important",
    reason: "reader-blocked",
    why: "ADR-0003 要求 frond 提供覆寫面。只包含讀者實際設過的項目——沒設的欄位一個字都不注入",
    where: "src/renderer/settings.ts",
    onlyWhenReaderOverrides: true,
  },
  {
    id: "strip-scripted-content",
    what: "拿掉內容文件裡的 <script> 與 on* 事件屬性",
    reason: "frond-own-layer",
    why: "ADR-0006 明列 frond 不支援 EPUB scripted content，而且那是安全決策不是功能取捨。iframe 為了讓 parent 收得到事件必須帶 allow-scripts（WebKit bug 218086），於是 sandbox 擋不住書內的腳本——擋得住的只有這一步",
    where: "src/renderer/document-source.ts",
    onlyWhenReaderOverrides: false,
  },
  {
    id: "blob-urls",
    what: "把書內資源的引用改寫成 blob: 位址",
    reason: "frond-own-layer",
    why: "內容以同源 blob: 供給（ADR-0006），而 blob: 沒有目錄結構，書裡的相對路徑一律解析失敗。這是把同一個引用換一種寫法表達，指向的還是同一份資源",
    where: "src/renderer/document-source.ts",
    onlyWhenReaderOverrides: false,
  },
];

/**
 * 已知的缺口，登記在這裡而不是留白。
 *
 * 每一項都是「知道它在、也知道為什麼現在不做」，不是待辦清單。共同的判準是
 * **樣本裡沒有量到這個形狀**——那 33 本書上一次都沒出現的東西，先做等於照著規格
 * 而不是照著書實際的樣子寫（CONTEXT.md 的「範本書」）。
 *
 * 1. **`font` 縮寫裡的絕對字級不換算成 `rem`。** 縮寫的值要拆開才知道哪一段是
 *    字級（`font: 12px/1.4 serif`），拆錯會把整條宣告寫壞，而寫壞比不換算更糟。
 *    `!important` 仍然拿得掉（`demote-important` 的範圍含 `font`），所以擋得住
 *    讀者的只剩「不帶 `!important` 的縮寫絕對字級」。
 *
 * 2. **`@import "a.css"` 的字串寫法不解析。** 只認 `@import url(a.css)`。字串
 *    寫法在 EPUB 裡少見，而多一條解析路徑就多一種把樣式表改寫壞的方式。
 *
 * 3. **`@import` 進來的樣式表是非同步載入的。** 它會變成一個 `blob:` 的
 *    `@import`，而 frond 在 iframe 的 load 事件之後立刻量內容總長算頁數——樣式
 *    若還沒到位，量到的頁數是錯的。`<link>` 那一條已經靠內嵌解掉了
 *    （`document-source.ts`），`@import` 沒有：要解需要把它也遞迴內嵌進來，而
 *    那要處理循環與順序，代價與它出現的頻率不成比例。
 */
export const KNOWN_GAPS: readonly string[] = [
  "font 縮寫裡的絕對字級不換算成 rem",
  "@import 的字串寫法（@import \"a.css\"）不解析，只認 @import url(…)",
  "@import 進來的樣式表非同步載入，可能讓第一次量到的頁數偏低",
];
