# frond

## 跑東西一律走 `npm run`

`package.json` 的 `scripts` 是這個 repo 唯一的指令入口。**不要直接叫 `npx`、
`node_modules/.bin/` 或工具的裸執行檔**——版本、flag 與路徑都釘在 script 裡，繞過
去就等於在本機跑一套與 CI 不同的設定，而差異只會在 CI 紅燈時才被發現。

需要縮小範圍時用 npm 的 `--` 傳參，而不是換一支指令：

```
npm run test:node -- tests/node/test-fixtures/vehicles.test.ts
npm run test:node -- -t "EPUB 2 的載體"
npm run test:browser -- --project=firefox
```

現有的入口：`typecheck`、`test:node`（Vitest／Node）、`test:browser`
（Playwright／三家瀏覽器）、`test:container`（在容器裡跑瀏覽器那半邊）、
`fixtures`（重新產生合成 fixture）。需要新的跑法時**加一支 script**，別在文件或
提交訊息裡留一行裸指令。

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in `yurenju/frond`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, used verbatim as label strings. See `docs/agents/triage-labels.md`.

### Pull requests

PR 說明要用 closing keyword（`Closes #<n>`）關掉它做的那張票——阻塞邊看的是 issue 開不開，漏掉會讓後面的票被假性擋住。另外 frond 的正確性有一部分只有畫面看得出來，所以 PR 說明要放渲染結果的截圖。兩者的做法與限制見 `docs/agents/pull-requests.md`。

### Domain docs

Single-context — one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
