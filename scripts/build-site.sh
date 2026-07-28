#!/usr/bin/env bash
#
# 把展示站組起來。
#
#   npm run site
#
# 產出的 `site/` 是一個可以直接丟上任何靜態主機的目錄。它有兩頁，而**兩頁的建置
# 方式刻意不同**——那個差別本身就是要示範的東西：
#
#   site/index.html        @yurenju/frond      沒有打包步驟
#   site/react/index.html  @yurenju/frond-react  esbuild，零設定
#
# ## 為什麼是複製而不是 symlink 或相對路徑
#
# `site/` 要能被原封不動地上傳。symlink 在多數靜態主機上會壞掉，而讓
# `index.html` 去 import `../packages/frond/dist/…` 則會讓「可以上傳的東西」變成
# repo 根目錄而不是 `site/`——那會連帶把 `packages/`、`tests/` 與 `node_modules/`
# 一起送上去。
#
# ## 第一頁：不需要打包器，而這一步在檢查那件事
#
# 首頁的 `<script type="module">` 直接 import `tsc` emit 出來的檔案本身。那是
# 「frond 出貨相依為零」的直接後果，所以這一頁能不能開就是那個性質的實物證明。
# 哪天有人在 `packages/frond/src` 底下加了一個 npm 相依，`npm run build` 會先在
# `scripts/finish-build.ts` 的 bare specifier 檢查上紅掉——在頁面壞掉之前。
#
# **因此 frond-react 不能放進這一頁。** 它必然相依 react，於是必然需要打包器，而
# 一旦這一頁被打包過，上面那句宣稱就不再檢查任何東西。
#
# ## 第二頁：需要打包器，而這一步在檢查另一件事
#
# frond-react 的消費端一定有打包器，所以對它該問的不是「能不能不打包」，是
# 「**出貨的那包東西，被一個零設定的打包器吃下去，跑不跑得動**」。第二頁走的是
# node_modules 解析，也就是消費端 `npm install` 之後拿到的那些檔案——理由完整寫在
# `scripts/bundle-site-react.ts` 的檔頭。
#
# 那條路要求兩個套件都先建好，所以下面的順序是寫死的。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

npm run build

# --- 第一頁：複製，不打包 ----------------------------------------------------

rm -rf site/frond
mkdir -p site/frond
cp -R packages/frond/dist/. site/frond/

# --- 第二頁：打包 ------------------------------------------------------------

node scripts/bundle-site-react.ts

echo "site/ 準備好了"
echo "  site/frond/          frond 的產物，首頁直接 import"
echo "  site/react/bundle.js  frond-react 的展示頁，esbuild 打包"
echo "本機看的話："
echo "  npx --yes serve site    # 或任何靜態伺服器；file:// 不行，ES module 需要 http"
