# API 形狀：具體 class、雙層切分、typed emitter

frond 的公開 API 是**純 class / factory，接收一個容器元素**（epub.js `renderTo()` 的形狀），不是自訂元素（foliate `<foliate-view>` 的形狀）。

三個理由：

1. ADR-0002 已定調「frond 自己就是那個 port」。port 是一個 interface，不是 DOM 元素。做成自訂元素等於把 API 表面塞進 attribute 與 CustomEvent，而 `CustomEvent.detail` 在 TypeScript 裡是 `any`——會失去這個專案存在的一半理由。
2. 測試。class 可直接 `new` 出來、注入 fake、在 Node 裡跑解析層測試；自訂元素要走註冊與 upgrade 流程，`connectedCallback` 的時機是 timing bug 溫床，而測試金字塔底層本就不該開瀏覽器。
3. 方向性。日後要在外面包一層 `<frond-view>` 很薄很容易，反過來從自訂元素退回 class 很痛。

事件用 **typed emitter**（`on('relocate', e => …)`，`e` 有型別）而非 DOM `EventTarget`，理由同第 1 點。

## 雙層切分

```
EpubBook   純 TypeScript，零 DOM 依賴
           解壓、OPF/NCX 解析、TOC、資源解析、CFI
           → 在 Node 裡跑，對應測試金字塔底層

Renderer   需要 DOM
           iframe 管理、分頁、直排幾何、讀者設定、CFI range 的矩形
           → headless browser，對應測試金字塔中層
```

這一刀是抄 foliate 的——它把 book interface 與 renderer interface 分開是對的，該抄。它**錯**的地方是為了讓 MOBI / FB2 / CBZ / PDF 共用而把 book 抽象成 interface；frond 只做 EPUB，因此 `EpubBook` 是具體型別，不需要那層抽象。

這正是「foliate 的切法對我們不一定最好」的具體實例：對的部分留下，為多格式付的抽象稅不必付。切分本身也直接決定了測試金字塔的分層邊界——底層測試之所以能不開瀏覽器，是因為 `EpubBook` 零 DOM 依賴。
