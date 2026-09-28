import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// The OAuth client authorizes http://localhost:5173 and no other local origin.
const port = 5173;

export default defineConfig({
  plugins: [react()],
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
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
        // These modules handle full-Drive tokens: every branch is tested.
        "{src/{auth,drive,session},live/grant}.ts": { 100: true },
      },
    },
  },
});
