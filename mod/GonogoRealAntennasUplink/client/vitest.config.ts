import { defineConfig } from "vitest/config";

// No `@ksp-gonogo/*` aliases. This client imports only published packages, so
// everything resolves from its own node_modules the way it would for an author
// outside this repo. The aliases that used to be here pointed `core`, `data` and
// `logger` at their `src`, which is what let the harness reach into them at all.

export default defineConfig({
  test: {
    pool: "threads", // forks EPERM on macOS+Node24; matches packages/components config
    name: "realantennas",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
