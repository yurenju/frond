# 瀏覽器 quirks

逐條登記三家瀏覽器的行為差異：症狀、繞法、frond 是否需要處理、哪個測試會抓到。

這份表是「以 foliate 為參考實作」的實體產出物——搬運的是知識而非程式碼（ADR-0001）。重新實作不會繼承 foliate 已經套好的補丁，只會重新撞上一次，所以每撞到一條就登記一條。最後一欄直接構成測試套件的需求清單。

登記的門檻是**實測**。從別人的原始碼或文件推得的行為要標明未經本專案驗證，不要與量測結果混在一起。

---

## WebKit 在直排下不自動套用 `vert`

**症狀**

`writing-mode: vertical-rl` 下，CJK 標點沒有換成直排字符。日文句點應該移到字面方框的右上，實測 WebKit 把它留在左下。

以 `。`（U+3002，Noto Serif CJK JP，200px 方框，墨水重心正規化到 [0, 1]）量測：

| 瀏覽器 | 橫排 | 直排（預設） | 直排 + `font-feature-settings: "vert" 1` |
| --- | --- | --- | --- |
| Chromium | (0.180, 0.863) | **(0.780, 0.210)** 右上 | (0.780, 0.210) |
| Firefox | (0.181, 0.865) | **(0.778, 0.210)** 右上 | (0.778, 0.210) |
| WebKit | (0.181, 0.865) | **(0.251, 0.887)** 左下 | **(0.848, 0.330)** 右上 |

WebKit 預設的直排渲染除了位置不對，墨水像素數也較少（752 對 1086），代表取到的不只是位置不同，而是不同的字符。

**繞法**

顯式 `font-feature-settings: "vert" 1`。實測強制之後 WebKit 移到右上，且 Chromium 與 Firefox 的結果不受影響——三家可以共用同一條規則，不需要分支。

**frond 是否需要處理**

需要。直排是 frond 的硬需求，標點位置錯誤是讀者一眼看得到的缺陷，而 DOM 斷言與幾何不變量都抓不到——全形標點的字面寬相同，斷行與斷頁完全不受影響。

尚未決定的是**注入的層級**：是 Renderer 一律注入，還是只在 WebKit 注入。一律注入比較簡單且已驗證無害，但那是 frond 主動覆寫書的宣告，需要對照 ADR-0003 的介入門檻——這一條應該歸類為「內容讀不到」還是根本不算介入，值得寫進封閉清單時想清楚。

**哪個測試會抓到**

`tests/browser/smoke/vertical-writing.spec.ts` 的「標點取到直排字符」。目前該測試自行注入 `"vert" 1`，因此驗證的是「字型有直排字符且畫得出來」這個環境性質。等 Renderer 存在之後，需要另一條測試驗證 Renderer 本身有做這件事。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`、`fonts-noto-cjk` `1:20230817+repack1-3`）。Playwright 的 WebKit 是 Linux 上的建置，文字塑形走 HarfBuzz + Fontconfig，真 Safari 走 CoreText——**這條在 iOS 上的行為未經驗證**（ADR-0004 明列不做 iOS 驗證）。

---

## 三家對 generic family 的 CJK 解析不一致

獨立追蹤於 [#4](https://github.com/yurenju/frond/issues/4)，量測結果記在該 issue。摘要：`font-family: serif` 在 Firefox 上正確依 `lang` 解析到 Noto Serif CJK 的對應區域字面，WebKit 一律選 TC，Chromium 的落點不等於任何 Noto CJK 字面。

同時登記一條量測方法上的陷阱：**漢字不能用來鑑別字面**。「骨」「直」這類漢字統一的代表字，其區域字形由 `lang` 經 OpenType `locl` 驅動——同一字面換 `lang` 會變，不同字面同一 `lang` 不變（三家一致）。拿漢字問「解析到哪個字面」永遠得到「看不出來」。標點才有鑑別力。
