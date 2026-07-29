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
writing-mode-behind-import.epub     <link> 的樣式表只有一行 @import 字串，排版意圖都在被 import 的那份裡
hidden-trailing-notes.epub          正文之後跟著 display:none 的註腳，最後一個文字節點畫不出來
plate-taller-than-page.epub         圖版比一頁還高，包在一層沒宣告高度的 div 裡
table-taller-than-page.epub         表格比一頁還高——三家分歧，Chromium 切欄、另兩家裁掉
scripted-content-in-body.epub       <body> 兩段之間夾 <script> 與 <iframe>——移除它們會位移同層之後的 CFI
nav-inside-section.epub             toc <nav> 包在 <section> 裡而不是直接掛在 <body> 底下
```

體積小可 commit、零授權問題，且**測試紅燈直接指向唯一一個病因**——實際的書失敗得先花時間查是哪個特性造成的。橫排那六項全部來自 spine 已踩過的坑（見 ADR-0002），`healthy-epub2` 起三項來自 ADR-0010 那次掃描（#22），接下來七項照同一批樣本量到的結構合成（#23、#24）。

`writing-mode-behind-import` 起那四項來自**拿 34 本書實際跑一趟渲染**才量到的病症，見下節。

**`scripted-content-in-body` 是表上唯一「量到 0 才做」的檔**。它演的形狀在 34 本 1638 節裡出現 0 次（`<script>` 全部在 `<head>`，`<body>` 一個都沒有），所以它不是為了守某個病症的回歸——它守的是 `stripScriptedContent` 的 `remove()` 造成的 CFI 位移**有一支會紅的測試**。理由與 `table-taller-than-page` 同一個形狀（釘住現況，讓改變有人知道），差別在那一格是三家分歧、這一格是 frond 自己的移除型介入（#54，規則寫在 ADR-0008）。

**最後一項 `nav-inside-section` 是表上第一份來自第二層而不是第三層的。** 它照 `草枕` 的導覽文件縮小——那本書在 #35 進 repo 的第一天就讓 frond 把整份 TOC 讀成空的，詳情見下面第二層那節。

**`obfuscated-font-idpf` 是唯一沒有樣本支撐的一份**：它演的是 IDPF 演算法混淆過的字型（#30）。那 33 本樣本裡 `META-INF/encryption.xml` 一本都沒有、內嵌字型也是零本，所以它的形狀照的是規格而不是量到的書。這一格仍然要有 fixture，理由是**解錯不會丟錯**：拿錯的金鑰或蓋錯範圍解出來的位元組照樣是位元組，症狀要到讀者的畫面上才會以「整頁豆腐字」的形式出現，而那時候沒有人查得到根因在解碼。合成 fixture 在這裡買到的正是「錯了會有東西紅」。

那份「字型」不是真的 OTF——這份檔案演的是解碼那一步，真的字型會多帶授權與字面外觀兩個軸，而兩者都與解碼無關。

**不是每一份都演病症。** 表上有幾份是完全合規的書：`vertical-japanese` 與 `healthy-epub2` 是對照組，`nested-toc` 那一對演的是一種**形狀**（TOC 有層次）而不是缺陷。

其中 `manifest-href-parent-prefix` 是唯一一份為了**擋誤報**而存在的：它照一本實際通路書（Kobo、EPUB 3）的形狀合成，manifest 寫 `href="../js/kobo.js"`，而 `js/kobo.js` 確實存在於封裝根，照 URL 規則解析落在封裝內，**合規且解得開**。把 href 當字串接在內容目錄後面的實作會去找 `EPUB/../js/reader.js` 這個字面上的項目名，找不到，然後把一本好書判成「OPF 指向不存在的檔案」。「一個檔一個病症」的另一面是「一個檔一個必須被擋住的錯法」，而誤報也是一種錯法。

這張表在 `single-ailment.test.ts` 的 `REQUIRED_BY_ADR_0007` 有一份對應，而那條測試比的是**集合相等**——兩邊任一側多一份或少一份都會紅，所以這張表與程式碼沒有機會分家。

**第二層——公版書（進 repo，各一本）。** 合成 fixture 的死角是**它只能測已知的病**；實際的書價值在「發現」而非「回歸」。直排日文一本、橫排一本，放在 `tests/books/public/`。各一本即可——這一層服務的是 agent 視覺判讀，那層本來就該數量最少。出處、授權依據與修剪見下節。

**第三層——商業書（不進 repo）。** 放本機路徑並 gitignore，僅供人工驗證，CI 不依賴。

### 第二層的兩本書（#35）

`Renderer` 那一批（#32）是第一次動到版面的變更，也就是這份 ADR 預期會需要第二層的那一張票，而**它沒有補上**——青空文庫（`www.aozora.gr.jp`）與 Project Gutenberg（`www.gutenberg.org`）都不在這台機器的出口白名單上，下載不到。代價當時就寫清楚了：#32 的視覺判讀全部跑在合成 fixture 上（`docs/evidence/32/`），證明的是「已知的那幾種病沒有復發」，不是「實際的書排得對」。

#35 換了來源把這一格補上。**兩本都不是從原本設想的那兩個站台拿的，而換來源同時解決了授權與可及性兩件事**：

| | `kusamakura-vertical-japanese.epub` | `alice-in-wonderland-horizontal.epub` |
| --- | --- | --- |
| 書 | 草枕／夏目漱石（1906，作者 1916 歿） | Alice's Adventures in Wonderland／Lewis Carroll（1865），Tenniel 插畫 |
| 出處 | <https://idpf.github.io/epub3-samples/30/samples.html> | <https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel> |
| 原始碼 | <https://github.com/IDPF/epub3-samples> | <https://github.com/standardebooks/lewis-carroll_alices-adventures-in-wonderland_john-tenniel> |
| 授權依據 | 樣本集：「Unless otherwise specified, all samples listed here are licensed under CC-BY-SA 3.0」，而 Kusamakura 那一列**沒有 per-sample 的覆寫**。封裝文件自己宣告得更寬：`dcterms:license` 是 **CC0 1.0** | 內文與插畫為**美國公有領域**；Standard Ebooks 的貢獻（markup、metadata、排版）以 **CC0 1.0** 奉獻。兩者都寫在 `dc:rights` 與 `uncopyright.xhtml` |
| 原尺寸 → 進 repo | 17.9 MB → 228 KB | 10.6 MB → 2.7 MB |

**內文其實還是青空文庫的。** Kusamakura 的 `dcterms:source` 指向 `aozora.gr.jp/cards/000148/card776.html`，只是由 EPUB 日本語擴充規格策定專案打包成 EPUB 3。所以這不是「放棄青空文庫」，是拿到一份已經打包好、且從白名單內的網域下載得到的青空文庫。

**Alice 走 Standard Ebooks 而不是 Gutenberg，是刻意的。** Standard Ebooks 這一版 based on 2008 年 Arthur DiBianca 與 David Widger 為 Project Gutenberg 做的轉錄與 Internet Archive 的掃描，但重新編排、**不帶 Gutenberg 的 header/footer**，所以 Gutenberg 自己的 trademark 條款完全不適用——原本的計畫就是要走「移除 header/footer 的版本」這條乾淨路線，這一版等於已經替我們走完。

#### 修剪掉了什麼

修剪由 `scripts/trim-public-books.ts`（`npm run trim:books`）執行。**原始下載檔不進 repo**——第二層的書是下載物而不是產生物，repo 留的是修剪後的結果加那支腳本，腳本因此是「修剪方式」的機器可讀版本，這一節是它的散文版本，兩邊要一起改。腳本裡每一處移除都寫死了預期的元素個數，上游改版導致數目對不上時腳本會停，而不是安靜地產出一本半數指標懸空的書。

**Kusamakura：拿掉朗讀，正文十三章全留。** 18 MB 的 media overlay 旁白（兩個 MP3）加兩份 SMIL，連同封裝文件裡的 manifest 項目、兩章的 `media-overlay` 屬性、以及 refine 到那些 id 的 metadata（`media:duration`、`media:narrator`、每段音檔的 rights 與 license）。frond 不從 media overlay 渲染任何東西，所以這一刀不損失任何涵蓋面；**它同時拿掉了這本書唯一有負擔的素材**——出版物本體是 CC0，但那兩個 MP3 單獨標的是 CC-BY-NC-SA 3.0，而 NC 條款不該出現在一個 MIT repo 裡。

**Alice：正文剪到第 1–3 章，插畫一張都不改。** 9.5 MB 分佈在 43 張 Tenniel 插畫上，而插畫不是可有可無的——「有插圖的實際書籍」正是這份 ADR 說合成 fixture 搆不到的形狀。所以插畫**維持原始尺寸與原始位元組**：重新編碼或縮圖會改變一張圖版會不會撐破一頁，而「圖版比一頁還高」正是這一層要找的那種病。改剪文字：留下第 1–3 章（約 7,600 字，在三家的預設字級下每一節都分成很多頁，正是合成散文搆不到的那一軸）、9 張插畫連同卷首圖、以及第 3 章那首排成錐形的〈老鼠的尾巴〉——一種沒有任何合成 fixture 有的真實排版結構。Standard Ebooks 的前後附頁全留。跟著走的還有被剪掉那九章專用的 32 張插畫，以及封裝文件、導覽文件、NCX 與插圖目次裡指向它們的每一個項目。

#### 它們不進 CI 的斷言，但「這本書是完整的」進

**版面不斷言。** 實際的書沒有正確答案可以斷言：沒有人寫下過《草枕》該佔幾頁，把今天的數字釘住等於把當下的行為當成規格。這一層的版面靠開 PR 前用眼睛判讀（`docs/agents/pull-requests.md`），`tests/node/public-books.test.ts` 一行幾何數字都沒有。

**但修剪有正確答案，所以那個要斷言。** 修剪從一本書裡拿掉東西，而每一次移除都得在封裝文件、導覽文件與 NCX 三處對上；漏掉一處，書照樣打得開，只是安靜地指著已經不存在的資源——那時候那本書服務的視覺判讀，判讀的會是我們的錯誤處理而不是我們的排版。所以那份測試斷言的是**書自己說得出口的每一條路徑，都是書裡真的有的路徑**，oracle 是壓縮檔本身。這條線的兩邊分得很乾淨：几何不斷言，完整性斷言。

#### 這一層上線第一天就抓到一個病

`草枕` 進 repo 的第一次 `EpubBook.open()`，TOC 讀回來是**空的**。

根因在 `packages/frond/src/epub/toc.ts` 的 `pickTocNav`：它只看 `<body>` 的直接子元素，而那份註解寫著「量測：31/31 都是」。`草枕` 把 `<nav epub:type="toc">` 包在一層 `<section epub:type="frontmatter">` 裡面。EPUB 3.3 對這件事講得很明確——「there are no restrictions on the structure or content of the EPUB navigation document outside of the specialized navigation elements」，而導覽文件的要求是**包含**（include）恰好一個 `toc` nav，接著限制的是該元素**自身與其後代**的 content model，對它的**祖先**一個字都沒說。那本書完全合規，是 frond 讀錯。

那個 31/31 沒有錯，它是 31 本書的量測；**錯的是把「量到的形狀」當成「合法的形狀」**——而且反例就在 EPUB 3 的官方樣本裡。修法是把兩個步驟分開問不同的問題：帶 `epub:type` 宣告的那個 nav 往下找到**任何深度**（規格的限制條款正好掛在這個條件上），沒有任何宣告時的 fallback 則**維持 `<body>` 的直接子元素**——沒有宣告就沒有東西能把目次和正文裡任何一份清單區分開，而導覽文件可以進 spine 當正文讀，那一步遞迴會讓正文裡的 `<nav>` 變成 TOC。

回歸交回第一層：`nav-inside-section.epub`。實際的書刻意不進 CI 斷言，所以沒有那份合成 fixture 的話，沒有任何東西擋得住這個修正被改回去。這正是這份 ADR 說「發現交給第二層、回歸交回第一層」時指的流程，只是第一次真的跑起來。

### 第三層跑過一趟了，而它一次抓到四個病

第二層（公版書）仍然缺席，但**第三層（商業書，34 本）在 `Renderer` 完成之後跑了一趟完整的渲染掃描**，入口是 `npm run scan:books`（`scripts/scan-books.sh`，書由 `FROND_BOOKS` 唯讀掛進測試容器，不進 build context 也不落在 repo 樹裡）。

那一趟證實了這份 ADR 對第一層的判斷：**合成 fixture 只測得到已知的病。** 34 本書在 `EpubBook` 那一層全部開得起來、`bytes()` 一節都沒有失敗，417 條瀏覽器測試全綠——然後掃描抓到四個一條測試都沒碰到的病：

| 病症 | 樣本裡的分布 | 讀者看到什麼 |
| --- | --- | --- |
| `@import` 的字串寫法沒展開 | 4 本（12%），同一條 Kadokawa／BookCreator 工具鏈 | 整份樣式表消失，四本直排書全部排成橫排 |
| 文件順序最後一個文字節點畫不出來 | 十餘本，註腳藏在正文後面是常態 | 一章只翻得到第一頁；最嚴重的一節 8778 個字只報得出 1 頁 |
| 圖版比一欄還高 | 4 本共 7 節 | 圖的下半被裁掉，而且翻頁也翻不出來（最嚴重裁掉 738px，圖的 57%） |
| 表格比一欄還高 | 3 本共 9 節 | **只有 Firefox** 裁掉下半（最嚴重 2563px），而且整節頁數變成 1——**這一格 frond 修不掉** |

四者的共同形狀值得記下來：**沒有任何一個會報錯。** 頁數是一個看起來正常的數字、方向是一個看起來正常的方向、圖是一張看起來正常的圖。這正是 ADR 說「實際的書價值在發現而非回歸」時指的東西——而發現之後，每一個都各自變成一份合成 fixture（表上最後四項）與一組測試，回歸就交回第一層。

**最後一格與前三格不同：它沒有被修掉。** 表格比一欄還高時，`max-block-size` 幫不上忙（`max-height` 對表格是**下限**而不是上限），而 Firefox 不把表格切到相鄰的欄（Chromium 與 WebKit 都切）。要讓那些內容讀得到，只剩「把 `display: table` 換掉」這一類會**犧牲表格對齊**的做法——那是一個權衡決定而不是一個 bug 修正，所以它登記成缺口（`packages/frond/src/renderer/interventions.ts`）並由 fixture 加測試**釘住現況**，寫法照 `regional-faces.spec.ts` 對 #4 的處置。`table-taller-than-page` 因此是表上第二份「不是為了守回歸、而是為了讓分歧變了有人知道」的 fixture。

**只跑一家會漏掉東西。** 表格那一格**只在 Firefox 上出現**——第一輪掃描只跑 Chromium，於是四個病只抓到三個。掃描要三家都跑，理由與測試要三家都跑是同一個（ADR-0004）。

掃描用的 spec 是一次性的，放 `tests/browser/evidence/`（已 gitignore，理由同 PR 證據圖）。**留下來的是入口與 fixture，不是那支 spec**：spec 服務單一次判讀，而它問的問題會隨著下一次掃描要找什麼而改。

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
