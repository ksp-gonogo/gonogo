import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolve @ksp-gonogo/* workspace deps to their `src` (not built `dist`) so the
// suite runs hermetically without a prior build — the same shape the sibling
// Uplink clients' configs use. The `../../../packages` hop is what moving out
// of `packages/kerbcast` into this Uplink's client half costs.
const pkgs = path.resolve(import.meta.dirname, "../../../packages");

export default defineConfig({
  resolve: {
    alias: {
      "@ksp-gonogo/core/test": path.resolve(pkgs, "core/src/test/helpers.ts"),
      "@ksp-gonogo/logger": path.resolve(pkgs, "logger/src/index.ts"),
    },
  },
  test: {
    name: "kerbcast",
    environment: "jsdom",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
