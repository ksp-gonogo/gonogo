import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ksp-gonogo/core/test": path.resolve(
        import.meta.dirname,
        "../core/src/test/helpers.ts",
      ),
      "@ksp-gonogo/core": path.resolve(
        import.meta.dirname,
        "../core/src/index.ts",
      ),
      "@ksp-gonogo/data": path.resolve(
        import.meta.dirname,
        "../data/src/index.ts",
      ),
      "@ksp-gonogo/logger": path.resolve(
        import.meta.dirname,
        "../logger/src/index.ts",
      ),
      "@ksp-gonogo/ui": path.resolve(import.meta.dirname, "../ui/src/index.ts"),
    },
  },
  test: {
    // 30s, the repo-wide jsdom budget (see vitest-timeout-convention.test.ts). The
    // 5s default is a hang detector being read as a speed limit: `turbo test` runs
    // ~10 suites at once against 4 vCPUs, which dilates every test by an order of
    // magnitude, so the default fails whichever test is SLOWEST rather than
    // whichever is wrong. It failed here for seven runs on `arms a conditional
    // trigger`, 302ms local, and a timed-out test leaks its in-flight userEvent
    // work into the next nine, which then report a widget that rendered nothing.
    // A genuine hang is unbounded and still fails, just later.
    testTimeout: 30_000,
    pool: "threads",
    name: "components",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
