# 散佈方式與授權

公開 repo、MIT 授權。**發佈到 npm。** repo 本身是一個 workspace，出兩個套件（ADR-0011）：

```
npm install @yurenju/frond          # 核心，零相依
npm install @yurenju/frond-react    # React 元件，peer 相依上面那個與 react
```

**明確拒絕併入 spine 的 monorepo。** frond 的整個設計前提是「它不只服務 spine」（ADR-0002 拒收手勢即為此）。放進同一個 monorepo 會讓這個前提在第一個 sprint 就被侵蝕，因為抄近路會變得太容易。

這與 ADR-0011 那個 workspace 不衝突，因為兩者收的東西不同：**spine 是消費端，frond-react 是出貨面**。前者有自己的領域、自己的正確性標準、自己的發版節奏；後者沒有，它每一次改動都是為了把 frond 已經有的能力接到 React 上。

## 從 git dependency 改成發 npm

**這一節推翻的是這份 ADR 原本的決定**，原文留在下面的〈原本為什麼不發〉。

原本的拒絕建立在一個推論上：發上 npm 等於隱含承諾 semver 與 API 穩定，而 frond 的
API 一定會大改。**那個推論的前半段站不住。** 實際的消費端就是 spine——一個知道
frond 會動、並且跟著一起動的專案。對它而言「API 變了」不是一個要靠發布通道去防的
意外，是一次可以排進去的工作。而 `0.x` 這個主版號本身就是 semver 定義的「什麼都不
保證」，它在 npm 上與在 git tag 上說的是同一句話。

換句話說，原本擔心的那個承諾**沒有真的被 npm 加上去**，被加上去的是別的東西：一個
不必解釋的安裝指令、一個可以被 `npm outdated` 看見的版本、以及 registry 這一層的
不可變性（同一個版本號永遠是同一份位元組，而 git tag 是可以被重新指向的）。

代價則有一項要記住：**npm 上的版本收不回來**（只有 72 小時的 unpublish 窗口，而且
撤掉會弄壞已經裝了的人）。git tag 打錯可以刪掉重打，npm 版本不行——這是 release 流
程裡把驗證全部放在 `npm publish` 之前的理由。

### 為什麼是 scoped 名字

`frond` 這個名字在 npm 上已經被佔用（`jpike` 的一個 argument forwarding 函式庫，
最後一次發布是 2016 年）。scoped 名字不需要跟任何人搶，也不會有哪天名字被回收的
問題，代價只是消費端的 import 多一個前綴。

### 出貨面

兩個套件的出貨產物都是各自的 `dist/`（ES module 加 `.d.ts`）。

`@yurenju/frond` 的 `exports` 只開 `./epub` 與 `./renderer` 兩個 subpath，不開根路
徑：那強迫消費端選一層，而那正是 ADR-0005 那一刀的意思。`./test-fixtures` 不在出貨
面上——它相依 `node:fs`，是我們產合成 fixture 的工具，不是消費端的東西。

`@yurenju/frond-react` 相反，開的是根路徑（`import * as Reader from "@yurenju/frond-react"`）
加上一個 `./styles.css`。它沒有需要強迫消費端做的選擇——ADR-0005 那一刀已經在下面
那一層做過了。

`src/` 也進兩個 tarball，但**不在 `exports` 上**，所以它不是 API 的一部分。它在那裡
只為了一件事：`.js.map` 與 `.d.ts.map` 裡的 `sources` 指著 `../../src/*.ts`，那些檔
案不在包裡的話，消費端「跳到定義」會落在一個不存在的路徑上。git dependency 的年代
`src/` 本來就在，所以這個洞是發 npm 才會開的（`src/test-fixtures` 以 `files` 的
`!` 樣式排除掉，理由同上）。

`THIRD-PARTY-NOTICES.md` **不進任何一個 tarball**（改成 monorepo 之前它在 frond 的
`files` 裡）。npm 的 `files` 搆不到套件目錄以外的東西，而那份文件描述的是整個
repository；每個套件放一份複本的話，會多出一份要跟正本同步的文件。它自己的開頭說明
了為什麼那不是損失：裡面唯一實際取用的材料（foliate 的 CFI 驗收表）是**測試材料**，
本來就不在出貨面上。`LICENSE` 則相反，每個套件目錄各有一份——npm 只從套件目錄收它。

版本號從 `0.1.0` 起算，**兩個套件同版號一起發**，每次發布打一個 `vX.Y.Z` 的 git
tag。同版號不是為了整齊：frond-react 沒有獨立的 API 演進，它每一版都是為了接上
frond 的某一版，而讓兩個號碼可以錯開，等於製造一個「哪一組版本可以搭」的表格，然後
要求每一個消費端去查它。發版時 frond-react 對 frond 的 peer 相依範圍會被一併改寫成
剛發出去的那一版。

