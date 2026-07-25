# frond — Domain Glossary

frond 是一個 TypeScript 的 EPUB 渲染函式庫，只做 EPUB，直排與橫排並重，並在 Chromium / Firefox / WebKit 三家瀏覽器上實證驗證。專案共用術語表——issue 標題、重構提案、測試名稱都用這裡定義的詞。

## 書的結構

**readingOrder**:
一本書的閱讀順序，即 EPUB 封裝格式中 `<spine>` 所定義的內容順序。用 W3C Publication Manifest / Readium 的正式用詞而非規格原詞，一來 `spine`（書脊）是行話、字面與「閱讀順序」的關聯只有內行人知道，二來消費端專案就叫 spine，沿用會讓每一句「spine」都帶歧義。
_Avoid_: spine, 書脊

**Section**:
readingOrder 中的單一項目，對應一份 XHTML 內容文件。frond 每個 Section 渲染在一個 iframe 內。
_Avoid_: chapter, 章節（章節是 TOC 的概念，與 Section 不是一對一）

## 書寫方向

**直排**:
CJK 的縱向書寫（`writing-mode: vertical-rl`），字由上而下、行由右而左。frond 的直排一律**單欄**，一欄等於一個 viewer 高。
_Avoid_: 垂直排版, vertical mode, 直書

**橫排**:
橫向書寫（`writing-mode: horizontal-tb`）。橫排才有單欄／雙欄的選擇。
_Avoid_: 水平排版, 橫書

## 呈現的權威

三者優先順序固定為：讀者設定 > frond 修正 > 書的宣告。

**書的宣告**:
書自己的樣式表所表達的排版意圖。預設一律尊重——書醜不是介入理由。

**frond 修正**:
frond 主動覆寫書的宣告。只有兩種情況成立：內容讀不到（溢出被裁、重疊、空白頁），或讀者設定被書擋住（書用 `!important` 蓋掉讀者的選擇）。每一項都登記在封閉清單裡。

**讀者設定**:
讀者對呈現的顯式要求（字型、字級、行高、邊界、單欄／雙欄、主題）。永遠贏過另外兩者。

## 位置

**CFI**:
EPUB Canonical Fragment Identifier——書中的精確位置或範圍。用於閱讀進度回位與 annotation 的定位。
_Avoid_: locator, position, 書籤

**fraction**:
全書閱讀進度，0 到 1 的比例。用於拖拉定位軸一類的整書導覽。與 CFI 是**不同的位置概念**：CFI 精確但不可比大小，fraction 可比大小但粗。
_Avoid_: percentage, progress, 百分比
