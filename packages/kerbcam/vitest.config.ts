import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@gonogo/core/test": path.resolve(
        import.meta.dirname,
        "../core/src/test/helpers.ts",
      ),
      "@gonogo/logger": path.resolve(
        import.meta.dirname,
        "../logger/src/index.ts",
      ),
    },
  },
  test: {
    name: "kerbcam",
    environment: "jsdom",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
