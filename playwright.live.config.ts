import { defineConfig, devices } from "@playwright/test";

// `npm run live-check:ui`: the deployed app on the real Drive, as the test
// account (see "Live Drive checks" in the README). Never run in CI.
export default defineConfig({
  testDir: "live",
  testMatch: "**/*.ui.ts",
  // The runs share the test account's Drive, and each browser makes its own.
  workers: 1,
  timeout: 60_000,
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
