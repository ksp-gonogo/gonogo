import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolve @ksp-gonogo/* workspace deps to their `src` (not built `dist`) so the
// suite runs hermetically without a prior build, mirrors the components /
// kos-client vitest configs. `@ksp-gonogo/sitrep-client` / `@ksp-gonogo/sitrep-sdk`
// stay unaliased (resolved from their built dist), exactly as the stream
// test-adapter and the sdk facade shims expect.
const pkgs = path.resolve(import.meta.dirname, "../../../packages");

export default defineConfig({
  resolve: {
    alias: {
      "@ksp-gonogo/core/test": path.resolve(pkgs, "core/src/test/helpers.ts"),
      "@ksp-gonogo/core": path.resolve(pkgs, "core/src/index.ts"),
      "@ksp-gonogo/data": path.resolve(pkgs, "data/src/index.ts"),
      "@ksp-gonogo/logger": path.resolve(pkgs, "logger/src/index.ts"),
      "@ksp-gonogo/ui": path.resolve(pkgs, "ui/src/index.ts"),
    },
  },
  test: {
    pool: "threads", // forks EPERM on macOS+Node24; see scansat config
    name: "avionics",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
