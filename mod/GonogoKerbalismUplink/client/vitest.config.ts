import path from "node:path";
import { defineConfig } from "vitest/config";

// Resolve the SDK workspace dep to its `src` so the suite runs without a prior build.
const pkgs = path.resolve(import.meta.dirname, "../../sitrep-sdk");

export default defineConfig({
  resolve: {
    alias: {
      "@ksp-gonogo/sitrep-sdk": path.resolve(pkgs, "src/index.ts"),
    },
  },
  test: {
    pool: "threads", // forks EPERM on macOS+Node24; matches packages/components config
    name: "kerbalism",
    environment: "node",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
