#!/usr/bin/env node
//
// 把展示站的 React 那一頁打包起來。由 `scripts/build-site.sh` 呼叫，不是獨立入口。
//
// 這支腳本以 `node` 直接執行（型別剝離），所以 import 一律寫 .ts 副檔名——
// 剝離器不會把 ./x.js 對應回 ./x.ts。

import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_REACT = join(REPOSITORY_ROOT, "site", "react");

/**
 * ## 這一頁為什麼可以有打包器，而首頁不行
 *
 * 首頁是「frond 出貨相依為零」的實物證明：`<script type="module">` 直接 import
 * `tsc` emit 出來的檔案，沒有第三個工具。把任何需要打包的東西放進那一頁，那句宣稱
 * 就不再檢查任何東西。
 *
 * 這一頁證明的是**另一件事**，而它同樣需要一個實物證明：`@yurenju/frond-react`
 * 相依 react，於是它的消費端一定有打包器——所以這裡該問的問題不是「能不能不打
 * 包」，是「**出貨的那包東西，被一個零設定的打包器吃下去，在真的瀏覽器裡跑不跑得
 * 動**」。
 *
 * ## 因此解析走 node_modules，不走原始碼
 *
 * 這裡刻意**沒有** alias。`tests/browser/react/support/harness.ts` 有（它把套件名
 * 指回各自的 `src/`，那樣改一行就看得到結果），而這一支相反：它解析到的是每個套件
 * 的 `dist/`，也就是消費端 `npm install` 之後拿到的那些檔案。
 *
 * 兩者的差別就是這一頁的價值。測試對著原始碼跑，所以它抓不到「`exports` 的路徑打
 * 錯」「`files` 漏了東西」「emit 出來的 `.js` 少了一個副檔名」這一類只在出貨產物
 * 上成立的錯——而那些錯在消費端是致命的。這一頁每次部署都在走那條路。
 *
 * 代價是 `npm run site` 必須先把兩個套件都建起來。`build-site.sh` 因此把順序寫死。
 */
const result = await build({
  entryPoints: [join(SITE_REACT, "app.tsx")],
  outfile: join(SITE_REACT, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  // sourcemap 讓「在展示站上看到怪東西」可以直接對回原始碼。它指的是 frond 出貨
  // 的 `src/`（那些檔案在 tarball 裡，見 ADR-0008），所以連 frond 內部都跳得進去。
  sourcemap: true,
  // React 的開發版會多做很多檢查並印警告。展示站要的是它實際跑起來的樣子，而不是
  // 一頁 console 警告，所以用生產版。
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
});

// 預設樣式複製過去，頁面用一個 `disabled` 得掉的 <link> 掛它。
//
// 不 import 進 bundle：那樣它就變成「一定會生效」，而這一頁要示範的正好是它**可以
// 完全不生效**。一個開關切得掉的 <link> 是唯一表達得出這件事的形狀。
await copyFile(
  join(REPOSITORY_ROOT, "packages", "frond-react", "styles.css"),
  join(SITE_REACT, "frond-react.css"),
);

const outputs = Object.entries(result.metafile.outputs);
for (const [path, meta] of outputs) {
  if (path.endsWith(".map")) continue;
  console.log(`site/react/bundle.js：${(meta.bytes / 1024).toFixed(0)} kB（含 react）`);
}
