# foliate-js 直排 spike（#7）

把 foliate-js 放進 frond 的測試映像，用直排 fixture 在 Chromium / Firefox / WebKit 各跑一次，量下數字與截圖。

**結論在 `docs/browser-quirks.md`**，截圖在 `docs/evidence/7/`。這裡只放「怎麼把那些數字再量一次」。

## 這不是測試套件的一部分

- 不在 `playwright.config.ts` 的 `testDir` 內，`npm run test:container` 不會跑到它。
- CI 不跑它。它需要 foliate-js 的原始碼，而**foliate-js 不進 repo、不進 dependency、不進 bundle**（ADR-0001）——frond 要的是它的瀏覽器 quirk 知識，不是它的程式碼。
- 因此它會過期。等 `Renderer` 有了真正的測試，這個目錄可以刪掉；留著的唯一理由是讓 `browser-quirks.md` 裡的數字可以被重新量、被否證。

## 跑之前要放三樣東西進來

三樣都被 `.gitignore` 擋著，不會進 repo：

```bash
cd spike/foliate-vertical

# 1. foliate-js 的原始碼，釘死在量測當時的 commit
gh api repos/johnfactotum/foliate-js/tarball/78914aef4466eb960965702401634c2cb348e9b1 \
  | tar xz
mv johnfactotum-foliate-js-* foliate

# 2. 直排 fixture（#6 產的健康對照組）
cp ../../tests/fixtures/vertical-japanese.epub book.epub

# 3. 橫排 fixture。foliate 對「頁首分欄斷點」的補償註記為橫排限定，
#    直排的 fixture 量不到它
cp ../../tests/fixtures/huge-single-section.epub book-horizontal.epub
```

commit 要釘死。foliate 官方明說 API 隨時會變，浮動的 `main` 會讓「量到的是哪一版」這件事無法回答，而 `browser-quirks.md` 的每一條都以那一版的行號指路。

**取原始碼的網域可能被出口白名單擋住。** `gh api` 走 `api.github.com`，通常是通的；`codeload.github.com` 不一定。擋住時見機器的 egress 流程，不要在這裡重試。

## 跑

在測試映像內跑，理由與其他測試相同（`docs/test-environment.md`）：分頁是字型的函數，本機的字型解析與映像不同，量到的數字就不可比。

```bash
docker build --tag frond-test .          # repo root，或直接沿用既有映像
docker run --rm --init --network=none \
  --volume "$PWD/spike/foliate-vertical:/work/spike" \
  --workdir /work frond-test node /work/spike/run.mjs
```

`--volume` 掛在 `/work/spike` 而不是 `/spike`：`run.mjs` 從 `/work/node_modules` 解析 `@playwright/test` 與 `pngjs`，掛在 repo 根目錄以外的地方會找不到套件。

`--network=none` 是刻意的。腳本自己在 `127.0.0.1:8731` 起一個靜態伺服器餵頁面——容器的 loopback 在 `--network=none` 下仍然存在，而關掉外部網路可以保證量到的東西不依賴任何外部連線。

結果寫在 `out/`：`results.json` 是全部的數字，其餘是截圖。

## 量了什麼

| 分組 | 內容 |
| --- | --- |
| `layout` | 書自己的樣式下的 writing-mode、欄寬、頁數、字元與行的推進方向、CFI、fraction |
| `navigation` | 翻到書末再翻回來，CFI 與 fraction 是否回到起點 |
| `pageInk` | 讀者字級 64px 下逐頁的墨水像素數——頁數在三家不同時，這是分辨「多出來那頁有沒有字」的唯一辦法 |
| `fullStop` / `fullStopForced` | 一個 `。` 的字面方框，以及同一家瀏覽器內強制 `font-feature-settings: "vert" 1` 的對照 |
| `probes.*` | 針對 `paginator.js` 個別補丁的探針，見下 |
| `horizontal` | 橫排 fixture 的同一組量測，加上 `contentStart` |

`probes` 底下每一支都對著 `browser-quirks.md`〈foliate-js `paginator.js` 的十二處瀏覽器補丁〉表一的某一列：

- `sandboxWithScripts` / `sandboxWithoutScripts` — WebKit bug 218086
- `hiddenComputedStyle` — Firefox 在 `display: none` 的 iframe 上讀 computed style
- `resizeObserver` — Firefox 的 ResizeObserver 失效
- `styleReadTiming` — Chromium 讀背景色需要隔一個 frame
- `boundingRect` / `boundingRectMultiColumn` — Firefox 的 `getBoundingClientRect` 漏掉零寬 rect
- `multiColumnLayout` / `horizontal.contentStart` — WebKit 限定的起始分欄位移
- `lineBoxContain` — `-webkit-line-box-contain` 這條繞法自己的副作用（介入實驗）

**探針回報的欄位裡有「前提條件」，不要只看結論。** 例如 `boundingRect.zeroWidthRectsSeen` 為 0 的意思是「這份文件從頭到尾沒有產生零寬非零高的 rect」，也就是探針根本沒踩到條件——那不等於「Firefox 沒有這個 bug」。分不清這兩件事，會把「沒驗到」寫成「驗過沒問題」。

## Attribution

foliate-js 由 John Factotum 撰寫，MIT License。這個 spike 讀它的原始碼、跑它的程式，產出的是對瀏覽器行為的量測；`docs/browser-quirks.md` 裡凡是引用其註解或行號之處都標了出處。
