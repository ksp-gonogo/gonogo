import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "storybook",
    environment: "node",
    include: ["scripts/**/*.test.ts"],
  },
});
