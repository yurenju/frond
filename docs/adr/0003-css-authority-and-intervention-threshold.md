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
| 書宣告 `font-family: serif`，Windows 直排標點缺字符 | 書（**除非讀者指名**，見〈修訂〉） | 宣告合法，壞的是平台字型。**每個字都還在**，只是不好看。讀者想改就用字型設定 |
| 書寫死 `font-size: 12px !important`，讀者調字級無效 | frond | 不是難看，是**讀者的能力被書擋掉** |
| 書寫死 `color: #000; background: #fff`，夜間模式失效 | frond | 同上 |
| 書寫死 `width: 800px`，手機上右半邊被裁掉 | frond | **內容看不到** |
| 書的行距太窄、字太小、排版醜 | 書 | frond 沒有意見 |

`serif` 缺標點字符與 `width: 800px` 的差別就是這條線：前者很醜但字都在，後者字不見了。

這個結論與 spine 目前的行為**相反**——spine 的 `vertical-layout.ts` `rewriteGenericFonts` 會主動把書的 `serif`/`sans-serif` 改寫成 CJK 字型堆疊。在 frond 裡這件事移出去，改由讀者的字型設定達成。

### 修訂（0.5.0）：讀者可以指名 generic family 解析成什麼

上面那一格的裁定**維持不變**，但它答的是「frond 自己要不要動手」。實際把 spine 接上來時發現，這個裁定底下少了一條路：讀者只有「整本換字型」（`fontFamily`）與「什麼都不做」兩個選擇，而**想留出版社字型的讀者無處可去**——直排書的標點會壞回去，而那正是 `rewriteGenericFonts` 當初存在的理由。

補上的是 `settings.genericFamilies`，理由是這件事**不屬於「frond 覆寫書」那一類**：

- `font-family: serif` **沒有指名任何字型**。它是書把選擇委派給平台，而 CJK 之下三家的答案各不相同（`docs/browser-quirks.md` #4），其中幾個沒有直排標點字形。補上書委派出去的那個決定，與覆寫書指名過的選擇是兩件事。
- 它落在權威順序的**最上層**：讀者設定是唯一有資格指名字型的一層（ADR-0004、`settings.ts` 的 `fontFamily`），而這一項只是同一層裡更精準的形式。
- 它與 `fontFamily` 的差別就是這條線：`fontFamily` 整本覆寫，這一項只碰書委派出去的部分，書**指名過**的字型一個字都不動。
- **預設不設，就一個字元都不代換**，所以正文那句「frond 不因為書醜就介入」仍然字面成立。清單上它是 `reader-blocked` + `onlyWhenReaderOverrides: true`——沒有讀者設定就沒有這一項。

`reader-blocked` 這個理由名稱是四種裡最接近的一個，但要誠實記下它與其他 `reader-blocked` 項的不同：其他幾項是書用 `!important` 蓋掉讀者，這一項是書留下的空白擋著讀者。不新增第五種理由是刻意的——`interventions.test.ts` 把那四種釘死，就是為了擋「再加一個聽起來很合理的理由」這條滑坡；為了一項而擴充理由的分類，代價大於它買到的精確度。

frond 介入的每一項都登記成封閉清單並寫在文件裡，加一項要說明理由。危險不在第一天而在第三十天：「反正已經覆寫 column-width 了，line-height 也順手調一下吧」，然後半年後沒人記得為什麼書的排版跟原作者設計的不一樣。

## 那份封閉清單在程式碼裡（#32）

清單本體是 `src/renderer/interventions.ts` 的 `INTERVENTIONS`，而不是這份文件裡的一段散文。理由是**文件會漂，測試不會**：`tests/node/renderer/interventions.test.ts` 拿它與一份寫死的期望集合比**集合相等**，任一側多一項或少一項都會紅。加一項介入因此一定會經過改那支測試那一步，而改它的人會讀到這裡的那段警告。這與 `single-ailment.test.ts` 守 ADR-0007 那張病症表是同一個形狀。

清單也在公開面上（`src/renderer/index.ts`）：frond 動了書的哪幾處是消費端有權知道的事實，不是實作細節。

### 四種理由，不是兩種

上面的正文說「只有兩種情況才成立」，但這一節的實例表其實用到四種。#32 實作時把它們分開命名，因為前兩種**真的覆寫了書**，後兩種沒有——混在一起會讓「frond 覆寫了幾件事」這個問題答不出來：

| 理由 | 覆寫了書嗎 | 依據 |
| --- | --- | --- |
| `content-unreadable` | 是 | 正文理由 1：溢出被裁、重疊、空白頁 |
| `reader-blocked` | 是 | 正文理由 2：書用 `!important` 蓋掉讀者的選擇 |
| `frond-own-layer` | 否 | 實例表第一列：書從未宣告 `column-width`，分頁用的 CSS 本來就屬於 frond |
| `syntax-translation` | 否 | 前綴那一列：瀏覽器沒有照書做，翻譯宣告不改變書的意圖 |

只有前兩種要對照門檻。而 `reader-blocked` 那幾項全部只在**讀者實際設過那一項**時才發生——沒有讀者設定就沒有東西被擋住，門檻就不成立。那條規則在清單上是一個欄位（`onlyWhenReaderOverrides`），也就有東西斷言得到。

### 讀者的字級要贏，光拿掉 `!important` 不夠

上面的〈Consequences〉點名了 inline `!important` 打不贏這件事。實作時撞到的是**第二層**：書只要在任何一個後代上寫了絕對字級（`p { font-size: 12px }`，連 `!important` 都不必），那一段就脫離了讀者設在根元素上的繼承鏈。

處置是把書的絕對 `font-size` 換算成 `rem`（`relativise-font-size`）。**這是清單裡唯一改變了書的宣告的值的一項**，其餘幾項都只補宣告或拿旗標。保留的是可以保留的那一半——字級之間的**比例**，標題仍然比正文大，比例一格不差；放棄的是絕對值，而那個意圖與 user story 42 直接衝突，本 ADR 已裁定讀者贏。

## 讀者設定（frond 必須提供的覆寫面）

frond 拒絕自己修，就有義務讓上層修得動。因此公開的樣式覆寫 API 不是加分項而是必要條件（foliate 正好沒有這個，其 README 與 spine 的 library 調查都記載 themes 需自組）。

字型（含 CJK 直排標點字型）、字級、行高、邊界、單欄／雙欄／自動（僅橫式）、主題（亮／暗／自訂前景背景）。

**明確不做**：對齊（左對齊／左右對齊）。**直排不支援多欄**——直排一律單欄，一欄等於一個 viewer 高。這是刻意的簡化假設，直排多欄會讓 paginator 幾何複雜度明顯上升。

## Consequences

**「讀者設定一定要贏」不是免費的。** 書可以寫 `font-size: 12px !important`，而外部 stylesheet 打不贏 inline `!important`。spine 就是因此讓 `zeroBodyPadding` 掛了一個永不 disconnect 的 MutationObserver 持續把值塞回去。frond 內部因此需要一套認真的 cascade 對抗機制，不是注入一段 CSS 就結束——這是 frond 相對 foliate 真正要多做的工程之一。
