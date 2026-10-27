/**
 * Runs every committed-artifact generator, in order. The ONE list.
 *
 * `pnpm codegen` and `scripts/codegen-check.sh` both go through this, which is
 * the whole point: they used to hold their own lists and the two had already
 * drifted apart in BOTH directions, each one silently.
 *
 * - `gen-delay-roles.mjs` was in the check and not in `codegen`, so the obvious
 *   sequence (rename a topic, run `pnpm codegen`, commit) shipped a stale
 *   `delay-roles.ts` naming topic ids that no longer existed. CI caught it, so
 *   it cost a red build rather than a defect
 * - `gen-test-theme.mjs` was in `codegen` and not in the check, which is the
 *   worse half. The check HASHES `test-theme.ts` but never regenerated it, so
 *   it compared a stale file against itself and reported "generated files are
 *   current". Nothing in CI runs that generator at all, so a hand-edited or
 *   stale test theme shipped with no gate anywhere objecting
 *
 * Both were measured by planting a hand edit and watching the wrong thing
 * happen, not inferred from reading the two lists.
 *
 * A shared list cannot drift, so no gate polices this one: the two callers
 * agree by construction rather than by a check that would itself need checking.
 *
 * ORDER MATTERS at the ends and not in the middle. `mod/codegen-contract.sh` runs first
 * because it emits the generated contract the rest read; `asyncapi-doc.mjs`
 * runs last because it describes the finished surface.
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every generator of a committed artifact, in the order they must run.
 *
 * `outputs` names what the step writes: a repo-relative file, or a directory
 * with a trailing slash, in either case with `*` matching within one path
 * segment. `styleguide-codegen-owners.test.ts` requires every tracked file under
 * a `__generated__` directory to have an owner here.
 */
export const CODEGEN_STEPS = [
  {
    label: "contract",
    command: "bash",
    args: ["mod/codegen-contract.sh"],
    outputs: [
      "mod/sitrep-sdk/src/__generated__/contract.ts",
      "mod/sitrep-sdk/src/__generated__/topic-map.ts",
      "mod/sitrep-sdk/src/__generated__/units.ts",
      "mod/sitrep-sdk/src/__generated__/units.json",
      "mod/sitrep-sdk/src/__generated__/control-channels.ts",
      "mod/sitrep-sdk/src/__generated__/command-map.ts",
      "mod/sitrep-sdk/src/__generated__/reckonability.ts",
      "mod/sitrep-sdk/src/__generated__/error-codes.ts",
      "mod/sitrep-sdk/src/__generated__/frames.ts",
      "mod/Gonogo*Uplink/client/src/__generated__/",
    ],
  },
  {
    label: "unit-kinds",
    command: "node",
    args: ["scripts/gen-unit-kinds.mjs"],
    outputs: ["packages/ui-kit/src/__generated__/unit-kinds.ts"],
  },
  {
    label: "test-theme",
    command: "node",
    args: ["scripts/gen-test-theme.mjs"],
    outputs: ["mod/sitrep-sdk/src/__generated__/test-theme.ts"],
  },
  {
    label: "delay-roles",
    command: "node",
    args: ["scripts/gen-delay-roles.mjs"],
    outputs: [
      "mod/sitrep-sdk/src/__generated__/delay-roles.ts",
      "mod/sitrep-sdk/src/__generated__/sample-kinds.ts",
    ],
  },
  {
    label: "asyncapi",
    command: "node",
    args: ["scripts/asyncapi-doc.mjs"],
    outputs: ["asyncapi.yaml"],
  },
];

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  for (const step of CODEGEN_STEPS) {
    console.log(`codegen step: ${step.label}`);
    execFileSync(step.command, step.args, { cwd: ROOT, stdio: "inherit" });
  }
}
