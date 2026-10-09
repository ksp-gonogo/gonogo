import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// The station parity gate. Run by `pnpm --filter @ksp-gonogo/app parity-gate`; `pnpm test` never includes it.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: "app-parity",
      include: ["parity/**/*.parity.tsx"],
    },
  }),
);
