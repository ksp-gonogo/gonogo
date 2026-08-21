import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 30s, the repo-wide jsdom budget (see vitest-timeout-convention.test.ts): under
    // a parallel `turbo test` the 5s default times out whichever test is slowest
    // rather than whichever is wrong. Doubly so here, where fileParallelism is off
    // below, so every file in the largest suite in the workspace waits its turn.
    testTimeout: 30_000,
    pool: "threads",
    // Several test files spinning up jsdom worker threads at once (68 files,
    // default thread count) races the same shared node_modules/.pnpm deps
    // (jsdom, css-tree, undici, mdn-data): under real CPU contention this
    // repo already documents for the pool:"threads" switch itself (see
    // packages/core/vitest.config.ts), that race intermittently loses with
    // EPERM on a concurrent file open and crashes the worker outright, not
    // just a slow test. Serialising file execution removes the race; ui-kit
    // is the largest suite in the workspace so it's the one that actually
    // hits it in practice.
    fileParallelism: false,
    name: "ui-kit",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
