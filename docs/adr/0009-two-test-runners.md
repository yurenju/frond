# 兩個 test runner：Vitest 跑 Node，Playwright 跑瀏覽器

`EpubBook` 層（純 TypeScript、零 DOM）用 **Vitest 跑在 Node**。`Renderer` 層的不變量、跨瀏覽器差分、截圖與 agent 視覺判讀用 **Playwright**。

不採用 Vitest browser mode 統一成單一 runner，是因為核心需求是**三瀏覽器矩陣加截圖**，而那是 Playwright 的主場：browser projects、trace viewer、截圖 API 都是原生的。Vitest browser mode 底層同樣驅動 Playwright，但在三家矩陣的設定上多隔一層。

兩個 runner 看似重複，但它們測的東西本質不同（Node vs 瀏覽器），這一刀與 ADR-0005 的 `EpubBook` / `Renderer` 是同一刀——是誠實的切分，不是重複配置。
