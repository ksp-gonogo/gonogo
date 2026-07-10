import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolve @ksp-gonogo/* workspace deps to their `src` (not built `dist`) so the
// suite runs hermetically without a prior build — mirrors the components
// package's vitest config, since the moved Scanning tests were authored against
// that resolution. `@ksp-gonogo/components` is aliased too: the Minimap reuses the
// scan-layer canvas hooks re-exported from the components barrel (they stay in
// core MapView until the map-view.overlay augment slot exists).
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
