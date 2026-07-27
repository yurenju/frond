# 測試用書：合成 fixture 為主，公版書為輔，商業書不進 repo

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
cover-meta-name.epub                EPUB 3 的封面只用 <meta name="cover">，manifest 沒有 properties
toc-href-percent-comma-epub2.epub   同一個 %2c 長在 NCX 的 content src 上
toc-href-parent-prefix-epub2.epub   NCX 在子目錄，content src 帶 ../ 前綴
nested-toc.epub                     nav.xhtml 的巢狀 TOC，<ol> 套在 <li> 裡面，兩層
nested-toc-epub2.epub               NCX 的巢狀 TOC，navPoint 套 navPoint，兩層
manifest-href-parent-prefix.epub    manifest href 帶 ../ 走到封裝根、目標存在——好書，擋誤報
writing-mode-prefixed-only.epub     直排只宣告 -epub- 與 -webkit- 前綴，Firefox 收不到
obfuscated-font-idpf.epub           字型用 IDPF 演算法混淆，META-INF/encryption.xml 宣告
```

體積小可 commit、零授權問題，且**測試紅燈直接指向唯一一個病因**——實際的書失敗得先花時間查是哪個特性造成的。橫排那六項全部來自 spine 已踩過的坑（見 ADR-0002），`healthy-epub2` 起三項來自 ADR-0010 那次掃描（#22），接下來七項照同一批樣本量到的結構合成（#23、#24）。

**最後那一份是唯一沒有樣本支撐的**：`obfuscated-font-idpf` 演的是 IDPF 演算法混淆過的字型（#30）。那 33 本樣本裡 `META-INF/encryption.xml` 一本都沒有、內嵌字型也是零本，所以它的形狀照的是規格而不是量到的書。這一格仍然要有 fixture，理由是**解錯不會丟錯**：拿錯的金鑰或蓋錯範圍解出來的位元組照樣是位元組，症狀要到讀者的畫面上才會以「整頁豆腐字」的形式出現，而那時候沒有人查得到根因在解碼。合成 fixture 在這裡買到的正是「錯了會有東西紅」。

那份「字型」不是真的 OTF——這份檔案演的是解碼那一步，真的字型會多帶授權與字面外觀兩個軸，而兩者都與解碼無關。

**不是每一份都演病症。** 表上有幾份是完全合規的書：`vertical-japanese` 與 `healthy-epub2` 是對照組，`nested-toc` 那一對演的是一種**形狀**（TOC 有層次）而不是缺陷。

其中 `manifest-href-parent-prefix` 是唯一一份為了**擋誤報**而存在的：它照一本實際通路書（Kobo、EPUB 3）的形狀合成，manifest 寫 `href="../js/kobo.js"`，而 `js/kobo.js` 確實存在於封裝根，照 URL 規則解析落在封裝內，**合規且解得開**。把 href 當字串接在內容目錄後面的實作會去找 `EPUB/../js/reader.js` 這個字面上的項目名，找不到，然後把一本好書判成「OPF 指向不存在的檔案」。「一個檔一個病症」的另一面是「一個檔一個必須被擋住的錯法」，而誤報也是一種錯法。

這張表在 `single-ailment.test.ts` 的 `REQUIRED_BY_ADR_0007` 有一份對應，而那條測試比的是**集合相等**——兩邊任一側多一份或少一份都會紅，所以這張表與程式碼沒有機會分家。

**第二層——公版書（進 repo，各一本）。** 合成 fixture 的死角是**它只能測已知的病**；實際的書價值在「發現」而非「回歸」。直排日文取自**青空文庫**（公版日本文學，直排是其原生形態，正是最難的一格），橫排取自 Project Gutenberg。各一本即可——這一層服務的是 agent 視覺判讀，那層本來就該數量最少。

**第三層——商業書（不進 repo）。** 放本機路徑並 gitignore，僅供人工驗證，CI 不依賴。

## EPUB 版本是第二個軸，寫在檔名的後綴上

ADR-0010 把 EPUB 2 收進 v1 範圍，於是 fixture 多了一個軸：同一個病症可以長在 **EPUB 3** 或 **EPUB 2** 上，而兩者在封裝層是兩種不同的形狀（不是同一份骨架加一份 NCX——那是照規格推出來的形狀，是範本書而不是書實際的形狀）。

**這一軸叫「EPUB 版本」，不叫「載體」。** CONTEXT.md 把載體留給**導覽文件**（`nav.xhtml` 與 `toc.ncx`），而兩者是不同的事——ADR-0010 的規則 3 講的正是「宣告 3.x 卻只有 NCX」那一格，混用就講不出那句話。#22 票上寫的是載體，那是 CONTEXT.md 收窄這個詞之前寫的。

**決定：版本是 `EpubSpec.epubVersion`（`"epub3"` | `"epub2"`，省略時 `"epub3"`），並寫在檔名的後綴上——沒有後綴就是預設的 EPUB 3，`-epub2` 就是 EPUB 2。**

不採用 `buildFixture(name, epubVersion)` 那條路。第二個參數會讓 committed 的檔案集合變成兩軸的乘積，而檔名終究還是得把那一對編碼進去（不然兩個檔案會同名），於是參數什麼也沒買到，卻換掉了**committed fixture 與檔名的一對一**——而那個一對一正是這批 fixture 的全部價值來源：紅燈時檔名就說明了是哪一種病復發。

後綴的另一個好處是同一個病症的兩個版本並排時看得出是一對：`cover-meta-name-epub2` 與 `cover-meta-name`、`toc-href-percent-comma` 與 `toc-href-percent-comma-epub2`、`nested-toc` 與 `nested-toc-epub2`。

**成對的那幾份共用同一個 `afflict`。** 各寫一次的話，兩份 fixture 的病症形狀會慢慢漂開，而「同一個病症在兩種載體上長成兩種形狀」正是它們並排的理由——形狀一旦不同源，並排比較就什麼也證明不了。`ailments.test.ts` 有一條直接斷言兩份的編碼 href 逐字相同。

**版本只管封裝層**：封裝文件、導覽文件、封面的宣告寫法。**內容文件（XHTML）兩種版本共用同一份樣板。** 這條界線是刻意的——內容文件是 `Renderer` 看到的東西，讓它跟著版本分岔的話，每一個內容層的病症都要乘二，而目前沒有任何實證說 EPUB 2 的內容文件會以不同的方式壞掉。真有那種實證時再往下切，不要預先付這筆帳。

**EPUB 3 的 fixture 不附 NCX**，儘管實際的書幾乎都附（ADR-0010：33 本樣本裡 31 本兩者都有）。理由是那份 NCX 只有在「兩份導覽載體內容不一致」時才有測試價值。#23 把 TOC 的病症長到 NCX 上，走的是**同一個病症的 EPUB 2 版本**這條路（`-epub2` 後綴），沒有動到這條界線——「兩份載體並存且內容不一致」仍然沒有 fixture，也還沒有任何一張票要求它。在有票要求之前，「壓縮檔裡出現 `.ncx`」就等於「這是 EPUB 2」，是一條可以直接斷言的不變量（`epub-version.test.ts`）。

## TOC 的層次是自己的一格，不是版本的副作用

巢狀 TOC 兩種載體各一份（`nested-toc`、`nested-toc-epub2`），因為**兩者表達層次的方式不同，錯法也不同**：`nav.xhtml` 的子清單是 `<ol>` 開在 `<li>` **裡面**，NCX 是 navPoint 直接套 navPoint。把子清單放成 `<li>` 的兄弟，XHTML 一樣良構、瀏覽器一樣畫得出來，但那棵樹是平的——這種錯在只有一層的 TOC 上完全看不出來。

形狀照樣本裡那本巢狀的 EPUB 2（繁中，Sigil → calibre）縮小：52 個 navPoint、深度 2、頂層 14 個第二層 38 個、**不是每個頂層都有子項目**、`content src` 帶 fragment 與不帶的在同一份文件裡混用。fixture 是 3 個頂層、4 個第二層（2/2/0）、深度 2、第二層兩種 href 各半——同樣的形狀，數量縮到骨架的三個 Section 上。

連帶兩件事不能再寫死：NCX 的 `dtb:depth` 要跟著實際層數算，`playOrder` 是**整棵樹拉平後的連續序號**而不是每層各自從 1 重數（樣本裡那本平的 NCX 是 1..48 連續）。

## 直排宣告的「位置」與「語法」是兩個病症，兩個檔

`writing-mode-on-body` 與 `writing-mode-prefixed-only` 看起來都是「直排宣告在 `<body>` 上」，但病的不是同一件事，所以是兩個檔而不是改一份：

| | `writing-mode-on-body` | `writing-mode-prefixed-only` |
| --- | --- | --- |
| 病在哪 | 宣告的**位置**（`<body>` 而非 `<html>`） | 宣告的**語法**（屬性名只有 `-epub-` 與 `-webkit-` 前綴） |
| 瀏覽器有照書做嗎 | 有，三家 computed 都是 `vertical-rl` | Firefox 沒有，宣告被丟掉 |
| 誰讀得不夠 | library 只讀 `documentElement` | 沒有人讀不夠，宣告根本沒生效 |

兩份互為對照組：同樣宣告在 `<body>`、同樣 `vertical-rl`，**只差屬性名**。差別若不只這一項，「Firefox 為什麼一本橫排一本直排」就不再只有前綴這一個解釋。量測與三家對照圖見 `docs/browser-quirks.md` 的〈`-epub-` 與 `-webkit-` 前綴的 `writing-mode`，Firefox 不認〉。

前綴那一份的冒號後留一個空白，雖然觸發它的那本書寫的是無空白——無空白是同一份文件裡另一格已經量過的事實（三家都認），寫進來就變成兩個軸疊在同一個檔案上。

**不合法的組合在產生器裡丟錯，不靜默修正**：EPUB 2 + `page-progression-direction`、EPUB 2 + `properties="cover-image"`。這兩種組合產出的書看起來是好的（只是多一個屬性），沒有下游測試會紅，然後它會被當成書實際的形狀拿去測解析。

## 封面的宣告寫法也是一軸，不由版本推得

封面有兩種宣告寫法（EPUB 3 的 manifest `properties="cover-image"`、EPUB 2 的 `<meta name="cover">`），而 **ADR-0010 要求兩條路都走得通，且不按版本分派**——樣本裡有一本 EPUB 3 的封面只有舊寫法。

所以 `CoverSpec.declaredBy` 是一份寫法清單（實際的書常態是兩種都寫——樣本裡 30 本），與 `epubVersion` 各自獨立。三種有意義的組合都有 fixture，#22 產出前兩種，第三種由 #24 補上：

| fixture | 版本 | 宣告寫法 |
| --- | --- | --- |
| `cover-image-property` | EPUB 3 | `properties="cover-image"` |
| `cover-meta-name-epub2` | EPUB 2 | `<meta name="cover">` |
| `cover-meta-name` | EPUB 3 | `<meta name="cover">`——只有舊寫法 |

第三列是這張表唯一**版本與寫法不成對**的一格，也是它存在的全部理由：按版本分派封面的實作在前兩列全綠，然後讓樣本裡那本書在書櫃上沒有縮圖。

**封面不進健康骨架，是自己的 fixture。** 骨架帶了封面的話每一份 fixture 都會多一張 PNG，於是「這本書帶了內文用的圖片資源」這個探針就再也分不出 `empty-and-image-only-sections`——單點差異的紀律會從封面這一格漏掉。

## 產生器是公開產出物

合成 fixture 的產生器對外發佈（如 `@frond/test-fixtures`），供 spine 及其他消費者測試自己的整合層。那份病症清單本身就是這個專案最有價值的知識之一，不該鎖在測試目錄裡。
