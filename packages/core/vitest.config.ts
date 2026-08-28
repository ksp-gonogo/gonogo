import { defineConfig } from "vitest/config";
import { scanTestFiles } from "./scan-tests.mjs";

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
    // The cross-package scans run as their OWN task (`test:scans`). They are the
    // only reason core's turbo cache key covered the whole repo, and keying the
    // WHOLE suite that way re-ran 134 files (85.7s) on any change anywhere, which
    // is also what grew a 17 GB turbo cache. Derived, never listed: scan-tests.mjs.
    exclude: ["dist/**", "node_modules/**", ...scanTestFiles()],
    // The styleguide.*.test.ts guards each walk the whole source tree
    // synchronously (an FS read plus regex over every ts/tsx/css file). They
    // pass in a few seconds when run alone, but the parallel pre-push suite's
    // CPU contention can starve them past vitest's 5s default and fail the
    // push spuriously. Give the whole core suite generous headroom; correct
    // fast tests finish in milliseconds and are unaffected.
    // 90s. This package hosts TEN ratchets that walk or git-grep every tracked
    // file (the styleguide-* family, uplink-boundary, uplink-isolation,
    // kepler-conformance). Each was written assuming it had the machine, and
    // under a parallel `turbo test` they contend: the first scan to run pays for
    // a cold git object cache and the rest run warm. Measured on one run,
    // uplink-boundary went 40.4s for its first token down to 4.5s for its last.
    // At 30s that surfaces as "kerbcast has a boundary violation" or "there are
    // two Kepler solvers", which is a scan that ran out of time wearing the
    // costume of the defect it looks for.
    testTimeout: 90_000,
  },
});
