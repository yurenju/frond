import { defineConfig } from "@playwright/test";

export default defineConfig({
  // 只認 tests/browser。ADR-0009 把測試切成兩個 runner：EpubBook 用 Vitest 跑
  // Node，Renderer 用 Playwright 跑瀏覽器。testDir 若泛指 tests/，第一個放進來
  // 的 Vitest spec 會被掃進三個瀏覽器 project 裡跑。
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),

  // 不重試。這個套件的價值在於同一組數字可以在三家瀏覽器之間互比，而 retry
  // 會把不穩定的結果洗成綠燈——不穩定本身就是要抓的東西。
  retries: 0,

  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        // CI 會把這份報告收成 artifact。要拿得到，跑測試的容器必須把這個目錄
        // 掛出去——見 scripts/test-in-container.sh。
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : [["list"]],

  use: {
    // 固定 viewport 與 device scale factor。分頁幾何是這兩個值的函數，浮動的
    // 話跨瀏覽器差分比到的會是環境差異而不是 frond 的行為。
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  },

  // 三家同級，不分 tier（ADR-0004）。任一紅燈即紅燈。
  // 刻意不使用 devices[...] preset：那些 preset 自帶 viewport 與
  // deviceScaleFactor，會蓋掉上面刻意固定的值。
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
