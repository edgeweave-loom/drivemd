import { defineConfig } from "vitest/config";

// `npm run live-check`: the Drive client against the real Drive, as the test
// account (see "Live Drive checks" in the README).
export default defineConfig({
  test: {
    environment: "node",
    include: ["live/**/*.live.ts"],
    // A check may wait twice for Drive's search index, up to 2 minutes each.
    testTimeout: 360_000,
    hookTimeout: 60_000,
  },
});
