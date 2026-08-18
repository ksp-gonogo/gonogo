import path from "node:path";
import { defineConfig } from "vitest/config";

// No `@ksp-gonogo/*` aliases. This client imports only published packages, so
// everything resolves from its own node_modules the way it would for an author
// outside this repo. The aliases that used to be here pointed the private
// packages at their `src`, which is part of what let the harness reach into them.

export default defineConfig({
  test: {
    name: "scansat",
    environment: "jsdom",
    globals: true,
    // Threads, not the default forks pool: on macOS + Node 24 the forks pool
    // intermittently fails worker startup with EPERM reading node_modules
    // (jsdom/css-tree), a false red. Matches packages/components' vitest config.
    pool: "threads",
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
