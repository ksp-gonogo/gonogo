import { defineConfig } from "vitest/config";
import base from "./vitest.config";

/**
 * The re-arming acceptance run's own config, same reasoning as
 * `vitest.shadow-acceptance.config.ts`: real socket, Node, no setupFiles
 * (those stub `WebSocket` to a no-op for every other test in the package).
 */
export default defineConfig({
  plugins: base.plugins,
  resolve: base.resolve,
  test: {
    name: "app:shadow-acceptance-rearm",
    environment: "node",
    include: ["scripts/shadow-acceptance-rearm.run.ts"],
    reporters: ["verbose"],
  },
});
