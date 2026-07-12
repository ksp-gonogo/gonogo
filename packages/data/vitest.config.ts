import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ksp-gonogo/ui": path.resolve(import.meta.dirname, "../ui/src/index.ts"),
    },
  },
  test: {
    name: "data",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
