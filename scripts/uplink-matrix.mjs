#!/usr/bin/env node
/**
 * Every Uplink under `mod/`, DISCOVERED rather than hand-listed, for the scripts
 * and tests that walk the Uplinks (the page gates, the wire-payload coverage, the
 * baked client hash).
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
 * Each entry carries capability facts computed from disk, because an Uplink's
 * shape is not fixed: `GonogoBreakingGroundUplink`, the one Uplink bundled here,
 * is client-only, while the planted fixture has a plugin csproj, a Tests sibling
 * and a contract slice and no client. A walker that assumed one shape would
 * skip the other and report green.
 *
 * Usage:
 *   node scripts/uplink-matrix.mjs             pretty JSON, for a human
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
 * It stands in for a floor on the count. A discovery that matches nothing
 * returns an empty list, and every walker downstream then checks nothing and
 * passes, so a broken walk has to fail here; a floor cannot tell "the walk
 * broke" from a tree that legitimately holds fewer Uplinks. The plant can, at
 * any number of Uplinks including none.
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
 * The immediate subdirectories of `modDir` that git tracks at least one file
 * under.
 *
 * A directory on disk is not evidence of an Uplink. A departed one leaves its
 * `obj/` and `dist/` behind, and those are untracked, so the name survives a
 * removal that took every source file with it. Four phantom entries once lived
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
 * Every tracked `Gonogo*Uplink` directory directly under `modDir`, with its
 * capability facts.
 *
 * An empty result here is not caught by anything in this function, and does not
 * need to be: the planted fixture below is discovered the same way, so a walk
 * that has stopped seeing real directories has stopped seeing that one too and
 * refuses to emit anything at all.
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
      return {
        id,
        /** npm package name, or "" when this Uplink has no client half. */
        pkg: manifest?.name ?? "",
        client: manifest !== null,
        csproj: existsSync(join(modDir, id, `${id}.csproj`)),
        tests: existsSync(join(modDir, `${id}.Tests`)),
        contract: existsSync(join(modDir, `${id}.Contract`)),
        generated: existsSync(join(clientDir, "src", "__generated__")),
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
      `  expected exactly one entry matching ${JSON.stringify(PLANTED_LEG)}.\n` +
      `  A broken discovery returns a short or empty list, and every walker downstream then checks\n` +
      `  nothing and passes, so it refuses to emit one. Zero Uplinks over the real tree is valid; this is not that.`,
  );
  process.exit(1);
}

const uplinks = discover(MOD);

/** Prints `uplinks` in the shape `mode` asks for. */
function printMatrix(mode, uplinks) {
  if (mode === "--ids") {
    for (const uplink of uplinks) console.log(uplink.id);
    return;
  }
  console.log(JSON.stringify(uplinks, null, 2));
}

printMatrix(process.argv[2], uplinks);
