import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import firebase from "./firebase.json" with { type: "json" };

// The OAuth client authorizes http://localhost:5173 and no other local origin.
const port = 5173;

// The preview serves the build with the headers Hosting sends for every path,
// the security policy included, so that the end-to-end tests run under them.
// Hosting's first rule holds them, as src/security-headers.test.ts checks.
const headers = Object.fromEntries(
  firebase.hosting.headers
    .find(({ source }) => source === "**")
    ?.headers.map(({ key, value }) => [key, value]) ?? [],
);

// The browser build of this entity decoder, which the Markdown parser uses,
// decodes through innerHTML: Trusted Types refuse that, and every note with
// "&amp;" would fail to render. Its other build looks entities up in a table.
const entities = fileURLToPath(
  new URL(
    "node_modules/decode-named-character-reference/index.js",
    import.meta.url,
  ),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^decode-named-character-reference$/, replacement: entities },
    ],
  },
  server: { port, strictPort: true },
  preview: { port, strictPort: true, headers },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      include: ["src/**/*.{ts,tsx}", "live/grant.ts"],
      exclude: ["src/main.tsx", "src/test/**"],
      thresholds: {
        lines: 95,
        functions: 95,
        statements: 95,
        branches: 90,
        // These modules handle full-Drive tokens, or the bytes written back
        // to Drive: every branch is tested.
        "{src/{auth,drive,session,text},live/grant}.ts": { 100: true },
      },
    },
  },
});
