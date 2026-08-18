import path from "node:path";
import { defineConfig } from "vitest/config";

// No `@ksp-gonogo/*` aliases. This client imports only published packages, so
// everything resolves from its own node_modules the way it would for an author
// outside this repo. The aliases that used to be here pointed the private
// packages at their `src`, which is part of what let the harness reach into them.

export default defineConfig({
  test: {
    pool: "threads", // forks EPERM on macOS+Node24; matches packages/components config
    name: "kerbcast",
    environment: "jsdom",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
