# 瀏覽器矩陣與測試環境

Chromium、Firefox、WebKit 三個 headless 瀏覽器**同級**：三家都跑全套測試（不變量、跨瀏覽器差分、agent 視覺判讀），任一紅燈即紅燈。不分 tier。

理由是成本與回報不對稱：多加一個 browser project 只是設定檔幾行，而 frond 存在的一半理由就是「別人沒把直排跨瀏覽器做好」，主動放棄任何一家等於放棄那個賣點。foliate 自身宣稱支援最新版 WebKitGTK / Firefox / Chromium（不含 Firefox ESR），frond 對齊此範圍。

由於 foliate 的 Firefox 直排狀態目前是**未知**（見 ADR-0001 的查證），frond 的測試套件跑起來的第一天就會實證回答這題——那是很有價值的第一個產出。

## 測試環境必須固定字型

**這不是優化，是跨瀏覽器差分策略的前提。** 分頁是字型的函數：同一段文字用不同字型排，斷行位置不同，斷頁位置跟著不同。三個 headless 環境若各自解析到不同的系統字型，比對出來的差異會 100% 是字型差異，真正的分頁 bug 被埋掉。CJK 因 fallback 鏈更長而更嚴重。

因此測試環境內建一組固定字型（Noto Serif CJK / Source Han 一類，且必須具備直排標點字符），並確保書的 `serif` / `sans-serif` 在測試中解析到它們。實務上這使「測試環境」等於一個 **Docker image**——那是唯一能保證字型一致的方式，也順帶決定了 CI 的執行形式。

## iOS 暫不處理

**Playwright 的 "WebKit" 不是 Safari，更不是 iOS Safari。** 它是跑在 Linux 上的 WebKit 建置，文字塑形走 HarfBuzz + Fontconfig；真 Safari 走 CoreText。直排 CJK 的排版恰恰最依賴這一層——標點位置、字符旋轉、行間都可能不同。而 spine 是 `display: standalone` 的 PWA，設計上要裝在手機，iOS 即 Safari。

現階段不投入 iOS 驗證（不進 CI、也不做人工 release checklist）。**代價必須明講：headless WebKit 綠燈不代表 iOS 沒問題**，在直排上落差還特別大。此處留檔是為了避免日後有人把 CI 綠燈誤讀為 iPhone 沒事。要補的時候，選項是雲端真機（BrowserStack 一類）或人工 checklist。
