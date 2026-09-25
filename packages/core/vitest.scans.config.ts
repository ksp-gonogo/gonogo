import type { UserConfig } from "vitest/config";
import { defineConfig } from "vitest/config";
import { changedFiles, scanScopeMode, selectScans } from "./scan-scope.mjs";
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
 *
 * `GONOGO_SCANS=changed` (the root `pnpm scans`) runs only the scans a branch's
 * changes can reach, and narrows the heaviest of those to the changed files;
 * see scan-scope.mjs. Turbo passes no undeclared variable through, so every
 * turbo route (CI, the pre-push hook, safe-push) is the full run whatever the
 * caller's environment says.
 */
const baseTest = (base as UserConfig).test ?? {};

const all = scanTestFiles();
const changed = scanScopeMode() === "changed" ? changedFiles() : null;
const selection = changed ? selectScans(all, changed.files) : null;

const banner =
  changed && selection
    ? [
        `[scans] CHANGED-ONLY RUN, not the CI gate: ${selection.run.length} of ${all.length} scan files, ` +
          `for ${changed.files.length} changed file(s) since the merge-base with ${changed.ref} (${changed.base.slice(0, 9)}).`,
        `[scans] ${selection.skipped.length} skipped as out of scope. CI runs all ${all.length} over the whole tree; ` +
          "`pnpm scans:full` is that run locally.",
      ].join("\n")
    : null;

if (banner) process.stderr.write(`${banner}\n`);

export default defineConfig({
  ...(base as UserConfig),
  test: {
    ...baseTest,
    name: changed ? "core:scans (CHANGED ONLY)" : "core:scans",
    // Every scan reads files and shells out to git; none renders. The package's
    // jsdom default costs seconds of setup per file, a third of this suite's CPU.
    environment: "node",
    include: selection ? selection.run : all,
    exclude: ["dist/**", "node_modules/**"],
    // Repeated under the summary, where a verdict is read, so a fast green
    // cannot be taken for the whole-tree one.
    ...(banner
      ? {
          reporters: [
            "default",
            { onTestRunEnd: () => void process.stderr.write(`\n${banner}\n`) },
          ],
        }
      : {}),
  },
});
