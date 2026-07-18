import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolve @ksp-gonogo/* workspace deps to their `src` (not built `dist`) so the
// suite runs hermetically without a prior build — mirrors the components
// package's vitest config, since the moved Scanning tests were authored against
// that resolution. `@ksp-gonogo/components` is aliased too: several augments
// here (TerrainBase/*, FootprintOverlay, CoveragePanel) still take a
// type-only `import type {} from "@ksp-gonogo/components"` to pull in
// MapView's SlotRegistry merge, even though nothing in this package imports
// its runtime scan-canvas internals anymore (Minimap dropped that in T9).
const pkgs = path.resolve(import.meta.dirname, "../../../packages");

export default defineConfig({
  resolve: {
    alias: {
      "@ksp-gonogo/core/test": path.resolve(pkgs, "core/src/test/helpers.ts"),
      "@ksp-gonogo/core": path.resolve(pkgs, "core/src/index.ts"),
      "@ksp-gonogo/data": path.resolve(pkgs, "data/src/index.ts"),
      "@ksp-gonogo/logger": path.resolve(pkgs, "logger/src/index.ts"),
      "@ksp-gonogo/ui": path.resolve(pkgs, "ui/src/index.ts"),
      "@ksp-gonogo/components": path.resolve(pkgs, "components/src/index.ts"),
    },
  },
  test: {
    name: "scansat",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
