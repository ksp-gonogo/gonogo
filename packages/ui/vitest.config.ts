import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    name: "ui",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
