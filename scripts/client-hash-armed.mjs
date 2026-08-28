#!/usr/bin/env node
/**
 * Refuse to release an Uplink whose DLL vouches for nothing.
 *
 * ## The check this protects is silently two-way today
 *
 * The loader compares three independent witnesses of a client bundle: the
 * registry index's hash, the bytes it fetched, and `expectedClientHash` from the
 * running mod. The third is baked into the DLL at release build by
 * `mod/scripts/bake-client-hash.mjs`.
 *
 * That script is written, unit-tested, documented to Uplink authors, and invoked
 * by nothing. So every `ExpectedClientHash.g.cs` in this repo reads `""`, the
 * manifest reports null, and the loader degrades to the two-way index==bytes
 * check and records the mod arm as pending. Nothing fails. The author docs
 * promise a check that fires, and for a bundled Uplink it never has.
 *
 * An empty hash is exactly the shape this project keeps relearning: an
 * instrument that cannot express its own failure reports success. `""` is not
 * "no opinion", it is "I could not vouch for this and said nothing".
 *
 * ## A shrink-only ratchet, not a red gate
 *
 * Seeded red for every Uplink would be a second permanently-failing job, and this
 * repo already owns one and has twice had a real failure hide behind it. So the
 * current nine are grandfathered in `UNARMED_DEBT` and anything NOT listed is
 * held to armed: a new Uplink vouches for its bundle from the day it lands.
 *
 * Both directions, like every other ratchet here. An entry that becomes armed and
 * stays listed fails as STALE, because a debt list nobody prunes stops describing
 * anything.
 *
 * Usage:
 *   client-hash-armed.mjs           fail on an unexcused empty hash, or a stale excuse
 *   client-hash-armed.mjs --report  print the state and exit 0
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = process.argv.includes("--report");

/**
 * Uplinks whose DLL does not yet vouch for its client bundle. SHRINK ONLY.
 *
 * Seeded 2026-08-28 at NINE, which is every client-bearing Uplink in the repo:
 * two have an `ExpectedClientHash.g.cs` reading `""` and seven have no such file
 * at all. Nothing has ever baked one, so the loader's third witness has never
 * fired for a bundled Uplink.
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
  "GonogoKerbcastUplink",
  "GonogoKosUplink",

  "GonogoMechJebUplink",
  "GonogoPrincipiaUplink",
  "GonogoRealAntennasUplink",
  "GonogoRp1Uplink",
  /*
   * Added 2026-08-28 with the Uplink, which is what this list says never to do,
   * so the reason has to stand on its own.
   *
   * The hash vouches for a bundle a consumer FETCHES, and this Uplink ships no
   * such bundle: like the seven bundled Uplinks above it, its client reaches the
   * app as a static import in `main.tsx`, so the loader's three-way check has no
   * fetched bytes to be the third witness over. Baking a hash now would mean
   * hashing something that is not the artifact anyone loads, and a wrong hash is
   * worse than an absent one: it makes the loader reject the real bundle.
   *
   * The bake is a RELEASE step by construction (see mod/scripts/bake-client-hash.mjs:
   * the bundle must exist and be hashed before the DLL compiles), and no workflow
   * in this repo runs it, which is why all ten entries here are unarmed rather
   * than eight. The entry clears when this Uplink is distributed as a fetched
   * bundle and the release path bakes the hash, not before.
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
      detail: 'no `public const string Value = "…"` in the generated file',
    };
  }
  return matched[1]
    ? { id: leg.id, state: "armed", detail: matched[1] }
    : { id: leg.id, state: "empty", detail: "vouches for nothing" };
});

for (const row of rows) {
  console.log(`  ${row.state.padEnd(10)} ${row.id.padEnd(38)} ${row.detail}`);
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
      "    node mod/scripts/bake-client-hash.mjs <bundle> <out>/ExpectedClientHash.g.cs <namespace>",
  );
  process.exit(1);
}

console.log(
  `\n${rows.length - unarmed.length} of ${rows.length} bundled Uplink(s) vouch for their client ` +
    `bundle; ${unarmed.length} in UNARMED_DEBT, none outside it.`,
);
