# 測試用書：合成 fixture 為主，公版真書為輔，商業書不進 repo

## 觸發點

spine 的 repo 裡 commit 了兩本仍在版權內的商業書：`public/PROTOTYPE-books/vertical.epub`（《入境大廳》陳偉棻／時報出版，335 KB）與 `horizontal.epub`（《快思慢想》康納曼／天下文化，1.9 MB），兩者皆被 git 追蹤。spine 是私有 repo 所以風險有限，但這條路對 frond 封死——一旦公開就是公開散布，而且 commit 進 git history 後洗不掉。

## 三層 fixture

**第一層——合成 fixture（主力，進 repo）。** 由腳本產生，**一個病症一個檔，檔名即病症名**：

```
writing-mode-on-body.epub           InDesign 把 writing-mode 宣告在 <body> 而非 <html>
toc-href-percent-comma.epub         nav href 的逗號被編碼成 %2c
toc-href-parent-prefix.epub         TOC href 帶 ../ 前綴
font-size-important.epub            書寫死 font-size !important，讀者字級失效
fixed-width-800.epub                width: 800px，小螢幕內容被裁
hardcoded-colors.epub               寫死 color/background，夜間模式失效
ppd-rtl-vertical.epub               直排 + page-progression-direction=rtl
huge-single-section.epub            單一巨大 section（分頁效能 / locations）
empty-and-image-only-sections.epub  空 section、純圖片 section
```

體積小可 commit、零授權問題，且**測試紅燈直接指向唯一一個病因**——真書失敗得先花時間查是哪個特性造成的。前六項全部來自 spine 已踩過的坑（見 ADR-0002）。

**第二層——公版真書（進 repo，各一本）。** 合成 fixture 的死角是**它只能測已知的病**；真書的價值在「發現」而非「回歸」。直排日文取自**青空文庫**（公版日本文學，直排是其原生形態，正是最難的一格），橫排取自 Project Gutenberg。各一本即可——這一層服務的是 agent 視覺判讀，那層本來就該數量最少。

**第三層——商業真書（不進 repo）。** 放本機路徑並 gitignore，僅供人工驗證，CI 不依賴。

## 產生器是公開產出物

合成 fixture 的產生器對外發佈（如 `@frond/test-fixtures`），供 spine 及其他消費者測試自己的整合層。那份病症清單本身就是這個專案最有價值的知識之一，不該鎖在測試目錄裡。
