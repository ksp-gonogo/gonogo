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
 * gate entirely: it is read/write "as of now", not "as of ut - delay". That
 * is the right call for ground-side facts the command centre knows
 * independent of any vessel's comms link (launch-site roster, uplink
 * health, career funds, DLC ownership, scan coverage, the RA link-quality
 * numbers ABOUT the link itself). It is never the right call for vessel
 * telemetry: anything that describes the state of a craft in flight must
 * ride the delay so operators can't see the future. This test is the
 * backstop: every production TrueNow declaration is enumerated below with
 * a one-line justification, and any new/changed one fails the build until
 * a human adds/edits that line.
 *
 * Same shape as `uplink-boundary.test.ts`'s ratchet (seeded allowlist,
 * fails on new/removed/stale entries) but per-file COUNT rather than
 * per-file presence, because a single file can legitimately declare
 * several TrueNow channels (SpaceCenterUplink.cs has 7).
 *
 * Why a source scan, not runtime enumeration: every production uplink that
 * declares a TrueNow channel lives in a KSP-dependent assembly
 * (Gonogo.KSP, GonogoScansatUplink, GonogoRealAntennasUplink) that no test
 * project references: there is no way to load the real registered
 * declarations at test time. This is the same ratchet shape as its sibling
 * uplink-boundary.test.ts, keyed on the TrueNow declaration form instead of
 * a mod token.
 *
 * The walk/root helpers below are intentionally copied from
 * uplink-boundary.test.ts rather than shared: each ratchet keeps its own
 * scaffolding so a change to one can't silently reshape the other's scan.
 */

// Matches the explicit declaration form:
//   Delay = DelayRole.TrueNow,
// The single `=` (not `==`) is what keeps this from matching the runtime
// comparison `decl.Delay == DelayRole.TrueNow` in ChannelEngine.cs.
const EXPLICIT_TRUENOW = /Delay\s*=\s*DelayRole\.TrueNow/g;

