import type { UserConfig } from "vitest/config";
import { defineConfig } from "vitest/config";
import { scanTestFiles } from "./scan-tests.mjs";
import base from "./vitest.config";

/**
 * The cross-package ratchets only: the guards that walk or `git grep` every
 * tracked file in the repo (the styleguide-* family, uplink-boundary,
 * vendor-name, fixture-gated-suites and the rest).
 *
 * Split from `test` because their RESULT depends on sources turbo's
 * per-package cache cannot see, so this task alone carries a cache key over
 * the whole tree (see turbo.json). Keying core's whole suite that way re-ran
 * every file on any change anywhere: 85.7s on every push, against 13.9s for
 * core's own tests, and a 17 GB turbo cache to hold the churn.
 *
 * Spread rather than `mergeConfig`, deliberately: mergeConfig CONCATENATES
 * arrays, so the base `exclude` (which drops precisely these files) survived
 * into this config and excluded everything it was meant to include. The suite
 * then matched nothing and exited 1. `exclude` here must REPLACE, not extend.
 */
const baseTest = (base as UserConfig).test ?? {};

export default defineConfig({
  ...(base as UserConfig),
  test: {
    ...baseTest,
    name: "core:scans",
    include: scanTestFiles(),
    exclude: ["dist/**", "node_modules/**"],
  },
});
