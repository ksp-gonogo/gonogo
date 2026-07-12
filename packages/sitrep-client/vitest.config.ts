import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "sitrep-client",
    environment: "jsdom",
    globals: true,
    exclude: ["dist/**", "node_modules/**"],
  },
});
