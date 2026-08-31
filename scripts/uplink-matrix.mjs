#!/usr/bin/env node
/**
 * The Uplink CI matrix, DISCOVERED rather than hand-listed.
 *
 * A hand-maintained list has no gate on its own completeness, and this repo has
 * been bitten by that shape five times: the `mod` job's `projects=()` array
 * (four suites drifted in over four weeks, 35 tests gated by nothing),
 * `codegen-check.sh`'s old PATHS array (missed two Uplinks), the isolation
 * ratchet's `client/src`-only walk (missed `client/scripts`, where three probe
 * harnesses were importing `@ksp-gonogo/core`), `ci.yml`'s `required=()` DLL
 * list (asserted a subset of what the availability gates read, so it passed on
 * exactly the checkout that tested nothing), and `publish-mods.yml`'s matrix,
 * which still names four of eleven.
 *
 * ## Why each leg carries capability facts
 *
 * The Uplinks are RAGGED. Twelve directories: ten have a client, eleven have a
 * plugin csproj, nine have a contract slice, `GonogoBreakingGroundUplink` is
 * client-only, and `GonogoActionGroupsExtendedUplink` and
 * `GonogoTestFlightUplink` are C#-only. A uniform matrix running the same steps
 * everywhere would no-op on roughly a third of its cells and report green, which
 * is the failure this whole exercise exists to stop.
 *
 * What is NOT a capability fact: whether an Uplink has a generated page. That
 * used to be emitted as `docsCheck`, derived from a `docs:check` script the
 * Uplink either had or did not, and exactly one of ten had it. It read like
 * raggedness and was not: every client-bearing Uplink is expected to have a
 * page, so the answer is always `client` and a separate field could only ever
 * excuse an Uplink from the check. `gonogo-uplink docs` needs no script line, so
 * the leg runs the CLI directly and `scripts/uplink-docs-gate.mjs` holds the
 * repo-wide floor.
 *
 * So the facts are computed HERE, from disk, and emitted per leg. They are not
 * inferred in YAML: a GitHub Actions `if:` is a string comparison against a
 * matrix value, and a condition that cannot match reports as a correctly-skipped
 * step (see `ci-mandatory-steps.test.ts`, which exists because one did).
 *
 * A leg with no applicable steps is not a quiet pass. `uplink.yml` fails it,
 * because an Uplink directory that is neither a client nor a mod is a mistake
 * and the leg saying so is the only thing that will notice.
 *
 * Usage:
 *   node scripts/uplink-matrix.mjs             pretty JSON, for a human
 *   node scripts/uplink-matrix.mjs --github    `matrix=<json>` for $GITHUB_OUTPUT
 *   node scripts/uplink-matrix.mjs --ids       one id per line
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOD = join(ROOT, "mod");

/**
 * A floor, not an equality: adding an Uplink must never require editing this
 * script, which was the whole problem with the lists above. It is here because a
 * discovery that matches nothing emits an empty matrix, GitHub Actions skips the
 * job, and a skipped matrix job reports as successful. Set below the current
 * count so a deliberate removal does not trip it, and far enough above zero that
 * a broken walk does.
 */
const FLOOR = 10;

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/**
 * The workspace packages a client's `gonogo.renderWith` reaches into, named so
 * the leg can BUILD them.
 *
 * `renderWith` entries are paths, not specifiers (an Uplink may not depend on a
 * private package), and the page harness bundles those files from SOURCE. Their
 * own imports still resolve through `node_modules` to a dist, so a leg that
 * built only `<pkg>...` has no `packages/core/dist` on disk and the render dies
 * with "Could not resolve @ksp-gonogo/core" before it has rendered anything.
 * Nothing in the filter graph can infer this: the dependency is a file path
 * pnpm never sees.
 */
const renderHostPackages = (clientDir, manifest) => {
  const declared = manifest?.gonogo?.renderWith;
  if (!Array.isArray(declared)) return [];
  const names = new Set();
  for (const entry of declared) {
    if (typeof entry !== "string") continue;
    let dir = dirname(join(clientDir, entry));
    while (dir.startsWith(ROOT)) {
      const owner = readJson(join(dir, "package.json"));
      if (owner?.name) {
        names.add(owner.name);
        break;
      }
      dir = dirname(dir);
    }
  }
  return [...names].sort();
};

const uplinks = readdirSync(MOD, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^Gonogo.*Uplink$/.test(entry.name))
  .map((entry) => entry.name)
  .sort()
  .map((id) => {
    const clientDir = join(MOD, id, "client");
    const manifest = readJson(join(clientDir, "package.json"));
    const scripts = Object.keys(manifest?.scripts ?? {});
    return {
      id,
      /** npm package name, or "" when this Uplink has no client half. */
      pkg: manifest?.name ?? "",
      client: manifest !== null,
      csproj: existsSync(join(MOD, id, `${id}.csproj`)),
      tests: existsSync(join(MOD, `${id}.Tests`)),
      contract: existsSync(join(MOD, `${id}.Contract`)),
      generated: existsSync(join(clientDir, "src", "__generated__")),
      // Emitted as strings because a matrix value has to survive `toJSON` into
      // a shell `if:`; an array of one reads as its element and an empty array
      // as nothing at all, which is how a step silently stops running.
      render: scripts.includes("render"),
      typecheck: scripts.includes("typecheck"),
      /**
       * Space-separated for the same reason: the Build step splits it into
       * `--filter` arguments, and an empty string contributes none.
       */
      renderHosts: renderHostPackages(clientDir, manifest).join(" "),
    };
  });

if (uplinks.length < FLOOR) {
  console.error(
    `✖ uplink matrix: discovered only ${uplinks.length} Uplink(s), fewer than this repo has ever had (${FLOOR}).\n` +
      `  An empty or short matrix produces a job that SKIPS, and a skipped matrix job reports\n` +
      `  as successful. The discovery is broken rather than the tree being small.`,
  );
  process.exit(1);
}

const mode = process.argv[2];
if (mode === "--github") {
  console.log(`matrix=${JSON.stringify({ uplink: uplinks })}`);
} else if (mode === "--ids") {
  for (const uplink of uplinks) console.log(uplink.id);
} else {
  console.log(JSON.stringify(uplinks, null, 2));
}
