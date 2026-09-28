import { defineConfig } from "vitest/config";

// `npm run live-check`: the Drive client against the real Drive, as the test
// account (see "Live Drive checks" in the README).
export default defineConfig({
  test: {
    environment: "node",
    include: ["live/**/*.live.ts"],
    // Drive's search index can take a while to show new files.
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
