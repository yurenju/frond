import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Only tests/browser. ADR-0009 splits the tests across two runners: EpubBook runs under
  // Vitest in Node, and Renderer runs under Playwright in browsers. Were testDir to point at
  // tests/ generally, the first Vitest spec added would be swept into all three browser
  // projects and run there.
  testDir: "./tests/browser",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),

  // No retries. This package's value lies in one set of numbers being comparable across the
  // three browsers, and retries would launder flaky results into green — flakiness is itself
  // one of the things to catch.
  retries: 0,

  reporter: process.env.CI
    ? [
        ["github"],
        ["list"],
        // CI collects this report as an artifact. For it to be retrievable, the container
        // running the tests has to mount this directory out — see
        // scripts/test-in-container.sh.
        ["html", { outputFolder: "playwright-report", open: "never" }],
      ]
    : [["list"]],

  use: {
    // A fixed viewport and device scale factor. The pagination geometry is a function of
    // these two values, and letting them float would make the cross-browser comparison
    // measure environmental differences rather than frond's behaviour.
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 1,
  },

  // All three are equals, with no tiers (ADR-0004). Any one red means red.
  // The devices[...] presets are deliberately not used: they carry their own viewport and
  // deviceScaleFactor, which would override the values deliberately fixed above.
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
