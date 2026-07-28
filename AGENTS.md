# frond

## 這是一個 workspace，兩個套件

```
packages/frond/         @yurenju/frond         核心，零相依（ADR-0005）
packages/frond-react/   @yurenju/frond-react   unstyled React 元件（ADR-0011）
```

`tests/`、`scripts/`、`site/`、`docs/` 在根目錄，**兩個 test runner 也在根目錄**
——ADR-0009 那一刀切的是 Node 與瀏覽器，不是套件，所以它沒有變成四個。

改動落在哪個套件會決定一件事：`packages/frond` 的**出貨相依必須是零**，而那不是
靠 review 守的，三道機制寫在 ADR-0011。在那底下加一個 npm 相依，紅的是
`npm run build`。

## 跑東西一律走 `npm run`

根 `package.json` 的 `scripts` 是這個 repo 唯一的指令入口。**不要直接叫 `npx`、
`node_modules/.bin/` 或工具的裸執行檔**——版本、flag 與路徑都釘在 script 裡，繞過
去就等於在本機跑一套與 CI 不同的設定，而差異只會在 CI 紅燈時才被發現。

**一律從根目錄跑。** 套件底下那幾支 `build` 是給根目錄的 script 叫的，不是入口
——單獨跑 `npm run build -w @yurenju/frond-react` 而沒先建 frond，會紅在一個看起來
像型別錯誤的地方（它解析的是 frond 出貨的 `.d.ts`）。

需要縮小範圍時用 npm 的 `--` 傳參，而不是換一支指令：

```
npm run test:node -- tests/node/test-fixtures/vehicles.test.ts
npm run test:node -- -t "EPUB 2 的載體"
npm run test:container -- --project=firefox
```

現有的入口：`typecheck`、`test:node`（Vitest／Node）、`test:container`（容器內，
兩個 runner 都跑）、`test:browser`（Playwright／三家瀏覽器，**只在容器內跑得
動**，見下）、`evidence`（在容器裡產 PR 用的截圖，見
`docs/agents/pull-requests.md`）、`fixtures`（重新產生合成 fixture）、
`scan:books`（拿一批實際流通的書跑一趟渲染，見下）。需要新的跑法時**加一支
script**，別在文件或提交訊息裡留一行裸指令。

### 找「合成 fixture 上全綠、書上壞掉」的那類缺陷：`scan:books`

```
FROND_BOOKS=/path/to/books npm run scan:books -- tests/browser/evidence/<名字>.spec.ts
```

書由 `FROND_BOOKS` **唯讀掛進**測試容器（掛在 `tests/books/commercial`，已
gitignore），不進 build context 也不落在 repo 樹裡——那些書有版權（ADR-0007）。

這一趟的產出是**病症清單，不是紅綠燈**：找到的每一項要各自變成一份合成 fixture
與一組測試，回歸才守得住。上一次跑的結果與它抓到的三個病記在 ADR-0007 的〈第三層
跑過一趟了〉。掃描用的 spec 是一次性的，放 `tests/browser/evidence/`，不留在 repo。

跟容器講話的那一段（挑引擎、確認連得到、建置）收在 `scripts/container.sh`，由
上面兩支 source。要再加一種容器跑法就 source 它，不要複製那段判斷——兩份對
rootless socket 的診斷遲早會漂開。

### 瀏覽器測試走 `test:container`，不是 `test:browser`

三家瀏覽器只存在於測試映像裡（`Dockerfile` 設了
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`，本機的 `node_modules` 不會有它們）。所以
在 host 上直接跑 `npm run test:browser` 會得到：

```
browserType.launch: Executable doesn't exist at ~/.cache/ms-playwright/...
```

**那不是「這台機器不能跑瀏覽器測試」，是跑錯入口了。** 這個誤判的代價是整批
瀏覽器測試被當成跑不了而略過，而略過不會有任何東西變紅。正確的入口是
`npm run test:container`，它會建好映像、在裡面先跑 Vitest 再跑 Playwright。

`test:browser` 留著是因為它是容器內實際執行的那一支。要在 host 上跑它，得自己
備妥瀏覽器，而那條路會偏離 CI 的字型與版本——不建議（見
`docs/test-environment.md`）。

引擎連不到時腳本會**先診斷再退出**，並把修法印出來（rootless docker 常見的那一
格是 client 還指著 rootful 的 socket，修法是 `docker context use rootless`）。
照它印的做，不要自己去猜 socket 在哪。

## Agent skills

### Issue tracker

Issues and PRDs live as GitHub issues in `yurenju/frond`, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, used verbatim as label strings. See `docs/agents/triage-labels.md`.

### Pull requests

PR 說明要用 closing keyword（`Closes #<n>`）關掉它做的那張票——阻塞邊看的是 issue 開不開，漏掉會讓後面的票被假性擋住。另外 frond 的正確性有一部分只有畫面看得出來，所以 PR 說明要放渲染結果的截圖。兩者的做法與限制見 `docs/agents/pull-requests.md`。

### Domain docs

Single-context — one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
