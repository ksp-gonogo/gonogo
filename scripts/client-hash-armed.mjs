#!/usr/bin/env node
/**
 * Refuse to release an Uplink whose DLL vouches for nothing.
 *
 * ## The check this protects is still two-way for most of them
 *
 * The loader compares three independent witnesses of a client bundle: the
 * registry index's hash, the bytes it fetched, and `expectedClientHash` from the
 * running mod. The third is baked into the DLL by
 * `packages/app/scripts/bake-uplink-hash.ts`, from the same bundler the app
 * ships with, because a hash of any other build is one the loader can never
 * match.
 *
 * That bake was written, unit-tested, documented to Uplink authors and invoked
 * by nothing until 2026-09-01, so every `ExpectedClientHash.g.cs` in the tree
 * read `""`. It runs now, and Kos and MechJeb are armed.
 *
 * The remaining eight have no scaffold at all: their manifest reports null, the
 * loader degrades to the two-way index==bytes check and records the mod arm as
 * pending. Nothing fails. The author docs promise a check that fires, and for
 * those it never has.
 *
 * An empty hash is exactly the shape this project keeps relearning: an
 * instrument that cannot express its own failure reports success. `""` is not
 * "no opinion", it is "I could not vouch for this and said nothing".
 *
 * ## A shrink-only ratchet, not a red gate
 *
 * Seeded red for every Uplink would be a second permanently-failing job, and this
 * repo already owns one and has twice had a real failure hide behind it. So the
 * remaining seven are grandfathered in `UNARMED_DEBT` and anything NOT listed is
 * held to armed: a new Uplink vouches for its bundle from the day it lands.
 *
 * Both directions, like every other ratchet here. An entry that becomes armed and
 * stays listed fails as STALE, because a debt list nobody prunes stops describing
 * anything.
 *
 * Usage:
 *   client-hash-armed.mjs                fail on an unexcused empty hash, or a stale excuse
 *   client-hash-armed.mjs --report       print the state and exit 0
 *   client-hash-armed.mjs --require <id> hold ONE Uplink to armed, debt list ignored
 *
 * `--require` is the release path's assertion, run by `_build-uplink-mod.yml`
 * between the bake and `dotnet build`. It ignores the debt list on purpose: the
 * list excuses what the TREE ships, and a release that has just baked a hash and
 * is about to compile a DLL around it has no excuse left to claim.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = process.argv.includes("--report");
const required = process.argv.includes("--require")
  ? process.argv[process.argv.indexOf("--require") + 1]
  : undefined;
if (process.argv.includes("--require") && !required) {
  console.error(
    "✖ --require needs an Uplink id, e.g. --require GonogoKosUplink",
  );
  process.exit(1);
}

/**
 * Uplinks whose DLL does not yet vouch for its client bundle. SHRINK ONLY.
 *
 * Seeded 2026-08-28 at NINE, which was every client-bearing Uplink in the repo,
 * because nothing had ever baked a hash. Down to EIGHT on 2026-09-01: Kos and
 * MechJeb, the two that carried the `ExpectedClientHash` scaffold, are armed
 * from the same bundler the app ships (`packages/app/uplink-bundle.ts`) and
 * held current by `bakedClientHash.test.ts`.
 *
 * The remaining eight have no scaffold at all: their `UplinkManifest` names no
 * `ExpectedClientHash`, so baking a file for one would compile a const nothing
 * reads and report success while the mod still vouched for nothing. Clearing an
 * entry means adding the scaffold and the manifest line first, then running
 * `pnpm --filter @ksp-gonogo/app bake-uplink-hash <UplinkId>`.
 *
 * A list rather than a red gate, for the reason this repo already owns one
 * permanently-red job and has twice had a real failure hide behind it. An Uplink
 * NOT listed here is held to armed, so anything authored from now on has to
 * vouch for its bundle from the day it lands, and only what was already broken is
 * grandfathered.
 *
 * Delete an entry when its hash is baked. An entry that is armed fails as STALE,
 * because a debt list nobody prunes stops describing anything.
 */
const UNARMED_DEBT = new Set([
  "GonogoAvionicsUplink",
  "GonogoFerramAerospaceResearchUplink",
  "GonogoKerbalismUplink",
  "GonogoPrincipiaUplink",
  "GonogoRealAntennasUplink",
  "GonogoRp1Uplink",
  /*
   * Added 2026-08-28 with the Uplink, which is what this list says never to do,
   * so the reason has to stand on its own.
   *
   * Its stated reason was that the client "reaches the app as a static import in
   * main.tsx", so there were no fetched bytes for a third witness to be over.
   * That was already false when it was written and is corrected here rather than
   * copied: `main.tsx` registers NOTHING statically, every client in
   * `uplink-bundle-targets.ts` is fetched and hashed by the loader, and this one
   * is in that list.
   *
   * The entry stands on the reason all eight share: the Uplink's `UplinkManifest`
   * names no `ExpectedClientHash`, so there is no const for a bake to fill. A
   * `.g.cs` written anyway would compile into the assembly, be read by nobody,
   * and let this gate report armed while the mod still vouched for nothing.
   */
  "GonogoRealFuelsUplink",
]);

