import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

/**
 * Used only by `pnpm coverage`.
 *
 * Runs all packages' tests in a SINGLE vitest process so that cross-package
 * coverage is correctly attributed. For example, the @ksp-gonogo/app integration
 * tests exercise ActionGroupComponent, useTelemetry, and useExecuteAction from
 * @ksp-gonogo/core / @ksp-gonogo/components — this is the only way to see that coverage.
 *
 * Per-package test runs (pnpm test / turbo test) use each package's own
 * vitest.config.ts, which is faster and has better isolation.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ksp-gonogo/core": path.resolve(root, "packages/core/src/index.ts"),
      "@ksp-gonogo/components": path.resolve(
        root,
        "packages/components/src/index.ts",
      ),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["packages/*/src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["packages/proxy/**", "**/dist/**", "**/node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: [
        "packages/*/src/**/*.test.*",
        "packages/*/src/test/**",
        "packages/proxy/**",
      ],
      reporter: ["text", "html"],
      reportsDirectory: "./coverage",
    },
  },
});
