import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 30s, the repo-wide jsdom budget (see vitest-timeout-convention.test.ts).
    testTimeout: 30_000,
    pool: "threads",
    name: "uplink-tools",
    environment: "jsdom",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
