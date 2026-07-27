#!/usr/bin/env bash
#
# 把展示頁組起來：先建出貨產物，再把它複製到 `site/frond/`。
#
#   npm run site
#
# 產出的 `site/` 是一個可以直接丟上任何靜態主機的目錄——沒有打包步驟，因為
# 沒有東西需要打包。`site/index.html` 的 `<script type="module">` 直接 import
# `./frond/renderer/index.js`，而那是 `tsc` emit 出來的檔案本身。
#
# ## 為什麼是複製而不是 symlink 或相對路徑
#
# `site/` 要能被原封不動地上傳。symlink 在多數靜態主機上會壞掉，而讓
# `index.html` 去 import `../dist/…` 則會讓「可以上傳的東西」變成 repo 根目錄
# 而不是 `site/`——那會連帶把 `src/`、`tests/` 與 `node_modules/` 一起送上去。
#
# ## 這一步同時是一個檢查
#
# demo 站能不能只靠 `<script type="module">` 跑起來，是「frond 出貨相依為零」
# 這個性質的直接後果。哪天有人在 `src/epub` 或 `src/renderer` 加了一個 npm
# 相依，`npm run build` 會先在 `scripts/finish-build.ts` 的 bare specifier
# 檢查上紅掉——在頁面壞掉之前。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

npm run build

rm -rf site/frond
mkdir -p site/frond
cp -R dist/. site/frond/

echo "site/ 準備好了（frond 產物在 site/frond/）"
echo "本機看的話："
echo "  npx --yes serve site    # 或任何靜態伺服器；file:// 不行，ES module 需要 http"
