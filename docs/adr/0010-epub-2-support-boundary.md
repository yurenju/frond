# EPUB 2 在 v1 範圍內做完整支援——邊界到哪為止

#15 的範圍問題已經有答案：**EPUB 2 在 v1 範圍內，做完整支援**，不是「只讀 NCX 當 fallback」。

理由是實證。真實的壞 TOC 出現在一本 calibre 產的 EPUB 2 上，那本書的導覽只有 `toc.ncx`。只做 NCX fallback 的話，合成 fixture 會長成「EPUB 3 附一份 NCX」——與書實際的形狀不同，測了不算數。calibre 那個年代的輸出在野外量很大。

決定本身在 #15 就做完了，這份文件的作用是**劃界**：支援 EPUB 2 到哪裡為止。沒有這條界線，「fixture 只有 nav.xhtml」看起來像疏漏而不像決定，下一個 agent 會再問一次。

## 這份文件的實證基礎

底下每一條「常態」「例外」的判斷都來自同一次掃描：本機第三層商業書（ADR-0007，不進 repo）**33 本繁中／簡中 EPUB**，逐本解出 OPF 與導覽文件後統計。

| 量到的事 | 數字 |
| --- | --- |
| EPUB 3（`<package version="3.0">`） | 31 |
| EPUB 2（`<package version="2.0">`，皆為 calibre 產） | 2 |
| **`nav.xhtml` 與 `toc.ncx` 兩者都有** | **31**（即所有 EPUB 3） |
| 只有 `toc.ncx` | 2（即兩本 EPUB 2） |
| 只有 `nav.xhtml` | **0** |
| 封面同時有 `properties="cover-image"` 與 `<meta name="cover">` | 30 |
| **EPUB 3 但封面只有 `<meta name="cover">`** | **1** |
| 帶 `page-progression-direction` | 11（全部是 EPUB 3：8 本 `rtl`、3 本 `ltr`）。**兩本 EPUB 2 都沒有**，EPUB 2 沒有這個屬性 |
| **帶 `primary-writing-mode`** | **0** |

樣本偏繁中商業書，**沒有一本日文書**，所以凡是牽涉日文出版慣例的結論都標記為未驗證，不當成事實。

**這張表不能拿來回答「有幾本是直排書」。** `page-progression-direction` 與書寫方向是兩件事——`rtl` 講的是頁面往哪個方向推進，直排／橫排寫在樣式表裡（理由見下面〈EPUB 2 沒有 `page-progression-direction` 時〉的第二條）。而樣式表裡出現 `writing-mode: vertical-rl` 也不足以認定整本是直排：Sigil 與 InDesign 的樣板會帶進未使用的規則，縱中橫（`.tcy`）之類的區域性用法也會命中同一個字串。要數直排書得渲染過才算，這份文件不需要那個數字。

## 支援的版本與載體

| | 支援 |
| --- | --- |
| EPUB 3.x（`<package version="3.0">` 起） | 是。導覽文件為 `nav.xhtml`（`properties="nav"`） |
| EPUB 2.0.1（`<package version="2.0">`） | 是，完整支援。導覽文件為 `toc.ncx`（`application/x-dtbncx+xml`） |

## 明確不支援的邊界

**支援 EPUB 2 不等於支援下面任何一項。** 這張清單存在的理由是讓下一個 agent 從文件知道「這裡為止」，而不是再問一次：

- **OEBPS 1.2 與 OEB 1.0**。EPUB 2 之前的封裝格式，`.opf` 的 namespace 與結構都不同。不讀，開書時以明確錯誤拒絕。
- **EPUB 2 的 fallback chain**（manifest item 的 `fallback` 屬性遞迴指向替代表述）。frond 只渲染 XHTML 內容文件；遇到非 XHTML 的 spine item 不去追它的 fallback 鏈，直接視為不支援的內容。
- **`<guide>`**。EPUB 2 的半導覽元素。不作為導覽來源，也不作為封面來源——封面走下面那條規則就夠了（實證：33 本裡沒有一本需要靠 `<guide>` 才找得到封面）。
- **`<tours>`**。EPUB 2 就已廢棄。
- **NCX 的 `pageList` 與 `navList`**，以及 EPUB 3 的 `page-list` nav。實體書頁碼導覽，v1 不做。
- **DTBook**。NCX 出自 DAISY，但 frond 只認 XHTML 內容文件。
- **EPUB 2 的 `<dc:identifier opf:scheme>` 語意**。identifier 原樣取出，不解讀它宣稱的 scheme（ISBN／UUID／URI），也不據此做正規化。

## 導覽文件的優先順序

**`nav.xhtml` 與 `toc.ncx` 兩者都在是常態，不是邊緣案例**——樣本裡 31 本 EPUB 3 全部兩者都有，一本例外都沒有。所以這條規則不能是「報錯」或「留給以後想」。

規則：

