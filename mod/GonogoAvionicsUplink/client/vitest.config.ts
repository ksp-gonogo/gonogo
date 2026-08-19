import { defineConfig } from "vitest/config";

// No `@ksp-gonogo/*` aliases. This client imports only published packages, so
// everything resolves from its own node_modules the way it would for an author
// outside this repo. The aliases that used to be here pointed the private
// packages at their `src`, which is part of what let the harness reach into them.

export default defineConfig({
  test: {
    // 30s, not the 5s default. The FIRST test in a file pays that file's cold
    // start (first render, first jsdom layout, first styled-components
    // injection): measured at 208ms against 26-38ms for its siblings here, and
    // 223ms against 7-13ms in another Uplink client. Under a parallel `turbo test`
    // on a two-core runner every package pays that at once and the heaviest one
    // loses, which surfaces as a named test "failing" when nothing is wrong with
    // it. Two Uplink clients tripped it on consecutive days; this sets it across
    // all of them rather than waiting for the third. A genuine hang still fails,
    // just later.
    testTimeout: 30_000,
    pool: "threads", // forks EPERM on macOS+Node24; matches packages/components config
    name: "avionics",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
