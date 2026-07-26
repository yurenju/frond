# 測試環境

frond 的測試一律在容器內執行，**CI 與本機共用同一個映像**。

這不是 CI 的附屬設定，而是跨瀏覽器自我差分能否成立的物理前提（ADR-0004）。差分的 oracle 是 frond 自己：同一本書、同一 viewport、同一組設定在 Chromium / Firefox / WebKit 各跑一次互比，差異即紅燈。若三個環境解析到不同的系統字型，比對出的差異會 100% 是字型差異，真正的 bug 會被埋掉。

同樣的道理讓本機不能直接跑在開發者自己的作業系統上——那會製造「本機綠、CI 紅」這類最消耗人的落差，而落差的原因藏在字型層，極難查。

## 怎麼跑

```bash
./scripts/test-in-container.sh
```

其餘參數會原樣傳給 Playwright：

```bash
./scripts/test-in-container.sh --project=firefox
```

腳本會先建置映像再執行測試。原始碼變動時只有最後一層需要重建，相依層命中 build cache。

### 兩個 runner 都在這裡跑

ADR-0009 把測試切成兩個 runner：`EpubBook` 與其周邊的純 TypeScript 用 **Vitest** 跑 Node（`tests/node/`），`Renderer` 用 **Playwright** 跑三家瀏覽器（`tests/browser/`）。腳本兩個都跑，Node 那半邊先。

Node 測試不依賴字型或瀏覽器，照理可以直接跑在開發者的作業系統上——`npm run test:node` 就是那條捷徑，寫產生器或解析層時值得用。但**「測試全綠」這句話只有一個入口**：CI 與本機都跑同一支腳本、同一個映像、同一組版本。多開一個只在某一邊生效的入口，就是「本機綠、CI 紅」的第一步。

Node 先跑的理由是它蓋的東西被瀏覽器那半邊依賴——例如合成 fixture 的結構。fixture 壞掉時先看到「這不是一本合規的書」，比先看到三家瀏覽器一起紅要好查得多。

## 需要先裝什麼

容器引擎擇一，**建議 rootless podman**：

```bash
apt-get install -y podman uidmap fuse-overlayfs passt slirp4netns
```

為什麼不是 docker：docker 的 socket 等同 host root，要用它就得把使用者加進 `docker` 群組，那等於給出對整台機器的讀寫權。dockerd 另外會自行往 netfilter 插 NAT 與 `DOCKER-USER` 鏈，順序在既有的過濾規則之前，出口管制若有設定就需要重做——而做錯的失敗模式是靜默放行。rootless podman 跑在一般 uid 底下，沒有 daemon 也沒有等同 root 的 socket，且吃同一份 Dockerfile、產出 OCI 映像。

rootless podman 需要 `/etc/subuid` 與 `/etc/subgid` 內有該使用者的從屬 UID 範圍，例如：

```
dev:100000:65536
```

## 映像 build 需要的出口網域

如果環境有出口白名單，build 需要以下網域。runtime 不需要網路——所有測試頁面都由 `page.setContent` 供給，腳本因此以 `--network=none` 執行測試。

| 網域 | 用途 |
| --- | --- |
| `mcr.microsoft.com` | Playwright 官方基底映像 |
| `archive.ubuntu.com` | `fonts-noto-cjk` |
| `security.ubuntu.com` | 同上。noble 的 `ubuntu.sources` 含 security pocket，`apt-get update` 一定會打到它，漏了這個 build 會停在 update 那一步 |
| `registry.npmjs.org` | `npm ci` |

以上是 amd64 的清單。若在 arm64 上建置，Ubuntu 的套件來源會換成 `ports.ubuntu.com`。

基底映像已含三家瀏覽器，Dockerfile 設了 `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`，所以 build 不需要連 `cdn.playwright.dev`。

### proxy 環境的一個坑

映像的 `RUN` 步驟跑在容器自己的 network namespace，**那裡的 `127.0.0.1` 是容器的 loopback，不是外面的 proxy**。若 proxy 設在 `127.0.0.1` 上而不處理，`apt-get` 與 `npm ci` 會直接連不出去，而且錯誤訊息看起來像網域被擋。

`scripts/test-in-container.sh` 偵測到 `HTTPS_PROXY` 時會自動以 `--network=host` 建置並把 proxy 傳成 build args。沒有 proxy 的環境（例如 GitHub Actions）不會加上這些參數。

## 版本為什麼全部釘死

基底映像、Playwright、三家瀏覽器、字型套件都指向明確版本，沒有 floating tag。

理由不是一般的可重現性衛生，而是：**字型更新會改變字形度量，字形度量改變會改變斷行，斷行改變會改變斷頁。** 一次無意的基底映像更新可以讓整批不變量與差分測試同時變色，而變色的原因與 frond 的程式碼無關。這類紅燈若查不出原因，會直接摧毀團隊對測試套件的信任。

升級任何一個版本都要當成一次獨立的變更來做，並預期斷頁相關的數字會動。

## 字型

CJK 字型統一使用 **Noto CJK**（`fonts-noto-cjk`），繁體中文、簡體中文、日文共用同一個家族。各語系混用不同設計的字型會讓三家瀏覽器的 fallback 路徑有機會分歧，而分歧點藏在字型層極難查。

只裝 `fonts-noto-cjk`（regular 與 bold，安裝後約 91 MB），不裝 `fonts-noto-cjk-extra`（其餘字重，再多約 214 MB）。目前沒有 fixture 用到其他字重。

### 一個家族不等於一個字面

因為漢字統一，「骨」「直」這類共用碼位在 TC / SC / JP 有不同字形，Noto CJK 的 OTC 內實際裝著 `Noto Serif CJK TC` / `SC` / `JP` 等多個字面。取到哪一個取決於字面選擇，而字面選擇通常由文件的 `lang` 加上 fontconfig 的語言比對決定——**那正是三家瀏覽器可能各做各的地方**。

