# 散佈方式與授權

公開 repo、MIT 授權。**暫不發佈 npm**——spine 以 git dependency（pin 住 commit）消費 frond，等 API 穩定後再發。

理由不是技術而是承諾：**發上 npm 等於隱含承諾 semver 與 API 穩定**，而 frond 第一個月的 API 一定會大改（整個專案的前提就是「不確定 foliate 的切法對不對」，那自己也不會第一次就切對）。foliate 正是為了不給這個承諾，至今拒發官方 npm，README 直接建議用 git submodule 引入。git dependency 提供同樣的安裝體驗而不附帶那個承諾。等 spine 實際跑順、API 半年沒有大動，再發 npm——那時候版本號才有意義。

**明確拒絕併入 spine 的 monorepo。** frond 的整個設計前提是「它不只服務 spine」（ADR-0002 拒收手勢即為此）。放進同一個 monorepo 會讓這個前提在第一個 sprint 就被侵蝕，因為抄近路會變得太容易。

## 版本號不是 semver 承諾

**不發 npm 與有版本號是兩件事。** 上面拒絕的是「發上 npm」這個動作所隱含的承諾，
不是版本號本身——而 git dependency 需要一個可以釘的座標，`pin 住 commit` 在實務上
很難讀（消費端的 `package.json` 裡出現一串 40 個十六進位字元，沒有人看得出那是哪
一版）。

**決定：版本號從 `0.1.0` 起算，每次發布打一個 `vX.Y.Z` 的 git tag，消費端釘 tag
而不是釘 commit。**

```
npm install github:yurenju/frond#v0.1.0
```

`0.x` 這個主版號本身就是 semver 定義的「什麼都不保證」，所以它與上面那個拒絕沒有
衝突：拒絕的是**發布通道**帶來的期待，不是版本這個座標系統。等到真的發 npm 的那
一天，版本號的意義才從「座標」變成「承諾」，而那正是 ADR 上面說的「那時候版本號
才有意義」。

安裝時由 `prepare` 跑 `npm run build`——npm 為 git dependency 安裝 devDependencies，
所以消費端**不需要自己有 TypeScript**。出貨產物是 `dist/`（ES module 加 `.d.ts`），
`exports` 只開 `./epub` 與 `./renderer` 兩個 subpath，不開根路徑：那強迫消費端選一
層，而那正是 ADR-0005 那一刀的意思。`./test-fixtures` 不在出貨面上——它相依
`node:fs`，是我們產合成 fixture 的工具，不是消費端的東西。

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
