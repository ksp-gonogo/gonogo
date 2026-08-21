import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ksp-gonogo/ui": path.resolve(import.meta.dirname, "../ui/src/index.ts"),
    },
  },
  test: {
    // 30s, the repo-wide jsdom budget (see vitest-timeout-convention.test.ts): under
    // a parallel `turbo test` the 5s default times out whichever test is slowest
    // rather than whichever is wrong.
    testTimeout: 30_000,
    pool: "threads",
    name: "data",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
