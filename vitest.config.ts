import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 只認 tests/node。ADR-0009 把測試切成兩個 runner：EpubBook 與其周邊的純
    // TypeScript 程式碼用 Vitest 跑 Node，Renderer 用 Playwright 跑瀏覽器。
    // include 若泛指 tests/，瀏覽器那半邊的 spec 會被 Vitest 掃進來，在沒有
    // 瀏覽器的 Node 環境下失敗。
    include: ["tests/node/**/*.test.ts"],
  },
});
