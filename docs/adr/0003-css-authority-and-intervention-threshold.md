# CSS 權威的三層與 frond 的介入門檻

呈現上的權威分三層，優先順序固定：

```
讀者設定  >  frond 修正  >  書的宣告
```

預設忠實呈現書自己的宣告。frond **不因為書醜就介入**——只有兩種情況才主動修：

1. **內容讀不到**（溢出被裁、重疊、空白頁）
2. **讀者設定被書擋住**（書用 `!important` 蓋掉讀者的字級或顏色選擇）

書的排版不合口味、行距太窄、字型難看，都不是介入理由；那是讀者設定要解決的問題。

## 這條門檻怎麼用（實例）

| 狀況 | 誰贏 | 理由 |
| --- | --- | --- |
| 直排時 `column-width` 沒等於一個 viewer 高，一屏疊了三頁 | frond | 書從未宣告 `column-width`；multi-column 是 frond 拿來做分頁的工具，這層 CSS 本來就屬於 frond |
| `<body>` 被塞 inline `!important` padding，欄位邊界被推出畫面 | frond | 同上，library 自己造成的 |
| InDesign 書把 `writing-mode` 宣告在 `<body>` 而非 `<html>` | frond | 這不是覆寫書，是 frond **讀得不夠**——瀏覽器有照書做，只有 library 沒讀到 |
| 書把直排宣告成 `-epub-writing-mode`／`-webkit-writing-mode` 而沒有無前綴版本，Firefox 不認、整本排成橫排 | frond | **瀏覽器沒有照書做**，宣告被丟掉了。與上一格看起來相同但理由不同（上一格瀏覽器是照書做的），所以不要套用「frond 讀得不夠」那句話。把宣告翻譯成無前綴的等價寫法**不改變書的意圖**，改的只是語法。實測見 `docs/browser-quirks.md` |
| 書宣告 `font-family: serif`，Windows 直排標點缺字符 | 書 | 宣告合法，壞的是平台字型。**每個字都還在**，只是不好看。讀者想改就用字型設定 |
| 書寫死 `font-size: 12px !important`，讀者調字級無效 | frond | 不是難看，是**讀者的能力被書擋掉** |
| 書寫死 `color: #000; background: #fff`，夜間模式失效 | frond | 同上 |
| 書寫死 `width: 800px`，手機上右半邊被裁掉 | frond | **內容看不到** |
| 書的行距太窄、字太小、排版醜 | 書 | frond 沒有意見 |

`serif` 缺標點字符與 `width: 800px` 的差別就是這條線：前者很醜但字都在，後者字不見了。

這個結論與 spine 目前的行為**相反**——spine 的 `vertical-layout.ts` `rewriteGenericFonts` 會主動把書的 `serif`/`sans-serif` 改寫成 CJK 字型堆疊。在 frond 裡這件事移出去，改由讀者的字型設定達成。

frond 介入的每一項都登記成封閉清單並寫在文件裡，加一項要說明理由。危險不在第一天而在第三十天：「反正已經覆寫 column-width 了，line-height 也順手調一下吧」，然後半年後沒人記得為什麼書的排版跟原作者設計的不一樣。

## 讀者設定（frond 必須提供的覆寫面）

frond 拒絕自己修，就有義務讓上層修得動。因此公開的樣式覆寫 API 不是加分項而是必要條件（foliate 正好沒有這個，其 README 與 spine 的 library 調查都記載 themes 需自組）。

字型（含 CJK 直排標點字型）、字級、行高、邊界、單欄／雙欄／自動（僅橫式）、主題（亮／暗／自訂前景背景）。

**明確不做**：對齊（左對齊／左右對齊）。**直排不支援多欄**——直排一律單欄，一欄等於一個 viewer 高。這是刻意的簡化假設，直排多欄會讓 paginator 幾何複雜度明顯上升。

## Consequences

**「讀者設定一定要贏」不是免費的。** 書可以寫 `font-size: 12px !important`，而外部 stylesheet 打不贏 inline `!important`。spine 就是因此讓 `zeroBodyPadding` 掛了一個永不 disconnect 的 MutationObserver 持續把值塞回去。frond 內部因此需要一套認真的 cascade 對抗機制，不是注入一段 CSS 就結束——這是 frond 相對 foliate 真正要多做的工程之一。
