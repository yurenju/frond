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
    what: "在 documentElement 上寫分頁需要的每一條：writing-mode（跟著書實際排出來的方向，容器與內容才同軸）、column-width、column-count、column-gap、column-fill、inline-size、block-size、max-inline-size 與 max-block-size 解除、box-sizing、overflow",
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
    what: "把 documentElement 與 body 的 margin、padding、border 歸零，並把 body 的 block-size 放回 auto",
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
    what: "body 與 img／svg／video／table 加上 max-inline-size 與 max-block-size 的上限（區塊軸那一側是像素而不是百分比），並給 img／svg／video 一條不帶 !important 的 break-inside: avoid",
    reason: "content-unreadable",
    why: "書寫死 width: 800px 時小螢幕上右半邊被裁掉讀不到（ADR-0003 實例表）。放得下的時候這條是 no-op，所以它只在內容真的會被裁掉時才生效。區塊軸的上限必須是像素：`max-block-size: 100%` 要有確定的包含塊尺寸才解析得出來，而圖版外面那層 `height: auto` 的 div 讓它靜默地變成 no-op（layout.ts 有實測數字）",
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
    what: "注入讀者設定的 font-size、font-family、line-height、color 與 background-color，全部帶 !important",
    reason: "reader-blocked",
    why: "ADR-0003 要求 frond 提供覆寫面。只包含讀者實際設過的項目——沒設的欄位一個字都不注入",
    where: "src/renderer/settings.ts",
    onlyWhenReaderOverrides: true,
  },
  {
    id: "strip-scripted-content",
    what: "拿掉內容文件裡任何命名空間的 <script>、on* 事件屬性，以及巢狀的瀏覽環境（iframe／object／embed／frame）",
    reason: "frond-own-layer",
    why: "ADR-0006 明列 frond 不支援 EPUB scripted content，而且那是安全決策不是功能取捨。iframe 為了讓 parent 收得到事件必須帶 allow-scripts（WebKit bug 218086），於是 sandbox 擋不住書內的腳本——擋得住的只有這一步。巢狀的瀏覽環境會**繼承** parent 的 sandbox 旗標，而內容以 blob: 供給等於帶著消費端 app 的來源，所以漏掉它就等於整條防線沒有",
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
 * ## 已知的缺口
 *
 * 登記在這段註解裡而不是做成一個匯出的陣列：它沒有任何程式碼會讀，做成資料只是
 * 讓同一份說明存在兩個地方。
 *
 * 每一項都是「知道它在、也知道為什麼現在不做」，不是待辦清單。**理由分兩種，而
 * 分清楚很重要**：
 *
 * - **樣本裡沒有量到這個形狀**（第 1、2 項）。那些書上一次都沒出現的東西，先做等於
 *   照著規格而不是照著書實際的樣子寫（CONTEXT.md 的「範本書」）。這種缺口的正確
 *   處置是**等量到再說**——而底下的補記記著一次把這個判準用錯的教訓。
 * - **量到了，但要怎麼修是一個權衡決定**（第 3 項）。這種缺口不能用「沒量到」帶過，
 *   所以它額外要求：現況要有 fixture 與測試釘住，讓它變了有人知道。
 *
 * 1. **`font` 縮寫裡的絕對字級不換算成 `rem`。** 縮寫的值要拆開才知道哪一段是
 *    字級（`font: 12px/1.4 serif`），拆錯會把整條宣告寫壞，而寫壞比不換算更糟。
 *    `!important` 仍然拿得掉（`demote-important` 的範圍含 `font`），所以擋得住
 *    讀者的只剩「不帶 `!important` 的縮寫絕對字級」。
 *
 * 2. **`@import` 的 `layer()` 與 `supports()` 寫法不展開。** 兩者改變的是層疊的
 *    分層與條件，而 frond 展開 `@import` 的做法是把文字插進它原本的位置
 *    （`css.ts` 的 `inlineImports`）——插入重現不了分層。那一條 `@import` 原樣
 *    留著，也就仍然是非同步載入的。樣本裡一本都沒有。
 *
 * 3. **比一欄還高的表格，下半讀不到。** 這一項與其他缺口不同：**樣本裡量到了**
 *    （3 本共 9 節，最嚴重的一節被裁掉 2563px），而且 `cap-overflowing-boxes`
 *    對它是個 no-op——CSS 規定 `max-height` 對 `display: table` 是**下限**而不是
 *    上限，表格一律照內容長。而 **Firefox 不把表格切到相鄰的欄**（Chromium 與
 *    WebKit 都切），所以那些列伸出容器再被 `overflow: hidden` 裁掉；更糟的是不切
 *    欄等於內容不往行內軸延伸，於是**整節的頁數變成 1**，表格後面的東西一併讀
 *    不到。
 *
 *    不做的理由不是「沒量到」，是**這不是一個 bug 修正而是一個權衡決定**：剩下
 *    的路是把 `display: table` 換掉，換完每一列變成區塊、內容流進相鄰的欄、全部
 *    讀得到，代價是表格的對齊整個消失。「讀得到但對不齊」與「對得齊但一半看不
 *    到」哪個對讀者好，需要一張票去決定，而不是在一次修 bug 的過程裡順手挑一個。
 *
 *    現況由 fixture 加測試釘住（`table-taller-than-page`、
 *    `rendering.spec.ts` 的〈比一欄還高的表格〉），量測與三家對照見
 *    `docs/browser-quirks.md`。Firefox 開始切表格時那條測試會紅，屆時這一項就可以
 *    拿掉——換句話說這個缺口有可能不必動 frond 就自己消失，而那正是「釘住現況」
 *    要買到的東西。
 *
 * ## 補記：原本第 2、3 項已經不是缺口
 *
 * 「`@import` 的字串寫法不解析」與「`@import` 進來的樣式表非同步載入」曾經登記
 * 在這裡，判準是「樣本裡沒有量到這個形狀」。**那個判準當時就是錯的**——後來拿
 * 34 本書實際跑一趟渲染，四本（九歌112年散文選、創業投資聖經、原子習慣、
 * 大器可以晚成，同一條 Kadokawa／BookCreator 工具鏈）的內容文件只 `<link>` 一支
 * 純 `@import` 字串的聚合檔，於是整份樣式表消失、四本直排書全部排成橫排。
 *
 * 留著這段記錄是因為教訓不在那兩行本身：**「樣本裡沒有」是一個要去量的斷言，
 * 不是一個可以推得的結論。** 那次登記靠的是「字串寫法在 EPUB 裡少見」這個印象，
 * 而樣本裡它佔 12%。
 */

