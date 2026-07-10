import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ksp-gonogo/core/test": path.resolve(
        import.meta.dirname,
        "../core/src/test/helpers.ts",
      ),
      "@ksp-gonogo/core": path.resolve(
        import.meta.dirname,
        "../core/src/index.ts",
      ),
      "@ksp-gonogo/logger": path.resolve(
        import.meta.dirname,
        "../logger/src/index.ts",
      ),
      "@ksp-gonogo/components": path.resolve(
        import.meta.dirname,
        "../components/src/index.ts",
      ),
      "@ksp-gonogo/data": path.resolve(
        import.meta.dirname,
        "../data/src/index.ts",
      ),
      "@ksp-gonogo/serial": path.resolve(
        import.meta.dirname,
        "../serial/src/index.ts",
      ),
      "@ksp-gonogo/sitrep-client": path.resolve(
        import.meta.dirname,
        "../sitrep-client/src/index.ts",
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