發布由 `.github/workflows/release.yml` 做，認證走 npm 的 trusted publishing
（OIDC），所以 repo 裡不存任何 npm token。**每個套件的第一版都是例外**：trusted
publisher 要掛在一個已經存在的套件上，而 npm 不接受對尚未存在的套件預先設定
（npm/cli#8544），所以每個新套件的第一版得在本機用一顆臨時 token 手動發一次。細節
寫在那份 workflow 的註解裡。

## 原本為什麼不發

以下是這份 ADR 原本的內容，留著是因為它解釋了 `0.1.0` 與 `0.1.1` 那兩個 tag 為什麼
不在 npm 上。

> 暫不發佈 npm——spine 以 git dependency（pin 住 commit）消費 frond，等 API 穩定後
> 再發。
>
> 理由不是技術而是承諾：**發上 npm 等於隱含承諾 semver 與 API 穩定**，而 frond 第
> 一個月的 API 一定會大改（整個專案的前提就是「不確定 foliate 的切法對不對」，那自
> 己也不會第一次就切對）。foliate 正是為了不給這個承諾，至今拒發官方 npm，README
> 直接建議用 git submodule 引入。git dependency 提供同樣的安裝體驗而不附帶那個承
> 諾。
>
> 安裝時由 `prepare` 跑 `npm run build`——npm 為 git dependency 安裝
> devDependencies，所以消費端不需要自己有 TypeScript。

**那條 git dependency 的路在 ADR-0011 之後不通了。** repo 根目錄現在是一個
`private: true` 的 workspace 容器，`npm install github:yurenju/frond#<tag>` 裝到的是
它，而它沒有 `exports`、沒有 `dist/`，也不該有。npm 成了唯一的安裝方式。

代價可以接受，因為上面那次修訂已經把 git dependency 從「建議的安裝方式」降級成「還
走得通的舊路」。`prepare` 也跟著搬家：它現在在根 package.json 上，服務的是「clone
下來之後 `npm install` 就有兩份 `dist/`」這件開發者體驗，不再是任何消費端的安裝路
徑。發版時的建置由 `release.yml` 顯式跑一次，不靠生命週期腳本。

## 展示站

`https://yurenju.github.io/frond/`，由 `main` 的每一次推送重新部署。

**站上不內建任何書，只接使用者自己拖進來的檔案。** 兩個理由：手上那批書有版權
（ADR-0007），而找一本可公開的中文直排書比看起來難；更重要的是，會來看這個站的人
真正想知道的是「**我的**書排得出來嗎」，內建書回答不了那一題。

站的第二個分頁（檢查）只用 `EpubBook`，把 frond 從一本書讀到的事實整個攤開——
EPUB 版本、頁面推進方向、TOC 讀自哪一份導覽文件、封面用哪種寫法宣告、manifest 裡
哪幾項其實不在包裡。那是「拿自己的書評估一個函式庫」時最先想知道的東西，而它剛好
不需要渲染。

首頁沒有建置步驟——`<script type="module">` 直接 import `tsc` emit 出來的檔案。
**這是出貨相依為零的直接後果，也因此站每次部署都在驗證那件事**（`npm run site` 內
含的 `scripts/finish-build.ts` 會在產物出現 bare specifier 時紅燈）。

### 第二頁：frond-react

`site/react/` 展示 `@yurenju/frond-react`，**而且刻意用另一種方式建**：esbuild，零
設定，解析走 node_modules。

兩頁的建置方式不同不是不一致，是它們證明的事不同。frond-react 必然相依 react，於是
它的消費端一定有打包器——所以對它該問的不是「能不能不打包」，是「出貨的那包東西被一
個一般的打包器吃下去跑不跑得動」。把它塞進首頁會讓首頁那句宣稱不再檢查任何東西（頁
面反正已經被打包過了），所以兩頁分開。細節見 ADR-0011 與 `scripts/build-site.sh` 的
檔頭。

兩頁都有「怎麼裝、怎麼用」的說明，也互相連得過去。

## 授權

**授權採 MIT**，與 foliate 一致。frond 會直接取用上游 `tests/epubcfi-tests.js` 的 280 行測試向量作為 CFI 驗收表（ADR-0001），那是實際的程式碼取用；MIT 對 MIT 最乾淨，attribution 照規矩標示。至於瀏覽器 quirk 知識（`docs/browser-quirks.md`）搬運的是知識而非程式碼，與授權無涉。
