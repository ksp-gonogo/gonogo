import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// Run only by scripts/scaffold-probe.mjs, which supplies the built Uplink the one file here loads. `pnpm test` never includes it.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: "app-scaffold-probe",
      include: ["src/uplinks/scaffoldProbe.probe.tsx"],
    },
  }),
);
