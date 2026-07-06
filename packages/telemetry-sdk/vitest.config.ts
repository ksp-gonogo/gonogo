import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "telemetry-sdk",
    environment: "node",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
