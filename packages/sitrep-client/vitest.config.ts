import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 30s, the repo-wide jsdom budget (see vitest-timeout-convention.test.ts): under
    // a parallel `turbo test` the 5s default times out whichever test is slowest
    // rather than whichever is wrong.
    testTimeout: 30_000,
    pool: "threads",
    name: "sitrep-client",
    environment: "jsdom",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