// Matches the helper-factory form used by CommsCoreUplink.cs and
// RealAntennasUplink.cs: both the `private static ChannelDeclaration
// TrueNow(string topic) => ...` declaration line itself and every
// `TrueNow(SomeTopic)` call site. Counting call sites is deliberate: it
// closes the hole where adding a new `TrueNow("comms.foo")` channel
// through the helper would otherwise add no `Delay =` line for the
// EXPLICIT_TRUENOW regex to catch.
const HELPER_TRUENOW = /(?<![.\w])TrueNow\s*\(/g;

/**
 * KNOWN BLIND SPOT, measured 2026-09-02: the helper regex closes the hole only
 * for a helper literally NAMED `TrueNow`. A helper that sets the same
 * `Delay = DelayRole.TrueNow` under any other name contributes exactly ONE
 * match, the line inside its own body, no matter how many channels are built
 * through it.
 *
 * Two exist. `Rp1ScUplink.Ground(topic)` carries 25 channels and scores 1;
 * `KerbalismUplink.Static(topic)` carries 1 and scores 1. So the numbers in
 * this file total 48 while the mod actually declares 66 delay-bypassing
 * channels, and rp1 alone is 25 of them, 38% of every bypass in the tree,
 * behind a single allowlist line reading 1.
 *
 * The consequence is not a wrong number, it is an ungated one: a 26th rp1
 * channel changes no count here, so nothing asks whether it is ground-side.
 * The entries themselves are honest about this (Rp1ScUplink's own note says
 * "1 explicit declaration, in the `Ground` helper every channel is built
 * through"), which is why this is recorded rather than quietly re-seeded:
 * counting per channel would rewrite every count and every arithmetic note in
 * this file, and that is the operator's call, not a drive-by.
 */

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
// removed/reclassified) fails until the number here is lowered to match,
// that's what keeps this a ratchet and not just a snapshot.
// ---------------------------------------------------------------------
const ALLOWED_TRUENOW: Record<string, number> = {
  // Launch sites, VAB/SPH craft roster, revert availability, DLC
  // ownership, map POIs (KSC + contract waypoints), and the Astronaut
  // Complex hire pool (applicant roster + facility cap): facilities/
  // inventory/mission facts about the space centre itself, known to the
  // command centre independent of any vessel's comms link, not flight
  // state. The Astronaut Complex is at KSC, so its applicant pool is the
  // same ground-side class as launchSites/crewRoster. 7 explicit declarations.
  "mod/Gonogo.KSP/SpaceCenterUplink.cs": 7,

  // commandCentre.roster: the LIST of command centres a dashboard can select as
  // its vantage. Correct as TrueNow for the KSC-only present: KSC + stock Extra
  // Ground Stations + Kerbal Konstructs sites are FIXED ground-registry facts
  // (their existence and position are known a priori, independent of any vessel's
  // comms link), the same class as SpaceCenterUplink's launchSites/pois above.
  //
  // DELAY-HONESTY NOTE (Phase-2 requirement, flagged, not yet triggered): a
  // CREWED forward command centre becoming commandable is an EVENT at a distant
  // vessel. Publishing the roster TrueNow would leak "a distant crewed station is
  // now a command centre" INSTANTLY, before that vessel's own (delayed) telemetry
  // arrives, a genuine delay-honesty violation. So when crewed centres are
  // enumerated (Phase 2), the roster's crewed entries MUST be delay-gated: move
  // the roster to Delayed, or split crewed entries onto a Delayed channel. Today
  // only StockHomeNodeSource (ground-registry) is honest as TrueNow; the crewed
  // source's delay-gating is the Phase-2 follow-up. 1 explicit declaration.
  "mod/Gonogo.KSP/CommandCentres/CommandCentreDelayUplink.cs": 1,

  // flight.simulation: whether the flight on screen is one of RP-1's
  // REHEARSALS. Meta about the stream rather than an observation of a craft,
  // the same class as comms.delay: a channel that told an operator "this is a
  // simulation" only after the light-time had elapsed would be describing the
  // board they were looking at four minutes ago, and the delay it reports is
  // the delay being cut for that very flight. Nothing about a rehearsal
  // travels down a link, because there is no craft at the far end of one.
  // 1 explicit declaration.
  "mod/Gonogo.KSP/FlightUplink.cs": 1,

  // Active-strategies roster, funds/science/rep totals, contract board:
  // career/admin bookkeeping the centre always knows, independent of any
  // vessel's comms link. 2 explicit declarations.
  "mod/Gonogo.KSP/CareerUplink.cs": 2,

  // KSP version/build id and similar mod-host facts, not vessel state, plus
  // system.frame: what frame the player's own navigation view is in. That is a
  // fact about their screen rather than anything observed down a link, so no
  // delay could apply, and delaying it would make a widget following the
  // control frame lag a change the operator made themselves.
  // 4 explicit declarations.
  "mod/Gonogo.KSP/SystemUplink.cs": 4,

  // Comms-LINK meta (connectivity, signal strength, control state, path,
  // network, and the live delay value itself), facts ABOUT the link the
  // delay is computed from, so they can't ride their own delay without a
  // circular dependency. Joined by comms.occlusion, which is ground-side by
  // an even wider margin: not an observation of the vessel at all, but the
  // universe's geometry plus the rule the elected comms backend applies to
  // it, and delaying the rule would have a predictor computing tomorrow's
  // blackout from yesterday's assumptions. Joined too by comms.commandCentre,
  // which names WHICH centre the active vessel's OWN path resolved to: a node
  // its own comms.path already discloses raw, not a fact about another vessel.
  // Declared via the `TrueNow(topic)` helper: 1 explicit `Delay =` line inside
  // the helper body + 8 call sites (one per topic) + the helper's own
  // declaration line (also matches the call-site regex) = 9 helper matches.
  // 1 explicit + 9 helper = 10.
  "mod/Gonogo.KSP/CommsCoreUplink.cs": 10,

  // RealAntennas link-quality/data-rate/link-margin, plus
  // realantennas.available (whether RA is installed, same install-fact
  // class as scansat/kerbcast .available) and realantennas.hopRates (the
  // per-hop forward band rate that left CommsHop for this Uplink's own
  // channel, a ground-side fact about the link the same as the rest): same
  // "facts about the link (or its presence)" class as CommsCoreUplink above,
  // same helper shape: 1 explicit `Delay =` line inside the helper body + 5
  // call sites + the helper's own declaration line = 6 helper matches. 1
  // explicit + 6 helper = 7.
  "mod/GonogoRealAntennasUplink/RealAntennasUplink.cs": 7,

  // kerbalism.available (whether the Kerbalism mod is INSTALLED, same
  // install-fact class as scansat/kerbcast .available) + kerbalism.features
  // (the profile's auto-detected feature toggles: a ground-side fact about
  // the save's Kerbalism configuration, not a live vessel reading). Both via
  // the `TrueNow(topic)` helper: 1 explicit `Delay =` line inside the helper
  // body + 2 call sites + the helper's own declaration line = 3 helper
  // matches. 1 explicit + 3 helper = 4.
  //
  // Plus kerbalism.profile, which carries the loaded profile's own rules,
  // processes and resource definitions so the app can derive the resource
  // graph without gonogo naming a resource. Same class as kerbalism.features
  // and reviewed on the same grounds: it is the player's INSTALL talking about
  // itself, read once at load from static config, and it cannot leak a vessel's
  // future state because it carries no vessel state and never changes within a
  // session. It rides its own `Static(topic)` helper rather than `TrueNow`
  // (a much longer keyframe interval; a static payload should not re-emit at
  // telemetry cadence), so it contributes exactly 1 more EXPLICIT match, the
  // `Delay = DelayRole.TrueNow` line inside that helper. Its call site is
  // `Static(ProfileTopic)`, which HELPER_TRUENOW does not match. 4 + 1 = 5.
  "mod/GonogoKerbalismUplink/KerbalismUplink.cs": 5,
  // avionics.available: whether the RP-1 avionics assembly is INSTALLED, a
  // fact about the player's install the command centre knows independent of any
  // vessel's comms link, same class as kerbcast.available / uplink health. (Its
  // sibling avionics.status is the per-vessel controllable-mass reading and is
  // correctly Delayed.) 1 explicit declaration.
  "mod/GonogoAvionicsUplink/AvionicsUplink.cs": 1,
  // realfuels.available: whether the RealFuels assembly is INSTALLED, the same
  // install-fact class as avionics.available above. (Its two siblings,
  // realfuels.engines and realfuels.boiloff, are per-vessel readings and are
  // correctly Delayed.) 1 explicit declaration.
  "mod/GonogoRealFuelsUplink/RealFuelsUplink.cs": 1,
  // aero.available: whether a full-fidelity aerodynamics model is INSTALLED and
  // readable, a fact about the player's install the command centre knows
  // independent of any vessel's comms link, same class as avionics.available
  // above. Its sibling aero.state is the per-vessel aerodynamic reading and is
  // correctly Delayed: angle of attack and stall are exactly the kind of
  // in-flight state an operator must not see ahead of light-time.
  // 1 explicit declaration.
  "mod/GonogoFerramAerospaceResearchUplink/FerramAerospaceResearchUplink.cs": 1,

  // Every rp1.* channel: RP-1's space centre, read at the KSC. The build queue,
  // the launch complexes and their pads, the rollout operations, the research
  // queue, the payroll and Confidence are all ground state the command centre
  // knows independent of any vessel's comms link, exactly the class
  // CareerUplink's career.status and SpaceCenterUplink's launch sites are in.
  // Nothing here is read off a craft. 1 explicit declaration, in the `Ground`
  // helper every channel is built through.
  "mod/GonogoRp1Uplink/Rp1ScUplink.cs": 1,

  // science.archive: the whole-career R&D archive (banked science read at
  // KSC/R&D). Career-wide ground-side bookkeeping the command centre always
  // knows, independent of any vessel's comms link, the same class as
  // CareerUplink's career.status/career.mode. Every other science.* channel
  // reads live onboard vessel state and stays Delayed. 1 explicit declaration.
  "mod/Gonogo.KSP/ScienceCoreUplink.cs": 1,

  // system.uplinks (registered-uplink health/availability: a fact about
  // the MOD itself) + system.uplink.pending (what the centre dispatched
  // and when: ground-side bookkeeping, not vessel telemetry) + system.units
  // (the contract's own unit descriptor, reflected off assembly metadata: it
  // describes the WIRE FORMAT rather than anything happening in space, so
  // there is no light-time for it to travel and delaying it would leave a
  // consumer unable to read the very frames the delay applies to)
  // + system.uplink.gates (every gated command's standing verdict: what the
  // GROUND knows about the game right now, sampled on the main thread and
  // published so a control can be drawn dark before it is pressed). The last
  // one is worth spelling out because it describes commands that ARE delayed:
  // the DISPATCH still takes its light-time, but knowing in advance does not,
  // and holding the verdict behind the reveal horizon would tell an operator
  // the pad was clear minutes after a rocket rolled out onto it.
  // + system.channels (every declared channel's emission counters: a fact
  // about the ENGINE, how many times it considered each channel and how many
  // of those it emitted, which never travelled up a comms link because it
  // never left the mod. Holding a diagnostic behind the light-time horizon
  // would be perverse: the operator asking why a channel is silent is asking
  // about the mod in front of them, and the answer would arrive a light-time
  // after the question). 5 explicit declarations.
  "mod/Sitrep.Host/ChannelEngine.cs": 5,

  // principia.settings (the plotting frame, the prediction and flight-plan
  // integrator bounds, the analysis window, the declutter and drawing toggles,
  // and the logging thresholds). These are the OPERATOR'S OWN SETTINGS and the
  // local mod's configuration, held on the same machine the command centre runs
  // beside: facts about how the numbers are being produced rather than anything
  // happening in space, so there is no light-time for them to travel. Delaying
  // them would be actively wrong, not merely pedantic: someone who tightens a
  // prediction tolerance would keep reading their old basis for every propagated
  // number on the dashboard until light-time had passed, which is the opposite
  // of what a qualifier is for. The flight-plan channel beside it in the same
  // file IS a claim about a craft's future and stays Delayed.
  // Which Principia build is installed used to be a second TrueNow declaration
  // here. It is not a channel any more: it is the same class of ground-side fact
  // as uplink health, so it IS uplink health now, and `system.uplinks` is already
  // TrueNow where the engine declares it.
  // 1 explicit declaration.
  "mod/GonogoPrincipiaUplink/PrincipiaUplink.cs": 1,
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
          `independent of any vessel's comms link: same class as launch sites, ` +
          `career funds, uplink health) and you add/bump its ALLOWED_TRUENOW line ` +
          `in packages/core/src/truenow-allowlist.test.ts WITH a one-line ` +
          `justification, or it is vessel state and MUST NOT be TrueNow, route it ` +
          `through the normal signal-delay gate instead.`,
      );
    }

    if (staleFiles.length > 0) {
      const lines = staleFiles.map(
        (file) =>
          `  ${file}: allowlisted for ${ALLOWED_TRUENOW[file]}, found 0`,
      );
      throw new Error(
        `Stale ALLOWED_TRUENOW entries: these file(s) no longer contain a ` +
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
