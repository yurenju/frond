# 測試用書：合成 fixture 為主，公版真書為輔，商業書不進 repo

## 觸發點

spine 的 repo 裡 commit 了兩本仍在版權內的商業書：`public/PROTOTYPE-books/vertical.epub`（《入境大廳》陳偉棻／時報出版，335 KB）與 `horizontal.epub`（《快思慢想》康納曼／天下文化，1.9 MB），兩者皆被 git 追蹤。spine 是私有 repo 所以風險有限，但這條路對 frond 封死——一旦公開就是公開散布，而且 commit 進 git history 後洗不掉。

## 三層 fixture

**第一層——合成 fixture（主力，進 repo）。** 由腳本產生，**一個病症一個檔，檔名即病症名**：

```
vertical-japanese.epub              健康的直排日文書——直排三個病症的對照組
writing-mode-on-body.epub           InDesign 把 writing-mode 宣告在 <body> 而非 <html>
toc-href-percent-comma.epub         nav href 的逗號被編碼成 %2c
toc-href-parent-prefix.epub         TOC href 帶 ../ 前綴
font-size-important.epub            書寫死 font-size !important，讀者字級失效
fixed-width-800.epub                width: 800px，小螢幕內容被裁
hardcoded-colors.epub               寫死 color/background，夜間模式失效
ppd-rtl-vertical.epub               直排 + page-progression-direction=rtl
huge-single-section.epub            單一巨大 section（分頁效能 / locations）
empty-and-image-only-sections.epub  空 section、純圖片 section
healthy-epub2.epub                  健康的 EPUB 2 骨架（OPF 2.0 + NCX，沒有頁面推進方向）
cover-image-property.epub           封面走 EPUB 3 的 manifest properties="cover-image"
cover-meta-name-epub2.epub          封面走 EPUB 2 的 <meta name="cover">
```

體積小可 commit、零授權問題，且**測試紅燈直接指向唯一一個病因**——真書失敗得先花時間查是哪個特性造成的。橫排那六項全部來自 spine 已踩過的坑（見 ADR-0002），最後三項來自 ADR-0010 的真書掃描（#22）。

這張表在 `single-ailment.test.ts` 的 `REQUIRED_BY_ADR_0007` 有一份對應，而那條測試比的是**集合相等**——兩邊任一側多一份或少一份都會紅，所以這張表與程式碼沒有機會分家。

**第二層——公版真書（進 repo，各一本）。** 合成 fixture 的死角是**它只能測已知的病**；真書的價值在「發現」而非「回歸」。直排日文取自**青空文庫**（公版日本文學，直排是其原生形態，正是最難的一格），橫排取自 Project Gutenberg。各一本即可——這一層服務的是 agent 視覺判讀，那層本來就該數量最少。

**第三層——商業真書（不進 repo）。** 放本機路徑並 gitignore，僅供人工驗證，CI 不依賴。

## EPUB 版本是第二個軸，寫在檔名的後綴上

ADR-0010 把 EPUB 2 收進 v1 範圍，於是 fixture 多了一個軸：同一個病症可以長在 **EPUB 3** 或 **EPUB 2** 上，而兩者在封裝層是兩種不同的形狀（不是同一份骨架加一份 NCX——那是回溯相容那條路，不是野書那條）。

**這一軸叫「EPUB 版本」，不叫「載體」。** CONTEXT.md 把載體留給**導覽文件**（`nav.xhtml` 與 `toc.ncx`），而兩者是不同的事——ADR-0010 的規則 3 講的正是「宣告 3.x 卻只有 NCX」那一格，混用就講不出那句話。#22 的票面寫的是載體，那是 CONTEXT.md 收窄這個詞之前寫的。

**決定：版本是 `EpubSpec.epubVersion`（`"epub3"` | `"epub2"`，省略時 `"epub3"`），並寫在檔名的後綴上——沒有後綴就是預設的 EPUB 3，`-epub2` 就是 EPUB 2。**

不採用 `buildFixture(name, epubVersion)` 那條路。第二個參數會讓 committed 的檔案集合變成兩軸的乘積，而檔名終究還是得把那一對編碼進去（不然兩個檔案會同名），於是參數什麼也沒買到，卻換掉了**committed fixture 與檔名的一對一**——而那個一對一正是這批 fixture 的全部價值來源：紅燈時檔名就說明了是哪一種病復發。

後綴的另一個好處是同一個病症的兩個版本並排時看得出是一對：`cover-meta-name-epub2` 與（#24 將補上的）`cover-meta-name`。

**版本只管封裝層**：封裝文件、導覽文件、封面的宣告寫法。**內容文件（XHTML）兩種版本共用同一份樣板。** 這條界線是刻意的——內容文件是 `Renderer` 看到的東西，讓它跟著版本分岔的話，每一個內容層的病症都要乘二，而目前沒有任何實證說 EPUB 2 的內容文件會以不同的方式壞掉。真有那種實證時再往下切，不要預先付這筆帳。

**EPUB 3 的 fixture 不附 NCX**，儘管野書幾乎都附（ADR-0010：33 本樣本裡 31 本兩者都有）。理由是那份 NCX 只有在「兩份導覽載體內容不一致」時才有測試價值，而那是 #23 的範圍。在它到之前，「壓縮檔裡出現 `.ncx`」就等於「這是 EPUB 2」，是一條可以直接斷言的不變量。

**不合法的組合在產生器裡丟錯，不靜默修正**：EPUB 2 + `page-progression-direction`、EPUB 2 + `properties="cover-image"`。這兩種組合產出的書看起來是好的（只是多一個屬性），沒有下游測試會紅，然後它會被當成野書的形狀拿去測解析。

## 封面的宣告寫法也是一軸，不由版本推得

封面有兩種宣告寫法（EPUB 3 的 manifest `properties="cover-image"`、EPUB 2 的 `<meta name="cover">`），而 **ADR-0010 要求兩條路都走得通，且不按版本分派**——樣本裡有一本 EPUB 3 的封面只有舊寫法。

所以 `CoverSpec.declaredBy` 是一份寫法清單（野書的常態是兩種都寫——樣本裡 30 本），與 `epubVersion` 各自獨立。三種有意義的組合裡，#22 產出前兩種，第三種由 #24 補上：

| fixture | 版本 | 宣告寫法 |
| --- | --- | --- |
| `cover-image-property` | EPUB 3 | `properties="cover-image"` |
| `cover-meta-name-epub2` | EPUB 2 | `<meta name="cover">` |
| `cover-meta-name`（#24） | EPUB 3 | `<meta name="cover">`——只有舊寫法 |

**封面不進健康骨架，是自己的 fixture。** 骨架帶了封面的話每一份 fixture 都會多一張 PNG，於是「這本書帶了內文用的圖片資源」這個探針就再也分不出 `empty-and-image-only-sections`——單點差異的紀律會從封面這一格漏掉。

## 產生器是公開產出物

合成 fixture 的產生器對外發佈（如 `@frond/test-fixtures`），供 spine 及其他消費者測試自己的整合層。那份病症清單本身就是這個專案最有價值的知識之一，不該鎖在測試目錄裡。
