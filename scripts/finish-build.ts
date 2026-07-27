#!/usr/bin/env node
//
// `tsc -p tsconfig.build.json` 之後的收尾：改寫 `.d.ts` 裡的副檔名，然後檢查
// `dist/` 的兩條不變式。由 `npm run build` 接在編譯後面跑。
//
// 這支腳本以 `node` 直接執行（型別剝離），所以 import 一律寫 .ts 副檔名——
// 剝離器不會把 ./x.js 對應回 ./x.ts。

import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, relative } from "node:path";

const REPOSITORY_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DIST = join(REPOSITORY_ROOT, "dist");

/**
 * ## 為什麼要自己改寫 `.d.ts`
 *
 * `src/` 內部一律以 `.ts` 副檔名互相 import（理由見 `tsconfig.json`），而
 * `rewriteRelativeImportExtensions` 負責在 emit 時把它們換成 `.js`。
 *
 * **它只換 `.js` 產物，不換 `.d.ts` 產物**（TypeScript 7.0.2 實測）。於是
 * `dist/renderer/index.js` 是對的，而同一個目錄的 `index.d.ts` 裡還寫著
 * `export { Renderer } from "./renderer.ts"`——那個檔案不存在於 `dist/`，消費端
 * 的型別解析會在那裡斷掉。症狀很難認：`import` 跑得動，型別卻是 `any`。
 *
 * 所以這裡補那一刀。改寫的範圍窄到可以用字串處理：產物裡相對 specifier 只出現
 * `from "…"` 一種形式（沒有 `import("…")` 的型別查詢），而下面的不變式檢查會在
 * 出現新形式時紅燈，不會靜靜漏掉。
 */
const RELATIVE_TS_SPECIFIER = /(\bfrom\s*")(\.[^"]*)\.ts(")/g;

/** `dist/` 底下所有檔案的絕對路徑。 */
async function distFiles(directory: string = DIST): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await distFiles(path)));
    } else {
      files.push(path);
    }
  }

  return files;
}

const files = await distFiles();

// --- 改寫 -------------------------------------------------------------------

let rewritten = 0;

for (const path of files) {
  if (!path.endsWith(".d.ts")) continue;

  const before = await readFile(path, "utf8");
  const after = before.replace(RELATIVE_TS_SPECIFIER, "$1$2.js$3");
  if (after === before) continue;

  await writeFile(path, after);
  rewritten += 1;
}

// --- 不變式 -----------------------------------------------------------------
//
// 兩條都是**出貨產物的性質**，所以在這裡檢查而不是寫成單元測試：它們要守的是
// `dist/` 的內容，而 `dist/` 只有跑過 build 才存在。

const problems: string[] = [];

for (const path of files) {
  if (extname(path) !== ".ts" && extname(path) !== ".js") continue;
  if (path.endsWith(".map")) continue;

  const source = await readFile(path, "utf8");
  const where = relative(REPOSITORY_ROOT, path);

  // 1. 一個 `.ts` specifier 都不該留下。上面的改寫若漏了某種形式（例如日後
  //    產物裡開始出現 `import("./x.ts")` 的型別查詢），紅在這裡。
  for (const match of source.matchAll(/from\s*"([^"]*\.ts)"|import\("([^"]*\.ts)"\)/g)) {
    problems.push(`${where}：殘留 .ts specifier ${match[1] ?? match[2]}`);
  }

  // 2. 一個 bare specifier 都不該出現。
  //
  //    frond 的出貨相依是零（commit 6f74fa8），而那不只是「相依少」的問題——
  //    它是「消費端不需要打包器」與「demo 站可以直接 <script type=module>」這
  //    兩件事成立的**條件**。加一個 npm 套件進 src/epub 或 src/renderer 會讓
  //    兩者同時失效，而症狀要到別人 build 不起來時才看得到。紅在這裡。
  for (const match of source.matchAll(/from\s*"([^".][^"]*)"/g)) {
    const specifier = match[1] ?? "";
    if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
    problems.push(`${where}：bare specifier "${specifier}"——出貨相依必須是零`);
  }
}

if (problems.length > 0) {
  console.error("dist/ 的不變式壞了：\n");
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

console.log(`${rewritten} 個 .d.ts 的相對 import 改寫成 .js`);
console.log(`dist/ 檢查通過：無 .ts specifier、無 bare specifier（${files.length} 個檔案）`);
