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
      // Subpath BEFORE the bare entry (same ordering as core/test above):
      // vite's alias matcher prefix-matches, so a bare `@ksp-gonogo/sitrep-client`
      // find would swallow `.../media` and append the literal "/media" onto the
      // resolved `.ts` path. kerbcast's built client imports this sanctioned
      // media subpath (B1 seal), so the test resolver must know it too.
      "@ksp-gonogo/sitrep-client/media": path.resolve(
        import.meta.dirname,
        "../sitrep-client/src/media/index.ts",
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
