import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "core",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
