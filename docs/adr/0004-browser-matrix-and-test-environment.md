# 瀏覽器矩陣與測試環境

Chromium、Firefox、WebKit 三個 headless 瀏覽器**同級**：三家都跑全套測試（不變量、跨瀏覽器差分、agent 視覺判讀），任一紅燈即紅燈。不分 tier。

理由是成本與回報不對稱：多加一個 browser project 只是設定檔幾行，而 frond 存在的一半理由就是「別人沒把直排跨瀏覽器做好」，主動放棄任何一家等於放棄那個賣點。foliate 自身宣稱支援最新版 WebKitGTK / Firefox / Chromium（不含 Firefox ESR），frond 對齊此範圍。

由於 foliate 的 Firefox 直排狀態目前是**未知**（見 ADR-0001 的查證），frond 的測試套件跑起來的第一天就會實證回答這題——那是很有價值的第一個產出。

## 測試環境必須固定字型

**這不是優化，是跨瀏覽器差分策略的前提。** 分頁是字型的函數：同一段文字用不同字型排，斷行位置不同，斷頁位置跟著不同。三個 headless 環境若各自解析到不同的系統字型，比對出來的差異會 100% 是字型差異，真正的分頁 bug 被埋掉。CJK 因 fallback 鏈更長而更嚴重。

因此測試環境內建一組固定字型（Noto Serif CJK / Source Han 一類，且必須具備直排標點字符）。實務上這使「測試環境」等於一個 **Docker image**——那是唯一能保證字型一致的方式，也順帶決定了 CI 的執行形式。

### 差分要成立，字面必須由讀者設定指名（#4 修訂）

本節原本還要求「確保書的 `serif` / `sans-serif` 在測試中解析到它們」。**那一句做不到，已移除。**

[#4](https://github.com/yurenju/frond/issues/4) 實測：三家瀏覽器對 generic family 的 CJK 解析在**送進 fontconfig 之前**就分歧了，各家決定「拿什麼去問」的方式不同。Firefox 帶文件的 `lang` 去問，完全正確；WebKit 有問但不帶 `lang`，缺的那格由行程 locale 補；Chromium 根本沒問 fontconfig 要 generic family。量測、機制與圖見 `docs/browser-quirks.md`。

結果是同一本宣告 `serif` 的書，三家拿到三種字型（明體 JP／明體 TC／黑體），於是三種斷行、三種斷頁——**正是本節第一段說必須防止的那個失敗模式**。所以問題不是差分會有雜訊，是差分對這類書失去 oracle 的資格：真正的分頁 bug 會躲在那片紅色後面。

環境端補不回來。WebKit 的查詢裡從頭到尾沒有文件的 `lang`，唯一能動的是行程 locale，而那是全域值——沒辦法讓同一個行程裡的日文書與中文書各拿各的字面。Chromium 問的是一個具名的拉丁字型，可以綁架那個名字救回明體／黑體那一軸，但區域字面那一軸救不回來。

**因此差分的前提改為：跨瀏覽器自我差分必須在讀者設定指名字面的前提下執行。** 三家唯一會一致的情況就是指名字面，而在權威順序裡能合法指名的只有讀者設定（ADR-0003：frond 自己改寫書的宣告是被禁止的，那正是從 spine 移出去的 `rewriteGenericFonts`）。合成 fixture 一律指名字面（ADR-0007），差分在它們身上照常成立。

**代價要講清楚**：書宣告 generic family 而讀者沒有設定字型時，跨瀏覽器差分不成立，那類書的正確性只剩另外兩層守著——Node 端的解析測試，以及單一瀏覽器內的不變量與 agent 視覺判讀。而真書大多用 generic family 宣告，所以這不是邊緣情況。這是實質的覆蓋率損失，不是文字修飾。

## iOS 暫不處理

**Playwright 的 "WebKit" 不是 Safari，更不是 iOS Safari。** 它是跑在 Linux 上的 WebKit 建置，文字塑形走 HarfBuzz + Fontconfig；真 Safari 走 CoreText。直排 CJK 的排版恰恰最依賴這一層——標點位置、字符旋轉、行間都可能不同。而 spine 是 `display: standalone` 的 PWA，設計上要裝在手機，iOS 即 Safari。

現階段不投入 iOS 驗證（不進 CI、也不做人工 release checklist）。**代價必須明講：headless WebKit 綠燈不代表 iOS 沒問題**，在直排上落差還特別大。此處留檔是為了避免日後有人把 CI 綠燈誤讀為 iPhone 沒事。要補的時候，選項是雲端真機（BrowserStack 一類）或人工 checklist。
