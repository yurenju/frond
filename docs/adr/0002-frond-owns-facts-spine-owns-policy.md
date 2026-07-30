# frond 擁有事實，spine 擁有政策

frond 負責「這本書在這個 viewport 下是什麼樣子、現在在哪裡」——解析、分頁、定位、直排幾何、資源解析、TOC href 解析。spine（或任何上層）負責「使用者怎麼操作它」——手勢、點擊分區、UI、同步。frond 只吐**事實**（`direction: 'rtl'`、`writingMode: 'vertical-rl'`、`fraction: 0.37`），不做任何互動決策。

這條線不是設計出來的，是 spine 在 epub.js 上流血流出來的。spine 的 `src/lib/` 有一半是在跟 library 打架的補丁，而每一個補丁都指向同一件事：責任該在 library 這邊，卻漏到了應用層。

| spine 的補丁 | 修的是什麼 |
| --- | --- |
| `vertical.ts` `detectVerticalBook` | epub.js 只讀 `<html>` 的 writing-mode，InDesign 書宣告在 `<body>` |
| `vertical.ts` `SCROLL_EPSILON = 4` | 分數 DPI 下 scrollTop 湊不滿，section 邊界永遠跨不過去 |
| `vertical-layout.ts` `verticalColumnCss` | column-width 必須等於一個 viewer 高且需 `Math.floor`，分數像素會讓分頁崩掉 |
| `vertical-layout.ts` `zeroBodyPadding` | 用 MutationObserver 持續對抗 epub.js 每次 relayout 塞回的 inline `!important` padding |
| `toc.ts` `resolveSpineHref` | nav href 把 `,` percent-encode 成 `%2c`，`spine.get` 對不到，點 TOC 靜默無反應 |
| `scrubber-epub.ts` `normalizeHref` | TOC href 的 `../` 前綴對不上 spine href |
| `navigator-port.ts` | 整檔存在的理由就是 epub.js 的 API 形狀不能直接用；`manager.container`、`manager.layout.delta` 全靠 `as unknown as` 穿透私有內部 |

最硬的旁證是 `resolveSpineHref` 與 `normalizeHref` ——「把 TOC href 解析到 spine section」這一件事，在同一個 repo 裡被獨立實作了兩次、解的還是不同病症、彼此不知道對方存在。這就是責任沒收進 library 的代價。上表所有項目都屬於 frond。

## Consequences

**`RenditionPort` 這個 interface 應該消失。** 它存在的唯一理由是「epub.js 的 API 不是我要的形狀，所以在外面再包一層」。frond 從第一天就長成上層要的形狀，就不需要這層轉接——**frond 自己就是那個 port**。`navigator-port.ts` 的 interface 可直接當作 frond 公開 API 的第一版草稿：它是被真實需求逼出來的，比白紙上的設計準。

**frond 必須自己提供 fake / in-memory 實作，並視為公開 API 的一部分。** `RenditionPort` 的另一半價值是「可用 fake 做單元測試」，這個好處不能隨著 port 消失而消失。上層測試 Navigator 這類純決策模組時，不該自己造假物。

**明確拒絕：frond 不吃手勢。** 直排時「往左滑 = 下一頁」看似 library 該知道的事，其實不是。frond 該說的是「這本書是 rtl」這個事實，上層該決定的是「所以左滑等於 next」這個政策。一旦 frond 開始吃 swipe/tap，它就得知道點擊分區、選字中不翻頁、連結優先——那些是產品決策，會把 frond 綁死在單一 UI 上。

## React 層的政策

`@yurenju/frond-react`（ADR-0011）提供 `useKeyboardPaging()` 與 `useSwipePaging()`，也就是這份 ADR 上面那一段拒絕的東西。這**不是**推翻它，因為兩者劃的線不在同一個地方。

上面拒絕的是「**核心層**去吃手勢」。理由有兩層：一是那些是產品決策，二是**一旦吃了就不可能不吃**——`Renderer` 沒有辦法只做一半，它得同時知道點擊分區、選字中不翻頁、連結優先，而每一項都是一個把它綁死在單一 UI 上的決定。

React 層不同，因為它有一個核心層沒有的東西：**import 是顯式的**。那兩個 hook 不在任何零件裡面，`Root` 也不會偷偷叫它們——沒有叫它們的 reader 一個手勢都不吃，與直接用 `Renderer` 完全相同。不同意它們的規則就別叫，自己接 `useReader()` 的 `next()` / `previous()`。

換句話說，這份 ADR 真正要守的性質是「**政策不會被強加**」，而不是「政策不准有預設值」。核心層做不到前者的唯一方式是後者（沒有辦法「只在某些消費端」關掉 `Renderer` 裡的手勢處理），React 層則做得到。

還有一件事這樣分是對的：**手勢的推論需要事實，而事實在核心層是分開送的**。`Renderer` 送的是 `pointerdown` 與 `pointerup` 兩個獨立的事實（各自帶座標、`hasSelection`、`isLink`），「這是一次往左滑，所以是下一頁」的推論在 `paging.ts` 完成。核心層仍然沒有配對過任何一組 down／up。

