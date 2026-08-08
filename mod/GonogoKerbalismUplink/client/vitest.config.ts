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
      "@ksp-gonogo/core": path.resolve(corePkgs, "core/src/index.ts"),
    },
  },
  test: {
    pool: "threads", // forks EPERM on macOS+Node24; matches packages/components config
    name: "kerbalism",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
