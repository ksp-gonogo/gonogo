import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolve @gonogo/* workspace deps to their `src` (not built `dist`) so the
// suite runs hermetically without a prior build — mirrors the components
// package's vitest config, since the moved kOS widget tests were authored
// against that resolution. `@gonogo/sitrep-client` / `@gonogo/sitrep-sdk` stay
// unaliased (resolved from their built dist) exactly as they were in
// @gonogo/components — the stream test-adapter and KosProcessors consume them.
const pkgs = path.resolve(import.meta.dirname, "../../../packages");

export default defineConfig({
  resolve: {
    alias: {
      "@gonogo/core/test": path.resolve(pkgs, "core/src/test/helpers.ts"),
      "@gonogo/core": path.resolve(pkgs, "core/src/index.ts"),
      "@gonogo/data": path.resolve(pkgs, "data/src/index.ts"),
      "@gonogo/logger": path.resolve(pkgs, "logger/src/index.ts"),
      "@gonogo/ui": path.resolve(pkgs, "ui/src/index.ts"),
    },
  },
  test: {
    name: "kos",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