1. **`<package version="3.x">`：`nav.xhtml` 贏，NCX 完全忽略。** EPUB 3 規範以 `nav.xhtml` 為權威，附 NCX 是為了讓 EPUB 2 的閱讀器也開得動。
2. **`<package version="2.x">`：只有 NCX 這條路。**
3. 宣告的版本是 3.x 卻找不到 `properties="nav"` 的項目時，**退回 NCX**，不丟錯。理由與封面那條相同（見下）：書的封裝宣告與內容不一致是常態，而讀者要的是書打得開。
4. **兩份載體的內容不一致時，不合併、不交叉驗證、不報錯。** 依第 1 條選出的那一份就是 TOC，另一份不看。

第 4 條的理由是 ADR-0002 的分工：不一致是**事實**，要不要提示讀者是**政策**。所以 frond 回報「這本書的 TOC 來自哪一個載體」，把「NCX 說了別的」這件事留在可觀測的位置（診斷資訊），但不 throw、不自己決定要不要吵。EPUB 3 附一份過期的 NCX 完全合規，把它變成錯誤會讓一本好書開不起來。

## 封面

| 版本 | 宣告方式 |
| --- | --- |
| EPUB 3 | manifest 的 `properties="cover-image"` |
| EPUB 2 | `<meta name="cover" content="<manifest item 的 id>"/>` |

**兩條路都要走得通，而且 EPUB 3 也必須認舊寫法。** 這不是為了寬鬆，是實證：樣本裡有**一本 EPUB 3 的封面只有 `<meta name="cover">`**，沒有 `properties="cover-image"`。只按版本分派的實作會讓那本書沒有封面。

規則：先找 `properties="cover-image"`，找不到就找 `<meta name="cover">` 指向的 manifest 項目，兩者都沒有就是這本書沒有封面（不是錯誤）。

## EPUB 2 沒有 `page-progression-direction` 時，frond 回報什麼

`page-progression-direction` 是 EPUB 3 才有的屬性。這一條不能懸著，因為直排是 frond 的硬需求。

決定分三部分：

**一、`EpubBook` 回報「書有沒有說」，不預設值。** ppd 缺席時回報缺席，**不回報 `ltr`**。把「書沒說」與「書說了 ltr」壓成同一個值，會讓消費端無法分辨——而那正是它需要分辨的：spine 要據此決定左滑是上一頁還是下一頁（ADR-0002，frond 給事實、消費端給政策）。EPUB 2 的書一律落在「沒說」這一格。

**二、書寫方向不由 `EpubBook` 回答。** 直排／橫排寫在**樣式表**裡，不在封裝文件裡。`EpubBook` 零 DOM 依賴（ADR-0005），沒有 CSSOM 就判不準——實證：一本書把它宣告成 `-epub-writing-mode:vertical-rl`（冒號後無空白、屬性名帶前綴、位置在 `<body>`），對這種宣告做字串比對會漏掉，見 `docs/browser-quirks.md` 的〈`-epub-` 與 `-webkit-` 前綴的 `writing-mode`，Firefox 不認〉。所以書寫方向是 `Renderer` 的回報項，`EpubBook` 不猜。

這條界線讓「EPUB 2 沒有 ppd」不再是個缺口：EPUB 2 的直排書靠 CSS 宣告直排，那條路與 EPUB 3 的直排書完全相同，跟 ppd 沒有關係。

**三、`primary-writing-mode` 不讀。**

`<meta name="primary-writing-mode" content="vertical-rl"/>` 是業界流傳的 EPUB 2 直排慣例（Kindle／calibre 那一系的日文書）。**本專案沒有取得任何實證**：33 本樣本裡零命中，而樣本沒有日文書，所以「日文書會用它」這句話在這裡既沒被證實也沒被否證。

不讀它的理由不是「查無實據」，而是第二條的職責界線——讀它等於讓 `EpubBook` 對一個屬於 `Renderer` 的事實去猜，而且猜的依據是一個未經驗證的慣例。

**要翻案需要什麼**：一本帶該 meta 的書（日文 Kindle／calibre 系 EPUB 2 最可能），確認它的 `content` 值域與 CSS 宣告是否一致；若書只有這個 meta 而 CSS 沒宣告直排，那才構成「不讀它就排錯」的實證，屆時另開票，並且要連帶回答「封裝層的宣告如何影響 `Renderer` 的樣式決定」——那會跨過 ADR-0005 的雙層切分，不是加一個欄位就結束的事。

## Consequences

**EPUB 2 的支援成本大部分不在解析，在 fixture。** 兩份導覽載體、兩種封面宣告，各自要有健康與病症版本，而合成 fixture 的價值來自「一個檔一個病症」（ADR-0007）——載體因此成為第二個軸。#22 與 #23 承接這件事。

**「兩者都有是常態」讓 TOC 相關的病症必須長在 NCX 上。** 樣本裡的壞 TOC（48 個小寫 `%2c`）正是出現在 EPUB 2 的 NCX 上，而現有 fixture 只在 `nav.xhtml` 上演這個病症。#23 承接。
