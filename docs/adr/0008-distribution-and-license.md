# 散佈方式與授權

公開 repo、MIT 授權。**發佈到 npm，套件名 `@yurenju/frond`。**

```
npm install @yurenju/frond
```

**明確拒絕併入 spine 的 monorepo。** frond 的整個設計前提是「它不只服務 spine」（ADR-0002 拒收手勢即為此）。放進同一個 monorepo 會讓這個前提在第一個 sprint 就被侵蝕，因為抄近路會變得太容易。

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

出貨產物是 `dist/`（ES module 加 `.d.ts`），`exports` 只開 `./epub` 與 `./renderer`
兩個 subpath，不開根路徑：那強迫消費端選一層，而那正是 ADR-0005 那一刀的意思。
`./test-fixtures` 不在出貨面上——它相依 `node:fs`，是我們產合成 fixture 的工具，不
是消費端的東西。

`src/` 也進 tarball，但**不在 `exports` 上**，所以它不是 API 的一部分。它在那裡只
為了一件事：`.js.map` 與 `.d.ts.map` 裡的 `sources` 指著 `../../src/*.ts`，那些檔
案不在包裡的話，消費端「跳到定義」會落在一個不存在的路徑上。git dependency 的年代
`src/` 本來就在，所以這個洞是發 npm 才會開的（`src/test-fixtures` 以 `files` 的
`!` 樣式排除掉，理由同上）。

版本號從 `0.1.0` 起算，每次發布打一個 `vX.Y.Z` 的 git tag——tag 留著，它是「這個版
本對應哪一段歷史」的答案，只是不再是消費端的安裝座標。

發布由 `.github/workflows/release.yml` 做，認證走 npm 的 trusted publishing
（OIDC），所以 repo 裡不存任何 npm token。**只有第一版例外**：trusted publisher 要
掛在一個已經存在的套件上，而 npm 不接受對尚未存在的套件預先設定（npm/cli#8544），
所以 `@yurenju/frond` 的第一版得在本機用一顆臨時 token 手動發一次。細節寫在那份
workflow 的註解裡。

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

`prepare` 那一格留著沒動，因為 `npm install github:yurenju/frond#<tag>` 這條路仍然
走得通（`npm pack` 與 `npm publish` 也會經過它，所以發出去的 tarball 一定是建置過
的）。差別只在它不再是**建議**的安裝方式。

## 展示站

`https://yurenju.github.io/frond/`，由 `main` 的每一次推送重新部署。

**站上不內建任何書，只接使用者自己拖進來的檔案。** 兩個理由：手上那批書有版權
（ADR-0007），而找一本可公開的中文直排書比看起來難；更重要的是，會來看這個站的人
真正想知道的是「**我的**書排得出來嗎」，內建書回答不了那一題。

站的第二個分頁（檢查）只用 `EpubBook`，把 frond 從一本書讀到的事實整個攤開——
EPUB 版本、頁面推進方向、TOC 讀自哪一份導覽文件、封面用哪種寫法宣告、manifest 裡
哪幾項其實不在包裡。那是「拿自己的書評估一個函式庫」時最先想知道的東西，而它剛好
不需要渲染。

站本身沒有建置步驟——`<script type="module">` 直接 import `tsc` emit 出來的檔案。
**這是出貨相依為零的直接後果，也因此站每次部署都在驗證那件事**（`npm run site` 內
含的 `scripts/finish-build.ts` 會在產物出現 bare specifier 時紅燈）。

## 授權

**授權採 MIT**，與 foliate 一致。frond 會直接取用上游 `tests/epubcfi-tests.js` 的 280 行測試向量作為 CFI 驗收表（ADR-0001），那是實際的程式碼取用；MIT 對 MIT 最乾淨，attribution 照規矩標示。至於瀏覽器 quirk 知識（`docs/browser-quirks.md`）搬運的是知識而非程式碼，與授權無涉。
