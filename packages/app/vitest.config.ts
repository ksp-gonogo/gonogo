import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ksp-gonogo/core/test": path.resolve(
        import.meta.dirname,
        "../core/src/test/helpers.ts",
      ),
      "@ksp-gonogo/core": path.resolve(
        import.meta.dirname,
        "../core/src/index.ts",
      ),
      "@ksp-gonogo/logger": path.resolve(
        import.meta.dirname,
        "../logger/src/index.ts",
      ),
      "@ksp-gonogo/components": path.resolve(
        import.meta.dirname,
        "../components/src/index.ts",
      ),
      "@ksp-gonogo/data": path.resolve(
        import.meta.dirname,
        "../data/src/index.ts",
      ),
      "@ksp-gonogo/serial": path.resolve(
        import.meta.dirname,
        "../serial/src/index.ts",
      ),
      "@ksp-gonogo/sitrep-client": path.resolve(
        import.meta.dirname,
        "../sitrep-client/src/index.ts",
      ),
      // Kerbalism Uplink client: topics-only (registers kerbalism.available).
      // Aliased to src so the topic-cs-sync test resolves it without a prior
      // build, same as the workspace deps above (scansat/kos/kerbcast-feed
      // resolve via their built dist).
      "@ksp-gonogo/gonogo-kerbalism-uplink": path.resolve(
        import.meta.dirname,
        "../../mod/GonogoKerbalismUplink/client/src/index.ts",
      ),
    },
  },
  test: {
    // 30s, the repo-wide jsdom budget (see vitest-timeout-convention.test.ts): under
    // a parallel `turbo test` the 5s default times out whichever test is slowest
    // rather than whichever is wrong.
    testTimeout: 30_000,
    pool: "threads",
    name: "app",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
