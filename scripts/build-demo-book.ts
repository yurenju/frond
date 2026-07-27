#!/usr/bin/env node
//
// 把展示用的繁中直排合成書寫成檔案。
//
//   npm run demo:book                    # 寫進 tests/books/demo-zh-tw.epub
//   node scripts/build-demo-book.ts <路徑>
//
// 書的內容與理由在 `src/test-fixtures/demo-book.ts`。這支只是把它落地——截圖用
// 的 spec 直接 import 那個模組，不必先寫檔（`docs/agents/pull-requests.md`）。
// 這裡存在是為了手動試 demo 站的時候有一本書可以拖。
//
// 這支腳本以 `node` 直接執行（型別剝離），所以 import 一律寫 .ts 副檔名——
// 剝離器不會把 ./x.js 對應回 ./x.ts。

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { buildDemoBook } from "../src/test-fixtures/demo-book.ts";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(REPOSITORY_ROOT, "tests", "books", "demo-zh-tw.epub");

const requested = process.argv[2];
const output = requested === undefined ? DEFAULT_OUTPUT : resolve(requested);
const bytes = buildDemoBook();

await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);

console.log(`${relative(REPOSITORY_ROOT, output)}（${bytes.length} bytes）`);
