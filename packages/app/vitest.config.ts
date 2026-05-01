import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@gonogo/core/test": path.resolve(
        import.meta.dirname,
        "../core/src/test/helpers.ts",
      ),
      "@gonogo/core": path.resolve(import.meta.dirname, "../core/src/index.ts"),
      "@gonogo/components": path.resolve(
        import.meta.dirname,
        "../components/src/index.ts",
      ),
      "@gonogo/data": path.resolve(import.meta.dirname, "../data/src/index.ts"),
      "@gonogo/serial": path.resolve(
        import.meta.dirname,
        "../serial/src/index.ts",
      ),
    },
  },
  test: {
    name: "app",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
