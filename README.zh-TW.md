# frond

TypeScript 的 EPUB 渲染函式庫。直排與橫排並重，每一項排版行為都在 Chromium、
Firefox 與 WebKit 上實證驗證過。

[English](README.md)

![frond 排出來的直排中文書](docs/images/demo-read.png)

**[拿你自己的 EPUB 試試看 →](https://yurenju.github.io/frond/)**
拖一個檔案進去就能讀，或者切到檢查分頁，看 frond 從你的書裡讀到了什麼。整個流程
跑在那個分頁裡——frond 沒有任何下載或上傳的程式碼路徑。

## 安裝

```bash
npm install @yurenju/frond
```

你拿到的是純 ES module 加上 `.d.ts`——你這邊不需要建置步驟，也不需要有
TypeScript。

## 現況：0.x，而且 API 會動

`0.x` 就是 semver 定義的那個意思：**什麼都不保證**。frond 的 API 還在動，一個
minor 就可能弄壞你——釘死版本，升之前先看
[release notes](https://github.com/yurenju/frond/releases)。至於這樣還發 npm 的
理由，見 [ADR-0008](docs/adr/0008-distribution-and-license.md)。

## 零執行期相依

frond 不帶任何相依。不是「很少」，是零。解壓、XML 解析、CFI 與分頁都是自己的
程式碼，蓋在平台 API 上（`DecompressionStream`、`DOMParser`、blob URL、
`ResizeObserver`）。

有一個後果值得明說：**產物裡一個 bare specifier 都沒有，所以瀏覽器可以直接
import 它。** 不需要打包器、不需要建置步驟、不需要 import map。

```html
<div id="viewer" style="height: 100dvh"></div>

<script type="module">
  import { EpubBook } from "./frond/epub/index.js";
  import { Renderer } from "./frond/renderer/index.js";

  const book = await EpubBook.open(await file.arrayBuffer());
  const renderer = await Renderer.attach(book, document.getElementById("viewer"), {
    settings: { fontSize: 20, margin: 32 },
    on: {
      relocate: (at) => console.log(at.page + 1, "/", at.pageCount, at.cfi),
    },
  });

  await renderer.next();
</script>
```

展示站就是這段程式碼的完整版，見 [`site/app.js`](site/app.js)。它不是一份放在
資料夾裡慢慢腐爛的範例——每次推上 `main` 都會重新部署一次。

## 兩層

frond 切成兩層，任一半都可以單獨使用。

| 進入點 | 要 DOM 嗎 | 給你什麼 |
| --- | --- | --- |
| `@yurenju/frond/epub` | 不要 | `EpubBook.open(bytes)` → metadata、readingOrder、TOC、封面、manifest 的資源、依路徑取位元組。另有 CFI 的解析、序列化與比較。 |
| `@yurenju/frond/renderer` | 要 | `Renderer.attach(book, element)` → 翻頁、跳節、讀者設定、書寫方向、CFI 與位置互轉、有型別的事件。 |

`EpubBook` 零 DOM 依賴，所以它在 Node 裡跑得動——解析層的測試不必開瀏覽器。
展示站的檢查分頁整個就是只用這一半做出來的：

![檢查分頁列出 frond 從一本書讀到的事實](docs/images/demo-inspect.png)

`Renderer` **不收 `EpubBook`**，它收的是一個窄介面 `RenderableBook`，而
`EpubBook` 剛好滿足它。`MemoryBook` 是那個介面的 in-memory 實作，而且**刻意
放在公開 API 上**：你要測「收到 frond 的事件之後 UI 該怎麼變」時，不該被迫自己
造一本假書。

事件是有型別的 emitter，不是 DOM 的 `CustomEvent`：

```ts
const stop = renderer.on("relocate", (at) => {
  //                                   ^? RenderLocation，不是 any
  progress.value = at.fraction ?? 0;
});
```

### iframe 裡的輸入

一節渲染在一個 iframe 裡，而 iframe 的邊界擋住事件冒泡——掛在你的容器上的
listener 一個事件都收不到。frond 把原始的事實送出來：指標在哪裡按下、放開，座標
是**容器座標系**，外加兩個你原本得伸手進文件裡才問得到的條件。

```ts
renderer.on("pointerup", (e) => {
  if (e.hasSelection || e.isLink) return; // 讀者正在選字，或點到了連結
  if (e.x > e.width * 0.7) turn("forward"); // 點擊分區是你的決定，不是 frond 的
});

renderer.on("keyup", (e) => {
  if (e.key === "ArrowLeft") turn(book.metadata.pageProgressionDirection === "rtl" ? "forward" : "back");
});
```

`pointerdown` / `pointerup` / `keydown` / `keyup` 刻意是原始的。frond 不配對
down 與 up、不量滑動距離、不決定某個區域的一次點擊是什麼意思——那是手勢開始的
地方，而手勢是你的。

### 從上次讀到的地方開書

```ts
const renderer = await Renderer.attach(book, element, {
  start: { cfi: saved.cfi }, // 或 { sectionIndex, fragment }
  settings: { margin: { block: 16, inline: 64 } },
});
```

`start` 直接渲染對的那一節，而不是先排第 0 節再跳——一次掛載，不是兩次。它收
CFI 或節，不收 fraction：全書進度要有字元索引才算得出來，而那是**第一頁上了畫面
之後**才在背景建的。

`margin` 收一個數字（四邊等距）或 `{ block, inline }`，依那一節實際排出來的書寫
方向解析。行內軸是控制行長的那一軸——橫排是左右，直排**是上下**。

### 只查詢，不跳

`goToFraction(f)` 會跳過去。`locate(f)` 只回答「那裡是哪一節」——定位軸拖曳中要
的正是它，因為讀者還沒放開手：

```ts
const at = renderer.locate(0.42); // 索引建好之前是 undefined
label.textContent = at ? chapterTitleFor(at.sectionPath) : "";
```

## frond 不做什麼

這一節是 README 裡最誠實的部分。底下多數是決定，不是缺口。

- **不吃手勢。** `next()` 與 `previous()` 是動作，不是事件處理器。往左滑算不算
  往前，取決於書的頁面推進方向與你的產品；frond 給事實，決定權在你。它**會**把
  原始的指標與按鍵事件送出 iframe，因為那是你唯一拿得到它們的路——但配對、門檻
  與點擊分區留在你那一側。
- **不下載任何東西。** `EpubBook.open()` 收的是位元組。書裡宣告的遠端資源會被
  如實回報成遠端，然後放著不動。
- **不自己跳連結。** 讀者點了書裡的連結，frond 送一個事件說那個連結指向哪裡。
  要不要跳過去是你的決定。
- **不回報全書頁數。** 頁是 viewport 與讀者字級的產物，不是書的性質。frond 只
  回報「這一節共幾頁、現在第幾頁」，跨書的位置用 0 到 1 的 fraction。
- **不跑書裡的腳本。** `<script>` 與 `on*` 屬性在文件還是文字的時候就被拿掉了。
  EPUB 3 允許 scripted content，frond 拒絕它是**安全決策而不是還沒做**
  （[ADR-0006](docs/adr/0006-iframe-isolation-no-scripted-content.md)）。
- **不解 DRM**，以後也不會。
- **不做書櫃。** 書架、收藏、同步都是你的事。
- **只做 EPUB。** 沒有 MOBI、FB2、CBZ、PDF。這正是為什麼 `EpubBook` 是一個具體
  型別，而不是一層跨格式的抽象。

## 支援邊界

EPUB 3 與 EPUB 2 都支援，而且**在現實不分版本的地方 frond 就不分版本**：用
EPUB 2 那種寫法宣告的封面，在 EPUB 3 的書上照樣找得到——因為實際流通的書就長
那樣。

書沒說的時候，frond 回報「書沒說」而不是塞一個預設值進去。EPUB 2 沒有頁面推進
方向這個屬性，所以每一本 EPUB 2 的 `metadata.pageProgressionDirection` 都是
`undefined`——那與「書宣告了 `ltr`」是兩件事，而怎麼處置由你決定。細節見
[ADR-0010](docs/adr/0010-epub-2-support-boundary.md)。

壓縮檔那一層不支援：ZIP64、加密項目，以及 stored 與 deflate 以外的壓縮方法。在
34 本繁中／簡中商業書、3309 個項目的樣本裡，這三種一次都沒有出現。

## 瀏覽器

Chromium、Firefox 與 WebKit **同級對待**——任一家紅就是紅。沒有分 tier，因為這
個函式庫最在乎的那種書寫方向，正好是三家分歧最大的地方。量到的差異逐條記在
[`docs/browser-quirks.md`](docs/browser-quirks.md)。

## 開發

所有指令一律走 `npm run`——版本與 flag 都釘在 script 裡。

```bash
npm run typecheck       # 對 src、scripts 與 tests 跑 tsc --noEmit
npm run test:node       # Vitest——解析層，不開瀏覽器
npm run test:container  # 在測試映像裡跑兩個 runner（瀏覽器只存在於那裡）
npm run build           # 產生 dist/
npm run site            # 建 dist/ 並把展示站組起來
```

瀏覽器測試只在容器裡跑得動：三家引擎與釘死的字型存在於測試映像中，不在你的機器
上。見 [`AGENTS.md`](AGENTS.md)。

## 授權

MIT，見 [LICENSE](LICENSE)。

frond 是重新實作而不是 port，不帶任何第三方程式碼。這個 repo 裡唯一取自上游的
材料是 `tests/node/cfi/foliate-acceptance.test.ts` 的 CFI 驗收表，來自
[foliate-js](https://github.com/johnfactotum/foliate-js)（MIT，Copyright (c)
2022 John Factotum）。見 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
