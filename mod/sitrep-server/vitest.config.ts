import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "sitrep-server",
    environment: "node",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
