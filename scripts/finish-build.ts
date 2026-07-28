#!/usr/bin/env node
//
// `tsc -p tsconfig.build.json` 之後的收尾：改寫 `.d.ts` 裡的副檔名，然後檢查
// `dist/` 的兩條不變式。由每個套件的 `npm run build` 接在編譯後面跑：
//
//     node ../../scripts/finish-build.ts .
//
// 參數是**套件目錄**（相對於 cwd 或絕對路徑皆可）。一支腳本服務所有套件，因為
// 兩條不變式對每一個出貨的套件都成立——各套件複製一份的話，補強其中一條的那天
// 只有一份會被改到，而漏掉的那一份不會有任何東西紅。
//
// 這支腳本以 `node` 直接執行（型別剝離），所以 import 一律寫 .ts 副檔名——
// 剝離器不會把 ./x.js 對應回 ./x.ts。

import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const packageDirectory = resolve(process.argv[2] ?? ".");
const DIST = join(packageDirectory, "dist");

const manifest: {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));

const packageName = manifest.name ?? packageDirectory;

/**
 * 這個套件放行哪些 bare specifier。
 *
 * **清單不是手寫的，是從 `package.json` 的 `dependencies` 與 `peerDependencies`
 * 推出來的。** 那件事比它看起來重要：手寫的清單會隨著相依變動而腐爛，而腐爛的
 * 方向永遠是「放太寬」——沒有人會記得在移除一個相依之後回來收窄它。
 *
 * 從宣告推導之後，「出貨產物 import 的東西」與「package.json 說它相依的東西」被
 * 綁成同一件事，兩邊漂開的那一刻紅的是 build。對 `@yurenju/frond` 而言兩者皆空，
 * 於是**零相依這條不變式自動維持**——它不再是一個寫死在這支腳本裡的特例。
 *
 * `devDependencies` 不算：那些東西不會跟著出貨，出現在 `dist/` 裡就是缺陷。
 */
const allowed = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);

/**
 * specifier 屬不屬於某個放行的套件。
 *
 * 比對的是**套件名**而不是整條 specifier，因為 subpath 是常態：`react` 放行時
 * `react/jsx-runtime` 一起放行（那是同一個套件的另一個進入點），而 `reactive-x`
 * 不會因為前綴像就被放過去。scoped 名字有兩段，所以不能只切第一個 `/`。
 */
function packageOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? "");
}

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

/**
 * 把整行都是註解的那些行拿掉。
 *
 * ## 為什麼需要這一步
 *
 * 下面兩條檢查是對著文字跑正規表達式，而 tsc 的 emit **保留註解**——於是一段像
 * 這樣的文件註解會被當成真的 import：
 *
 *     /** ```tsx
 *      * import * as Reader from "@yurenju/frond-react";
 *      * ``` *\/
 *
 * 症狀是 build 紅在一個根本不存在的相依上，而修法看起來像「把文件裡的範例刪掉」。
 * 那個代價不能付：這個 repo 的公開面幾乎都靠檔頭註解在解釋自己。
 *
 * ## 為什麼「整行」就夠，不必真的剖析
 *
 * 掃的是 **tsc emit 出來的檔案**，不是人寫的原始碼。emit 的形狀是機器決定的：每一
 * 個 module specifier 都出現在一個從第 0 欄開始的 `import` / `export` 陳述式裡，
 * 多行的 import 也只是把 `} from "…"` 換到下一行——那一行以 `}` 開頭，不是註解。
 * 反過來，被保留的註解一律是 `//` 或 `*` 開頭的行。
 *
 * 所以漏檢是不可能的（真正的 import 不會長在註解行上），而誤判被這一步擋掉。要寫
 * 一個真的懂 regex literal 與 template literal 的剖析器才能做得更好，而那對這裡要
 * 守的兩條不變式沒有增加任何保護。
 */
function codeLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

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

/** 訊息裡的路徑一律相對於套件目錄——那是讀訊息的人當下所在的位置。 */
function describe(path: string): string {
  const inside = relative(packageDirectory, path);
  return isAbsolute(inside) ? path : inside;
}

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

  const source = codeLines(await readFile(path, "utf8"));
  const where = describe(path);

  // 1. 一個 `.ts` specifier 都不該留下。上面的改寫若漏了某種形式（例如日後
  //    產物裡開始出現 `import("./x.ts")` 的型別查詢），紅在這裡。
  for (const match of source.matchAll(/from\s*"([^"]*\.ts)"|import\("([^"]*\.ts)"\)/g)) {
    problems.push(`${where}：殘留 .ts specifier ${match[1] ?? match[2]}`);
  }

  // 2. 沒有宣告過的 bare specifier 一個都不該出現。
  //
  //    `@yurenju/frond` 的 `dependencies` 與 `peerDependencies` 都是空的，所以
  //    對它而言這條規則讀作「一個 bare specifier 都不行」——與這條檢查原本的樣
  //    子完全相同（commit 6f74fa8）。那不只是「相依少」的問題：它是「消費端不需
  //    要打包器」與「demo 站可以直接 <script type=module>」這兩件事成立的**條
  //    件**。加一個 npm 套件進 src/epub 或 src/renderer 會讓兩者同時失效，而症狀
  //    要到別人 build 不起來時才看得到。紅在這裡。
  //
  //    `@yurenju/frond-react` 則相反：它必然 import `react`，而那正是它與 frond
  //    的分界線。這條規則對它讀作「只能 import 你宣告過的東西」——偷偷長出第三個
  //    相依，一樣紅在這裡。
  for (const match of source.matchAll(/from\s*"([^".][^"]*)"/g)) {
    const specifier = match[1] ?? "";
    if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
    if (allowed.has(packageOf(specifier))) continue;

    problems.push(
      allowed.size === 0
        ? `${where}：bare specifier "${specifier}"——${packageName} 的出貨相依必須是零`
        : `${where}：bare specifier "${specifier}" 沒有宣告在 ${packageName} 的 dependencies 或 peerDependencies 裡`,
    );
  }
}

if (problems.length > 0) {
  console.error(`${packageName} 的 dist/ 不變式壞了：\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

const permitted = allowed.size === 0 ? "無 bare specifier" : `bare specifier 只有 ${[...allowed].join("、")}`;

console.log(`${packageName}：${rewritten} 個 .d.ts 的相對 import 改寫成 .js`);
console.log(`${packageName}：dist/ 檢查通過——無 .ts specifier、${permitted}（${files.length} 個檔案）`);
