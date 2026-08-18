import path from "node:path";
import { defineConfig } from "vitest/config";

// Only the SDK is aliased to its `src`, so the suite runs without a prior build
// of it. Everything else resolves from node_modules the way it would for an
// author outside this repo: `@ksp-gonogo/sitrep-testing` and
// `@ksp-gonogo/ui-kit` are published, and the stream fixture and the rendered
// widget both expect the real published shape.
const sdkPkgs = path.resolve(import.meta.dirname, "../../sitrep-sdk");

export default defineConfig({
  resolve: {
    alias: {
      "@ksp-gonogo/sitrep-sdk/testing": path.resolve(
        sdkPkgs,
        "src/testing/index.ts",
      ),
      "@ksp-gonogo/sitrep-sdk": path.resolve(sdkPkgs, "src/index.ts"),
    },
  },
  test: {
    // The first test in a file pays that file's cold start (first render, first
    // jsdom layout, first styled-components injection): ~223ms local against
    // 7-13ms for its siblings. On a 2-core runner all 22 files pay it at once,
    // so the heaviest cold start loses and the 5s default trips on whichever
    // test happens to be first. Matches the 30s `packages/core` already uses;
    // a genuine hang still fails, just later.
    testTimeout: 30_000,
    pool: "threads", // forks EPERM on macOS+Node24; matches packages/components config
    name: "kerbalism",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
