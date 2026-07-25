# frond 擁有事實，spine 擁有政策

frond 負責「這本書在這個 viewport 下是什麼樣子、現在在哪裡」——解析、分頁、定位、直排幾何、資源解析、TOC href 解析。spine（或任何上層）負責「使用者怎麼操作它」——手勢、點擊分區、UI、同步。frond 只吐**事實**（`direction: 'rtl'`、`writingMode: 'vertical-rl'`、`fraction: 0.37`），不做任何互動決策。

這條線不是設計出來的，是 spine 在 epub.js 上流血流出來的。spine 的 `src/lib/` 有一半是在跟 library 打架的補丁，而每一個補丁都指向同一件事：責任該在 library 這邊，卻漏到了應用層。

| spine 的補丁 | 修的是什麼 |
| --- | --- |
| `vertical.ts` `detectVerticalBook` | epub.js 只讀 `<html>` 的 writing-mode，InDesign 書宣告在 `<body>` |
| `vertical.ts` `SCROLL_EPSILON = 4` | 分數 DPI 下 scrollTop 湊不滿，section 邊界永遠跨不過去 |
| `vertical-layout.ts` `verticalColumnCss` | column-width 必須等於一個 viewer 高且需 `Math.floor`，分數像素會讓分頁崩掉 |
| `vertical-layout.ts` `zeroBodyPadding` | 用 MutationObserver 持續對抗 epub.js 每次 relayout 塞回的 inline `!important` padding |
| `toc.ts` `resolveSpineHref` | nav href 把 `,` percent-encode 成 `%2c`，`spine.get` 對不到，點 TOC 靜默無反應 |
| `scrubber-epub.ts` `normalizeHref` | TOC href 的 `../` 前綴對不上 spine href |
| `navigator-port.ts` | 整檔存在的理由就是 epub.js 的 API 形狀不能直接用；`manager.container`、`manager.layout.delta` 全靠 `as unknown as` 穿透私有內部 |

最硬的旁證是 `resolveSpineHref` 與 `normalizeHref` ——「把 TOC href 解析到 spine section」這一件事，在同一個 repo 裡被獨立實作了兩次、解的還是不同病症、彼此不知道對方存在。這就是責任沒收進 library 的代價。上表所有項目都屬於 frond。

## Consequences

**`RenditionPort` 這個 interface 應該消失。** 它存在的唯一理由是「epub.js 的 API 不是我要的形狀，所以在外面再包一層」。frond 從第一天就長成上層要的形狀，就不需要這層轉接——**frond 自己就是那個 port**。`navigator-port.ts` 的 interface 可直接當作 frond 公開 API 的第一版草稿：它是被真實需求逼出來的，比白紙上的設計準。

**frond 必須自己提供 fake / in-memory 實作，並視為公開 API 的一部分。** `RenditionPort` 的另一半價值是「可用 fake 做單元測試」，這個好處不能隨著 port 消失而消失。上層測試 Navigator 這類純決策模組時，不該自己造假物。

**明確拒絕：frond 不吃手勢。** 直排時「往左滑 = 下一頁」看似 library 該知道的事，其實不是。frond 該說的是「這本書是 rtl」這個事實，上層該決定的是「所以左滑等於 next」這個政策。一旦 frond 開始吃 swipe/tap，它就得知道點擊分區、選字中不翻頁、連結優先——那些是產品決策，會把 frond 綁死在單一 UI 上。
