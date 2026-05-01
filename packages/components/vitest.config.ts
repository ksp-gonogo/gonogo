import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@gonogo/core/test": path.resolve(
        import.meta.dirname,
        "../core/src/test/helpers.ts",
      ),
      "@gonogo/core": path.resolve(import.meta.dirname, "../core/src/index.ts"),
      "@gonogo/data": path.resolve(import.meta.dirname, "../data/src/index.ts"),
      "@gonogo/ui": path.resolve(import.meta.dirname, "../ui/src/index.ts"),
    },
  },
  test: {
    name: "components",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
