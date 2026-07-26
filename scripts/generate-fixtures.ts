#!/usr/bin/env node
//
// 產生合成 fixture——一個病症一個檔，檔名即病症名。
//
//   npm run fixtures                 # 寫進 tests/fixtures/
//   node scripts/generate-fixtures.ts <目錄>
//
// 產出物是決定性的：同一份輸入產生逐位元組相同的檔案，所以重跑一次不會在
// git 上留下 diff。若跑完出現 diff，那代表產生器真的變了，diff 就是變更本身。
//
// 這支腳本以 `node` 直接執行（型別剝離），所以 import 一律寫 .ts 副檔名——
// 剝離器不會把 ./x.js 對應回 ./x.ts。

import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { writeFixtures } from "../src/test-fixtures/index.ts";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(REPOSITORY_ROOT, "tests", "fixtures");

const requested = process.argv[2];
const output = requested === undefined ? DEFAULT_OUTPUT : resolve(requested);

const written = await writeFixtures(output);

for (const path of written) {
  console.log(relative(REPOSITORY_ROOT, path));
}
console.log(`${written.length} 個 fixture 寫進 ${relative(REPOSITORY_ROOT, output)}/`);
