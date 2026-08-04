import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    name: "logger",
    environment: "node",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
