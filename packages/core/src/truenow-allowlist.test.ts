import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * TrueNow-allowlist guardrail (G2): prevent a new delay-bypassing channel
 * (`Delay = DelayRole.TrueNow`) from being declared anywhere in `mod/`
 * without a reviewed, justified allowlist edit.
 *
 * `DelayRole.TrueNow` means a channel skips gonogo's signal-delay reveal
 * gate entirely — it is read/write "as of now", not "as of ut - delay". That
 * is the right call for ground-side facts the command centre knows
 * independent of any vessel's comms link (launch-site roster, uplink
 * health, career funds, DLC ownership, scan coverage, the RA link-quality
 * numbers ABOUT the link itself). It is never the right call for vessel
 * telemetry — anything that describes the state of a craft in flight must
 * ride the delay so operators can't see the future. This test is the
 * backstop: every production TrueNow declaration is enumerated below with
 * a one-line justification, and any new/changed one fails the build until
 * a human adds/edits that line.
 *
 * Same shape as `uplink-boundary.test.ts`'s ratchet (seeded allowlist,
 * fails on new/removed/stale entries) but per-file COUNT rather than
 * per-file presence, because a single file can legitimately declare
 * several TrueNow channels (SpaceCenterUplink.cs has 5).
 *
 * Why a source scan, not runtime enumeration: every production uplink that
 * declares a TrueNow channel lives in a KSP-dependent assembly
 * (Gonogo.KSP, GonogoScansatUplink, GonogoRealAntennasUplink) that no test
 * project references — there is no way to load the real registered
 * declarations at test time. This is the same ratchet shape as its sibling
 * uplink-boundary.test.ts, keyed on the TrueNow declaration form instead of
 * a mod token.
 *
 * The walk/root helpers below are intentionally copied from
 * uplink-boundary.test.ts rather than shared — each ratchet keeps its own
 * scaffolding so a change to one can't silently reshape the other's scan.
 */

// Matches the explicit declaration form:
//   Delay = DelayRole.TrueNow,
// The single `=` (not `==`) is what keeps this from matching the runtime
// comparison `decl.Delay == DelayRole.TrueNow` in ChannelEngine.cs.
const EXPLICIT_TRUENOW = /Delay\s*=\s*DelayRole\.TrueNow/g;

// Matches the helper-factory form used by CommsCoreUplink.cs and
// RealAntennasUplink.cs — both the `private static ChannelDeclaration
// TrueNow(string topic) => ...` declaration line itself and every
// `TrueNow(SomeTopic)` call site. Counting call sites is deliberate: it
// closes the hole where adding a new `TrueNow("comms.foo")` channel
// through the helper would otherwise add no `Delay =` line for the
// EXPLICIT_TRUENOW regex to catch.
const HELPER_TRUENOW = /(?<![.\w])TrueNow\s*\(/g;

const SCAN_EXTENSION = /\.cs$/;
const SKIP_DIRS = new Set(["bin", "obj", "node_modules"]);
const SKIP_DIR_PATTERN = /\.(Tests|IntegrationTests)$/;

// ---------------------------------------------------------------------
// Seeded allowlist. One entry per file that legitimately declares one or
// more TrueNow channels, each with a one-line justification for why that
// channel is a ground-side fact rather than vessel telemetry. A file
// scoring 0 has no entry.
//
// To ratchet: a NEW TrueNow declaration (new file, or a higher count in
// an existing file) fails the build until this list is edited alongside
// it, WITH a justification. A count that drops (a TrueNow channel was
// removed/reclassified) fails until the number here is lowered to match —
// that's what keeps this a ratchet and not just a snapshot.
// ---------------------------------------------------------------------
const ALLOWED_TRUENOW: Record<string, number> = {
  // Launch sites, VAB/SPH craft roster, revert availability, DLC
  // ownership: facilities/inventory facts about the space centre itself,
  // not any vessel's flight state. 5 explicit declarations.
  "mod/Gonogo.KSP/SpaceCenterUplink.cs": 5,

  // Active-strategies roster, funds/science/rep totals, contract board:
  // career/admin bookkeeping the centre always knows, independent of any
  // vessel's comms link. 2 explicit declarations.
  "mod/Gonogo.KSP/CareerUplink.cs": 2,

  // KSP version/build id and similar mod-host facts, not vessel state.
  // 3 explicit declarations.
  "mod/Gonogo.KSP/SystemUplink.cs": 3,

  // kerbcast.available: whether the kerbcast mod is INSTALLED — a fact about
  // the player's install that the command centre knows independent of any
  // vessel's comms link, exactly the same class as uplink health itself. (Its
  // sibling channel kerbcast.cameras is the camera inventory ON the craft and
  // is correctly Delayed, not TrueNow.) 1 explicit declaration.
  "mod/GonogoKerbcastUplink/KerbcastUplink.cs": 1,

  // Comms-LINK meta (connectivity, signal strength, control state, path,
  // network, and the live delay value itself) — facts ABOUT the link the
  // delay is computed from, so they can't ride their own delay without a
  // circular dependency. Declared via the `TrueNow(topic)` helper: 1
  // explicit `Delay =` line inside the helper body + 6 call sites (one
  // per topic) + the helper's own declaration line (also matches the
  // call-site regex) = 7 helper matches. 1 explicit + 7 helper = 8.
  "mod/Gonogo.KSP/CommsCoreUplink.cs": 8,

  // RealAntennas link-quality/data-rate/link-margin — same "facts about
  // the link" class as CommsCoreUplink above, same helper shape: 1
  // explicit `Delay =` line inside the helper body + 3 call sites + the
  // helper's own declaration line = 4 helper matches. 1 explicit + 4
  // helper = 5.
  "mod/GonogoRealAntennasUplink/RealAntennasUplink.cs": 5,

  // SCANsat scan-coverage availability — ground-side (the map data the
  // centre already has), not a live vessel reading. 1 explicit
  // declaration.
  "mod/GonogoScansatUplink/ScansatUplink.cs": 1,

  // system.uplinks (registered-uplink health/availability — a fact about
  // the MOD itself) + system.uplink.pending (what the centre dispatched
  // and when — ground-side bookkeeping, not vessel telemetry). 2 explicit
  // declarations.
  "mod/Sitrep.Host/ChannelEngine.cs": 2,
};

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (SKIP_DIR_PATTERN.test(name)) continue;
      yield* walk(path);
    } else if (SCAN_EXTENSION.test(name)) {
      yield path;
    }
  }
}

