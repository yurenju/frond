# 定位是樹的規則，不是 DOM 的規則

ADR-0005 把 frond 切成兩層：`EpubBook` 零 DOM、在 Node 裡跑，`Renderer` 需要 DOM。那一刀切得對，但**有一樣東西切錯邊了**——CFI 與位置的對映。

`cfi.ts` 的檔頭當初這樣寫：

> **Mapping between a CFI and a DOM position is not here.** That needs an actually rendered document.

「需要一份真的渲染過的文件」量錯了東西。它需要的是**一棵樹**，而渲染過的文件只是恰好是一棵。CFI 規格 2.2 講的是「同一個父節點底下的子節點怎麼編號」：元素取偶數、文字取奇數、相鄰文字併成一段、註解不佔位。這四條裡沒有一條碰得到版面、樣式或瀏覽器。

代價是：**手上有一本書、但沒有瀏覽器的消費端，碰不到書裡的位置。** 打得開書、讀得到某一節的位元組，卻算不出「這個 CFI 指到哪一句」，也生不出 CFI。Worker、CLI、批次工具都卡在這裡。

## 決定

把「在樹上定位」下沉到零 DOM 那一層：

```
epub/tree.ts            定位需要的節點形狀，加上節點型別判斷
epub/cfi-tree.ts        定位本身（原本是 renderer/cfi-dom.ts 的全部）
epub/text-nodes.ts      攤平文字的走訪（原本是 renderer/text-index.ts 的全部）
epub/content-document.ts 消費端拿到的東西：一節的文字 ↔ CFI

renderer/cfi-dom.ts     只剩 Range 的轉接
renderer/text-index.ts  只剩 DOM 的型別
```

`TreeNode` 的成員名字**就是 DOM 的**，所以 DOM 的 `Node` 原樣滿足它——不用轉接、不用包裝。這不是對 DOM 的禮讓，是因為轉接層正是「同一份走訪」悄悄變成兩份的地方。

`node-type.ts` 早就把節點型別的數字硬寫死了，理由是跨 realm（`Renderer` 跑在外層、節點來自 iframe）。**同一個性質讓不是 DOM 的樹也適用**——一棵非 DOM 的樹沒有 `Node` 建構子可以比對，那幾個數字是兩棵樹本來就共用的唯一詞彙。

## 兩棵樹不一樣，而規則本來就吸收得掉

走訪共用不等於樹一樣。已知兩處差異：

- **註解**：瀏覽器的樹有，`xml.ts` 的樹沒有。CFI 說註解不佔位，所以編號不受影響；也因為不佔位，它**不會把一段文字切成兩段**。
- **entity reference**：瀏覽器的 XML parser 常在那裡留下好幾個相鄰的文字節點，`xml.ts` 就地解碼、留一個字串。相鄰文字在編號之前就併成一段，差異剛好被吃掉。

第二點原本就寫在 `cfi-dom.ts` 的檔頭裡（「Real books … frequently leave adjacent text nodes where entity references were」），只是當時是拿來解釋為什麼要合併，不是拿來當作兩套實作可以對得起來的理由。

**但這種話不能用推理結案。** 問題是「真的瀏覽器裡真的 XML parser 對真的 markup 做了什麼」，唯一的儀器是真的瀏覽器。所以有 `tests/browser/renderer/cfi-cross-implementation.spec.ts`：同一節書，兩邊各為**每一個字元**生一次 CFI，逐條比對。逐字元而不是抽樣，因為會出事的地方是接縫——行內標籤之後的第一個字、註解之前的最後一個字——挑哪些位置來測，就是當初把 bug 放進去的那個猜測。

它第一次跑就抓到一件事，而且不是上面兩處的任何一處：**`xml.ts` 沒有做 XML 1.0 §2.11 要求的行尾正規化**。`kusamakura` 是 CRLF 寫的，於是同一段詩在 frond 這邊比瀏覽器多四個 `\r`，之後每一個字元位移都對不上。那是個真的 bug，而且不只影響這件事——跨行寫的 TOC 標題與 metadata 讀回來一直夾著 `\r`。

這件事本身就是這個決定的最好註腳：**兩套走訪會不會分岔，不是靠讀程式碼看得出來的。**

## 沒有選的兩條路

**匯入時預先建一份全書「純文字 ↔ CFI」對照表。** 讓 server 端只做字串操作，不必走樹。問題是那份表是**導出資料**：走訪的 filter 改過一次，全書的索引就要重建，而沒有東西會告訴你該重建。症狀是筆記錨到隔壁那一段——跟這個 ADR 要防的病一模一樣，只是換了位置發作。它之後可以當**快取**存在（Workers 的 CPU 不免費）：快取算錯了丟掉重算，第二份真相算錯了會被當成事實。順序不能反。

**讓 `Renderer` 在 headless DOM 上跑。** 引入一個 DOM 實作，整層照跑。它買不到東西：定位不需要排版，而真的需要排版的（分頁、矩形）headless DOM 也給不了——那要真的 layout engine。代價卻是 `src/` 多一個出貨相依，而零相依是靠三道機制守著的（AGENTS.md）。

## 順帶長出來的：`RenderLocation.pageRange`

下沉之後，消費端可以把一個 CFI 變回文字了。但**「現在這一屏涵蓋到哪裡」還是只有 `Renderer` 知道**——頁是版面的產物（CONTEXT.md），它隨 viewport 與字級改變，而那些數字只有渲染的那一邊握著。

所以 `relocate` 多帶一個 `pageRange`：涵蓋當前頁的 range CFI。它**在頁還在螢幕上的時候**才是可知的事實，過了就算不回來，所以是每次都吐出來，不是提供一個方法讓人事後問。

`cfi` 與 `pageRange` 回答的是不同的問題，這條界線值得寫進 CONTEXT.md：一個是**點**（讀者在哪），一個是**範圍**（讀者看得到什麼）。
