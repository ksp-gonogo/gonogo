import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolve the SDK + core workspace deps to their `src` so the suite runs
// without a prior build. `@ksp-gonogo/sitrep-client` / `@ksp-gonogo/ui-kit`
// stay unaliased (resolved from their built dist), matching every other
// Uplink client's vitest config: the stream test-adapter and the rendered
// widget expect the real published shape.
const sdkPkgs = path.resolve(import.meta.dirname, "../../sitrep-sdk");
const corePkgs = path.resolve(import.meta.dirname, "../../../packages");

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
