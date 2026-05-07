import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "relay",
    environment: "node",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
