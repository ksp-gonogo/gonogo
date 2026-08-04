import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    name: "sitrep-sdk",
    environment: "node",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
