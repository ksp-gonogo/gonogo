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
 * The Uplinks are RAGGED. Seven directories: all seven have a client, six have
 * a plugin csproj, six have a contract slice, and `GonogoBreakingGroundUplink`
 * is client-only. A uniform matrix running the same steps everywhere would
 * no-op on some of its cells and report green, which is the failure this whole
 * exercise exists to stop. The C#-only shape has left with the Uplinks that had
 * it and the fields still carry it, because the next arrival may bring it back.
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
 *   node scripts/uplink-matrix.mjs --github    `matrix=<json>` and `count=<n>` for $GITHUB_OUTPUT
 *   node scripts/uplink-matrix.mjs --ids       one id per line
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOD = join(ROOT, "mod");

/**
 * The fixture tree the discovery is proved against before it is trusted: one
 * planted Uplink with a plugin csproj, a Tests sibling and a contract slice, the
 * same tree `Sitrep.Core.Tests/UplinkProjects.cs` proves the C# walks on.
 *
 * It replaced a floor on the count. A discovery that matches nothing emits an
 * empty matrix and a skipped job reports as successful, so a broken walk has to
 * fail here; but every mod Uplink is leaving for the gonogo-uplinks repo, and a
 * floor on a count heading for zero cannot tell "all moved" from "the walk
 * broke". The plant can, at any number of Uplinks including none.
 */
const PLANT_MOD = join(MOD, "Sitrep.Core.Tests", "UplinkWalkPlant");

const PLANTED_LEG = {
  id: "GonogoPlantedUplink",
  client: false,
  csproj: true,
  tests: true,
  contract: true,
};

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

/**
 * The immediate subdirectories of `modDir` that git tracks at least one file
 * under.
 *
 * A directory on disk is not evidence of an Uplink. A departed one leaves its
 * `obj/` and `dist/` behind, and those are untracked, so the name survives a
 * removal that took every source file with it. Four phantom legs once lived
 * that way: red locally, green on a clean CI checkout, which is the worst
 * direction for a disagreement to run because CI is the copy anyone trusts.
 *
 * Nothing finer than "has a tracked file" is asked, because the Uplinks are
 * ragged: one is client-only, others have no client, and requiring a particular
 * file would drop a shape rather than a phantom.
 */
const trackedChildren = (modDir) => {
  const prefix = relative(ROOT, modDir);
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--", prefix === "" ? "." : prefix],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const names = new Set();
  for (const rel of listed.split("\0")) {
    if (rel === "") continue;
    const within = prefix === "" ? rel : relative(prefix, rel);
    const [head, ...rest] = within.split("/");
    if (rest.length > 0) names.add(head);
  }
  return names;
};

/**
 * Every tracked `Gonogo*Uplink` directory directly under `modDir`, as a matrix
 * leg.
 *
 * An empty result here is not caught by anything in this function, and does not
 * need to be: the planted fixture below is discovered the same way, so a walk
 * that has stopped seeing real directories has stopped seeing that one too and
 * refuses to emit a matrix at all.
 */
const discover = (modDir) => {
  const tracked = trackedChildren(modDir);
  return readdirSync(modDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        /^Gonogo.*Uplink$/.test(entry.name) &&
        tracked.has(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .map((id) => {
      const clientDir = join(modDir, id, "client");
      const manifest = readJson(join(clientDir, "package.json"));
      const scripts = Object.keys(manifest?.scripts ?? {});
      return {
        id,
        /** npm package name, or "" when this Uplink has no client half. */
        pkg: manifest?.name ?? "",
        client: manifest !== null,
        csproj: existsSync(join(modDir, id, `${id}.csproj`)),
        tests: existsSync(join(modDir, `${id}.Tests`)),
        contract: existsSync(join(modDir, `${id}.Contract`)),
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
};

const planted = discover(PLANT_MOD);
const plantedWrong =
  planted.length !== 1 ||
  Object.entries(PLANTED_LEG).some(([key, value]) => planted[0][key] !== value);
if (plantedWrong) {
  console.error(
    `✖ uplink matrix: over the fixture at ${PLANT_MOD} the discovery found\n` +
      `  ${JSON.stringify(planted)}\n` +
      `  expected exactly one leg matching ${JSON.stringify(PLANTED_LEG)}.\n` +
      `  A broken discovery emits a short or empty matrix, and a skipped matrix job reports as\n` +
      `  successful, so it refuses to emit one. Zero legs over the real tree is valid; this is not that.`,
  );
  process.exit(1);
}

const uplinks = discover(MOD);

const mode = process.argv[2];
if (mode === "--github") {
  console.log(`matrix=${JSON.stringify({ uplink: uplinks })}`);
  console.log(`count=${uplinks.length}`);
} else if (mode === "--ids") {
  for (const uplink of uplinks) console.log(uplink.id);
} else {
  console.log(JSON.stringify(uplinks, null, 2));
}
