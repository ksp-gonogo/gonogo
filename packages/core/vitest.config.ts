import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    environment: "jsdom",
    globals: true,
    // Threads (worker_threads) rather than the default forks pool: on macOS 26 +
    // Node 24, forked worker PROCESSES intermittently fail to bootstrap with
    // EPERM while loading jsdom/undici deps ("Failed to start forks worker").
    // Threads share one process and load deps once, so there is no per-worker
    // process spawn to fail.
    pool: "threads",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // The styleguide.*.test.ts guards each walk the whole source tree
    // synchronously (an FS read plus regex over every ts/tsx/css file). They
    // pass in a few seconds when run alone, but the parallel pre-push suite's
    // CPU contention can starve them past vitest's 5s default and fail the
    // push spuriously. Give the whole core suite generous headroom; correct
    // fast tests finish in milliseconds and are unaffected.
    testTimeout: 30_000,
  },
});
