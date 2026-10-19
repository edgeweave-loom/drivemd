import { defineConfig, devices } from "@playwright/test";

// `pnpm run live-check:ui`: the deployed app on the real Drive, as the test
// account (see "Live Drive checks" in the README). Never run in CI.
export default defineConfig({
  testDir: "live",
  testMatch: "**/*.ui.ts",
  // The runs share the test account's Drive, and each browser makes its own.
  workers: 1,
  timeout: 60_000,
  // Staging's Drive has taken longer than the 5 s Playwright waits by default
  // to answer reads and writes alike: a page's lists, a note's content, a
  // vault's lookups of links and embeds, a first save's three calls in turn.
  expect: { timeout: 20_000 },
  reporter: "list",
  use: {
    baseURL:
      process.env.DRIVEMD_LIVE_URL ?? "https://md-staging.corp.edgeweave.tech",
    // Traces, screenshots and videos would keep the test account's token.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      metadata: { layout: "wide" },
    },
    {
      name: "iphone-webkit",
      use: { ...devices["iPhone 15"] },
      metadata: { layout: "phone" },
    },
  ],
});