界線因此可以寫成一句：**核心層只送事實；預設政策可以有，但要 import 才生效，而且實作要短到可以整段抄走改。**

## 修訂（2026-07-30）：前提換成「主要服務 spine」，而界線不變

**這一節推翻的是這份 ADR 的前提，不是它的結論。** 上面的原文保留。

原本的前提是「frond 不只服務 spine」（ADR-0008 寫得最明白，並用它拒絕併入 spine 的
monorepo）。現在的前提是：**frond 開源、MIT、繼續發 npm，但它的目的就是服務 spine**。
別人要用歡迎，不承諾相容性。

問題是上面那段拒收手勢的理由**靠的正是被抽掉的那根柱子**——原文寫「會把 frond 綁死
在單一 UI 上」，可是如果 frond 本來就是為單一 UI 而做，綁死就不再是代價。所以拒收這
條線要留下來，得換一個不依賴「有其他消費端」的理由。

### 拒收 UI 政策的新理由

**一、產品表面沒有邊界。** `Renderer` 沒有辦法只吃一半：接了 swipe 就得同時知道點擊
分區、選字中不翻頁、連結優先，接著是長按、雙擊、慣性、邊緣回彈。這串東西沒有天然的
盡頭，而 frond **無從得知 spine 對每一項的答案**——這件事跟消費端有幾個無關。原文
第 31 行的第二層理由本來就是這個，現在把它升為主理由。

**二、測試金字塔。** ADR-0005 的雙層切分（`EpubBook` 純 TypeScript、零 DOM）是解析層
能在 Node 裡測的前提。UI 政策一旦進核心層，pointer 語意就被拖進解析層那一側。反向也
成立：spine 的 `navigator.ts` 之所以能用一個兩方法的 fake 做單元測試，正是因為翻頁**決策**
不在 frond 裡；沉下去之後 spine 那些測試只能改成開瀏覽器。

### 逃生閥：先問「痛的原因是什麼」

「這件 UI 的事在 spine 做很痛，是不是該搬進 frond」——這個問題會反覆出現，而且方向
是單向的，因為「放在 frond 裡比較方便」幾乎永遠成立。判準是問**痛的原因**：

| 痛的原因 | 修法 |
| --- | --- |
| spine 拿不到只有 frond 知道的事實 | **frond 補上那個事實**，決定權留在 spine |
| 這件事本身就繁瑣（很多情境、很多例外） | **留在 spine**。繁瑣不是搬家的理由 |

這條規則只能讓 frond 的 API 變豐富，不能讓政策往下沉——這是刻意的。它跟 ADR-0003
的介入門檻是同一個形狀：那邊「書醜不是介入理由」，這邊「繁瑣不是搬家理由」。

**section 邊界穿越就是第一類的範例，而且是這份 ADR 自己的歷史。** 當年 spine 要處理
「這一節讀完了、該翻到下一節」，痛的原因是它得讀 frond 內部的捲動幾何——那就是
`RenditionPort` 整層存在的理由。修法不是把翻頁交給 frond，而是讓 `next()` / `previous()`
自己走到隔壁 section。frond 多做完一件它本來就知道的事，「往左滑等於 next」仍然在
spine，而整層轉接消失了。

### 〈React 層的政策〉那一節作廢

`@yurenju/frond-react` 收掉了（見 ADR-0008 的修訂、ADR-0011 已 superseded），所以上面
第 27–39 行整節不再適用。連帶的後果是**核心層的拒收變成絕對的**：frond 裡不再有任何
一層可以擺「要 import 才生效的預設政策」，`useSwipePaging()` / `useKeyboardPaging()` 那
種東西沒有落點了。

理由是那節的前提也垮了：一套 unstyled React 元件的價值在於「給別的消費端方便」，而
唯一的消費端 spine 從來沒用它——1137 行沒有真實使用者在守，而它的 `paging.ts` 跟 spine
的 `navigator.ts` + `touch.ts` 是同一件事的兩份實作。兩份實作會漂，而且不會有人發現，
因為只有一份被跑到。

### 事實清單補一項：這本書是簡體還是繁體

`spine` 的 `chinese.ts` / `epub.ts` 現在自己做三件事：從 `readingOrder` 取前 N 字散文、
剝掉標籤、數簡繁對照表猜變體，最後挑字型堆疊。前兩件搬進 frond，第三件留在 spine。

切在這裡的理由是老的那條線：「這本書是簡體還是繁體」跟 frond 已經在吐的
`direction: 'rtl'`、`writingMode: 'vertical-rl'` 是同一類東西，而「所以要用
`'Noto Serif TC', 'PMingLiU', …`」是平台與產品的選擇。ADR-0003 的 0.5.0 修訂已經把後者
判給讀者設定（`genericFamilies`），這裡只是把前者收回來。

**推測也算事實，只要誠實回報不確定。** `detectVariant` 在沒有信號時回 `null`，這與
`detectVerticalBook` 讀 `<body>` 還是 `<html>` 的 writing-mode 同屬一類：都是推論，都是
frond 該做的推論。