`docker/fontconfig/75-frond-cjk.conf` 因此把兩件事都釘死：generic family（`serif` / `sans-serif` / `monospace`）解析到哪個字型，以及區域字面如何依 `lang` 選用。沒宣告 `lang` 的文件預設取 TC。`zh-TW` / `zh-Hant` 與 `zh-CN` / `zh-Hans` 都各自列出，只列一種的話另一種會靜默落回預設。

這份綁定在容器內的 `fc-match` 上完全生效，但**瀏覽器只有 Firefox 完整遵守**——那部分獨立追蹤於 [#4](https://github.com/yurenju/frond/issues/4)。

**順序有兩層，而且方向不一樣。** 第一層是檔名：fontconfig 依檔名順序處理 `/etc/fonts/conf.d/`，後處理的有機會覆蓋先處理的。基底映像的 `60-latin.conf` 與 `fonts-noto-cjk` 套件自帶的 `70-fonts-noto-cjk.conf` 都會動到同一組 generic family，所以編號取 75。不用 70 是因為那會變成靠 `fonts` 與 `frond` 的第五個字母決定勝負。

第二層是檔案內的規則順序，**它與直覺相反**：`mode="prepend"` 不是插到清單最前面，而是插在被 `<test>` 命中的那個值前面，所以後套用的規則排得更後面——**先套用的優先權較高，語言特化必須寫在通則之前**。寫反的症狀很難看出來：通則排在前面時 `serif:lang=ja` 會拿到通則的 TC，而 `serif:lang=zh-tw` 因為跟通則預設值恰好相同，看起來仍然是對的。

副作用要知道：拉丁文字也會落到 Noto CJK 的拉丁字符上。對這個測試環境是可接受的，甚至是想要的——一個字型一個事實來源，三家瀏覽器沒有各自 fallback 的空間。

### 為什麼在 build 就驗證

`docker/verify-fonts.sh` 在建置期用 `fc-match` 斷言上述綁定確實生效，失敗就讓 build 炸掉。

字型綁定失敗的失敗模式是**靜默 fallback**：不會報錯，也不會讓任何斷言變紅，只會讓後續每一個幾何數字都建立在錯的字型上。留給測試抓太晚了。

## 冒煙測試在測什麼

`tests/browser/smoke/` 下的測試不測 frond——frond 還沒有程式碼——而是證明「三家瀏覽器都能在這個容器裡正確排出直排」這個前提成立。

- **行進軸是縱向**：用幾何斷言後續字元排在前一個字元下方。刻意不讀 computed style，因為 computed style 會老實回報 `vertical-rl` 而畫面仍可能是橫的。
- **標點取到直排字符**：句點在直排下應位於字面方框的右上，橫排下位於左下。這條擋掉最惡劣的失敗模式——裝了一套沒有 `vert` / `vrt2` 的字型，DOM 斷言與幾何不變量全數通過，但畫面上的直排標點是錯的。
- **字形選擇的兩條路徑**：漢字的區域字形由 `lang` 驅動（同一字面換 `lang` 會變、不同字面同一 `lang` 不變），標點的位置由字面驅動。這兩條是其他斷言能夠成立的前提。
- **指名字面時的決定性**：同一組輸入重複渲染必須逐像素相同。

冒煙測試**一律指名字面**，不使用 generic family。用 `serif` 的話量到的會是「瀏覽器挑了哪套字型」而不是「這套字型對不對」——三家對 generic family 的 CJK 解析並不一致（[#4](https://github.com/yurenju/frond/issues/4)）。這是測試環境的選擇，不是 frond 的規則：frond 仍然尊重書自己的宣告（ADR-0003）。

這幾條都是結構性斷言，不是 golden 截圖比對。frond 沒有參考實作可以當 oracle，「這個字應該長這樣」的期望值不存在（ADR-0001）。

### 用什麼字來測，比怎麼斷言更關鍵

**漢字不能用來鑑別字面。**「骨」「直」這類漢字統一的代表字，其區域字形是由文件的 `lang` 經 OpenType 的 `locl` 驅動的——同一個字面在 `lang=ja` 與 `lang=zh-TW` 下給出不同字形，而不同字面在同一個 `lang` 下給出相同字形。三家瀏覽器實測一致。

拿漢字去問「解析到哪個字面」，得到的答案永遠是「看不出來」，於是測試會在綁定完全失效的環境下照樣變綠。**標點才有鑑別力**——句點在 JP 與 TC 字面裡的位置不同，且該差異在同一個 `lang` 下依然存在。

## 這些斷言真的有在測東西嗎

**直排標點那條已經被證明有牙齒。** WebKit 在直排下不自動套用 `vert`（見 `browser-quirks.md`），而在還沒加上顯式 `font-feature-settings` 之前，這條斷言就是紅的——句點量到留在左下。也就是說：一旦直排字符沒有生效，這條斷言會紅。那正是它存在的目的。

**還沒跑過的實驗**：把 Dockerfile 的 `fonts-noto-cjk` 換成一套完全沒有 `vert` / `vrt2` 的 CJK 字型，預期同一條斷言也會紅。上面那次是「特性沒被套用」，這個實驗是「字型根本沒有這個特性」，兩者路徑不同，值得補驗。

**字型綁定的部分由 build 期擋。** 移除 `COPY docker/fontconfig/75-frond-cjk.conf` 那一層，`docker/verify-fonts.sh` 會在 build 就失敗——這一條實際發生過：規則順序寫反時，`serif:lang=ja` 解析到 TC，build 直接中止。
