import { defineConfig, devices } from "@playwright/test";

// The built app, with a made-up Google sign-in and Drive (e2e/fake-google.ts),
// served with Firebase Hosting's headers by the preview.
const port = 4173;

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${String(port)}`,
    // Traces, screenshots and videos would keep the requests the app makes.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: `npm run build:e2e && npx vite preview --outDir dist-e2e --port ${String(port)}`,
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: !process.env.CI,
  },
  // The spec's layouts: see docs/SPEC.md, Mobile requirements.
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      metadata: { layout: "wide" },
    },
    {
      name: "ipad-webkit",
      use: { ...devices["iPad Mini"] },
      metadata: { layout: "tablet" },
    },
    {
      name: "iphone-webkit",
      use: { ...devices["iPhone 15"] },
      metadata: { layout: "phone" },
    },
    {
      // Wider than a tablet's narrow side, but a phone held sideways.
      name: "iphone-landscape-webkit",
      use: {
        ...devices["iPhone 15 landscape"],
        viewport: { width: 852, height: 393 },
      },
      metadata: { layout: "phone" },
    },
  ],
});
