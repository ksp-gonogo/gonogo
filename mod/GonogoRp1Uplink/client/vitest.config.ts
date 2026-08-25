import { defineConfig } from "vitest/config";

// No `@ksp-gonogo/*` aliases. This client imports only published packages, so
// everything resolves from its own node_modules the way it would for an author
// outside this repo.

export default defineConfig({
  test: {
    // 30s, not the 5s default: the first test in a file pays that file's cold
    // start, and under a parallel `turbo test` every package pays it at once.
    testTimeout: 30_000,
    pool: "threads",
    name: "rp1",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