/**
 * Discovered from the same matrix CI uses, never a list here. A hand-kept list of
 * which Uplinks have a client is the shape this repo has deleted five times, and
 * the failure mode is the one that matters: an Uplink missing from the list is an
 * Uplink this never checks, reported as a clean pass.
 */
const withClient = JSON.parse(
  execFileSync("node", [join(ROOT, "scripts/uplink-matrix.mjs")], {
    encoding: "utf8",
  }),
).filter((leg) => leg.client && leg.csproj);

/*
 * A run that examines nothing reports success. Both halves have to be true for
 * an Uplink to be checkable at all (a client to hash, a csproj to bake into), so
 * an empty set here means the matrix moved rather than that the repo has no
 * Uplinks.
 */
if (withClient.length === 0) {
  console.error(
    "✖ the matrix reported no Uplink with BOTH a client and a plugin csproj, so this examined\n" +
      "  nothing and would have exited clean. Either the matrix's shape changed or discovery is\n" +
      "  broken; a hash gate that inspects zero DLLs is worse than no gate.",
  );
  process.exit(1);
}

const HASH = /public const string Value = "([^"]*)"/;

const rows = withClient.map((leg) => {
  const generated = join(ROOT, "mod", leg.id, "ExpectedClientHash.g.cs");
  if (!existsSync(generated)) {
    return {
      id: leg.id,
      state: "absent",
      detail: "no ExpectedClientHash.g.cs",
    };
  }
  const matched = readFileSync(generated, "utf8").match(HASH);
  if (!matched) {
    return {
      id: leg.id,
      state: "unreadable",
      detail: 'no `public const string Value = "..."` in the generated file',
    };
  }
  return matched[1]
    ? { id: leg.id, state: "armed", detail: matched[1] }
    : { id: leg.id, state: "empty", detail: "vouches for nothing" };
});

for (const row of rows) {
  console.log(`  ${row.state.padEnd(10)} ${row.id.padEnd(38)} ${row.detail}`);
}

if (required) {
  const row = rows.find((candidate) => candidate.id === required);
  if (!row) {
    console.error(
      `\n✖ --require ${required}: no such client-bearing Uplink. A required id the matrix does not\n` +
        "  report is a typo that would otherwise pass by examining nothing.",
    );
    process.exit(1);
  }
  if (row.state !== "armed") {
    console.error(
      `\n✖ ${required} is about to compile a DLL that vouches for no client bundle (${row.state}).\n` +
        "  Bake the hash BEFORE the compile, from the bundle that ships:\n" +
        `    pnpm --filter @ksp-gonogo/app bake-uplink-hash ${required}`,
    );
    process.exit(1);
  }
  console.log(`\n${required} vouches for ${row.detail}.`);
  process.exit(0);
}

const unarmed = rows.filter((row) => row.state !== "armed");
const unexcused = unarmed.filter((row) => !UNARMED_DEBT.has(row.id));
// Both directions, the same as every other ratchet here: an entry that is armed
// has to leave the list, or the list stops describing the repo.
const stale = rows.filter(
  (row) => row.state === "armed" && UNARMED_DEBT.has(row.id),
);
if (report) {
  console.log(
    `\n${rows.length - unarmed.length} of ${rows.length} bundled Uplink(s) vouch for their client ` +
      `bundle. ${unarmed.length} in UNARMED_DEBT.`,
  );
  process.exit(0);
}

if (stale.length > 0) {
  console.error(
    `\n✖ ${stale.length} Uplink(s) now vouch for their bundle and are still in UNARMED_DEBT:\n` +
      stale.map((row) => `    ${row.id}`).join("\n") +
      "\n\n  Delete those entries from scripts/client-hash-armed.mjs to ratchet the gate down.",
  );
  process.exit(1);
}

if (unexcused.length > 0) {
  console.error(
    `\n✖ ${unexcused.length} Uplink(s) would ship a DLL that vouches for no client bundle:\n` +
      unexcused.map((row) => `    ${row.id} (${row.state})`).join("\n") +
      "\n\n  The loader's three-way check silently becomes two-way for these, and the author docs\n" +
      "  promise a check that fires. Bake the hash before compiling the DLL: the bundle has to\n" +
      "  exist and be hashed FIRST, which is why a release is two passes.\n" +
      "    pnpm --filter @ksp-gonogo/app bake-uplink-hash <UplinkId>",
  );
  process.exit(1);
}

console.log(
  `\n${rows.length - unarmed.length} of ${rows.length} bundled Uplink(s) vouch for their client ` +
    `bundle; ${unarmed.length} in UNARMED_DEBT, none outside it.`,
);