/** repo-relative path -> total TrueNow match count, for every .cs file under mod/ that scores > 0. */
function scanTrueNowCounts(root: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const modDir = join(root, "mod");
  if (!existsSync(modDir)) return counts;
  for (const file of walk(modDir)) {
    const content = readFileSync(file, "utf8");
    const explicitCount = [...content.matchAll(EXPLICIT_TRUENOW)].length;
    const helperCount = [...content.matchAll(HELPER_TRUENOW)].length;
    const total = explicitCount + helperCount;
    if (total > 0) {
      counts[relative(root, file)] = total;
    }
  }
  return counts;
}

describe("TrueNow allowlist: delay-bypassing channels are a reviewed, ratcheted set", () => {
  it("matches the seeded allowlist exactly", () => {
    const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
    const found = scanTrueNowCounts(root);

    const newOrChangedFiles = Object.keys(found).filter(
      (file) => found[file] !== ALLOWED_TRUENOW[file],
    );
    const staleFiles = Object.keys(ALLOWED_TRUENOW).filter(
      (file) => !(file in found),
    );

    if (newOrChangedFiles.length > 0) {
      const lines = newOrChangedFiles.map((file) => {
        const expected = ALLOWED_TRUENOW[file];
        const actual = found[file];
        if (expected === undefined) {
          return `  ${file}: ${actual} TrueNow declaration(s), no allowlist entry`;
        }
        return `  ${file}: expected ${expected}, found ${actual}`;
      });
      throw new Error(
        `TrueNow declaration count changed or is new in the following file(s):\n` +
          `${lines.join("\n")}\n\n` +
          `Either this channel is ground-side (a fact the command centre knows ` +
          `independent of any vessel's comms link — same class as launch sites, ` +
          `career funds, uplink health) and you add/bump its ALLOWED_TRUENOW line ` +
          `in packages/core/src/truenow-allowlist.test.ts WITH a one-line ` +
          `justification, or it is vessel state and MUST NOT be TrueNow — route it ` +
          `through the normal signal-delay gate instead.`,
      );
    }

    if (staleFiles.length > 0) {
      const lines = staleFiles.map(
        (file) =>
          `  ${file}: allowlisted for ${ALLOWED_TRUENOW[file]}, found 0`,
      );
      throw new Error(
        `Stale ALLOWED_TRUENOW entries — these file(s) no longer contain a ` +
          `matching TrueNow declaration (removed, reclassified, or the file ` +
          `moved/was deleted). Delete the line(s) from ` +
          `packages/core/src/truenow-allowlist.test.ts to ratchet the gate down:\n` +
          `${lines.join("\n")}`,
      );
    }

    expect(newOrChangedFiles).toEqual([]);
    expect(staleFiles).toEqual([]);
    // Walks all of mod/; under concurrent core-suite load this can exceed
    // vitest's 5s default (it runs alongside uplink-boundary's repo walk).
  }, 30_000);
});
