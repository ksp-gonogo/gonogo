import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * The acceptance run's own config. It opens a real socket to a real mod, so it
 * runs in Node with none of the suite's setup files: those stub `WebSocket` to
 * a no-op for every test, which leaves the run nothing to connect with.
 */
export default defineConfig({
  plugins: base.plugins,
  resolve: base.resolve,
  test: {
    name: "app:shadow-acceptance",
    environment: "node",
    include: ["scripts/shadow-acceptance.run.ts"],
    reporters: ["verbose"],
  },
});
