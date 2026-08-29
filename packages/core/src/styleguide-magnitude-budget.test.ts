import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `.magnitude` is an escape hatch, and this is what makes reaching for it cost
 * something.
 *
 * The unit algebra can add, subtract, scale and compare `Value`s, and it knows
 * which quantities are instants and which are intervals. None of that helps if
 * the habit is to unwrap first and compute on bare numbers: before this budget
 * existed the entire arithmetic surface had ZERO product callers, not because
 * nothing computed, but because everything routed around it. An escape hatch
 * that is free to reach for is just the default path.
 *
 * Plenty of these unwraps are correct and always will be. A d3 scale wants a
 * number, `<progress value>` wants a number, `Math.max` wants a number. Those
 * stay on the list permanently, and that is the point: the list is not a
 * backlog, it is a budget. What it stops is the next piece of ARITHMETIC being
 * added silently.
 *
 * ## Adding to the list
 *
 * If a call site genuinely needs the raw number, raise its file's count and say
 * why in the same commit. Someone reads that reason. If you cannot write one,
 * the computation probably belongs in the algebra:
 *
 *     a.magnitude - b.magnitude    ->  a.minus(b)
 *     utA - utB.magnitude          ->  value("ut", utA).minus(utB)
 *     rate.magnitude * 3600        ->  rate.in("rad/h")
 *
 * Counts are per FILE rather than per line, because line numbers churn on every
 * edit above them and a ratchet that fails for unrelated reasons gets disabled.
 */

/**
 * Per-file `.magnitude` budget. A file may use FEWER than its number; it may
 * not use more, and a file absent from this map may not use any.
 */
const MAGNITUDE_BUDGET: Record<string, number> = {
  "mod/GonogoKerbalismUplink/client/src/processor.ts": 1,
  "mod/GonogoKerbalismUplink/client/src/SpaceWeather/index.tsx": 1,
  "mod/GonogoKerbalismUplink/client/src/resourceProjection.ts": 4,
  "mod/GonogoKerbalismUplink/client/src/ScienceFileManager/index.tsx": 1,
  "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx": 4,
  // 11, up from the 4 this file used while it was a React overlay drawing on a
  // host plot's axes, and the rise is the price of the overlay slot going away.
  // A CONTRIBUTION is handed raw Topic payloads rather than a host context, so
  // where it used to be given `ctx.terminalVelocityAt` and `ctx.projectDescent`
  // already built, it now unwraps the two terminal anchors, the height, the
  // speed and the body's radius and gravitational parameter to build them
  // itself. Every one of those feeds an integration or a square root, which is
  // arithmetic the algebra has no term for; the numbers a READER sees still go
  // out through `writeQuantity`.
  "mod/GonogoFerramAerospaceResearchUplink/client/src/DescentEnvelope/index.ts": 11,
  // 1: the contribution entry carries a BARE bits/sec so CommSignal can compare
  // legs to find the bottleneck. A comparison across a slot boundary cannot
  // carry a Value, because the entry crosses the published contract as JSON.
  "mod/GonogoRealAntennasUplink/client/src/CommSignal/hopRates.ts": 1,
  "mod/GonogoKosUplink/client/src/KosTerminal/index.tsx": 1,
  "mod/sitrep-sdk/src/command-delay.ts": 5,
  // 1, in `frameVector`, and this file exists so that number stays 1. The frame
  // arithmetic works in bare metres throughout (a rotation matrix has no unit to
  // carry), so SOMETHING has to unwrap a wire vector before `toFrame` sees it.
  // The alternative is every Uplink author doing it at their own call sites,
  // which in this repo was previously written as a cast and put `Value` objects
  // through arithmetic that wanted numbers. The unwrap is constrained to `"m"`
  // and `"m/s"` here, which is the check a hand-rolled one does not get.
  // 1: the view instant, read out to stamp when a composed plan was decided.
  // The wire carries it as a plain UT because the receiving side records it on
  // a receipt rather than doing algebra with it.
  // 6: the floors that turn an instant into calendar PARTS, plus the round
  // that lands the inverse back on a whole second. A day number is not a
  // quantity with a unit, it is an ordinal, so producing one is where the
  // algebra stops. Every RATIO still comes from the unit system: this file
  // owns none, which is what stops it being a second clock beside the one the
  // app renders through.
  "mod/sitrep-sdk/src/burn-clock.ts": 6,
  "mod/sitrep-sdk/src/api/index.ts": 1,
  "mod/sitrep-sdk/src/frames/index.ts": 1,
  // 2: the observed instant a plan was built from, and the comparison against
  // the view instant that catches a plan built from a state nobody could have
  // seen. Both are read out here because this file IS that boundary.
  // The uplink window is arithmetic on INSTANTS against a delay in seconds, and
  // the shared `commandWindow` it feeds takes plain numbers because the burn
  // editor computes the same window from the same numbers. Two of these are the
  // instants going in and one is the view clock; doing it in the algebra would
  // mean a second implementation of a deadline both surfaces have to agree on.
  "mod/GonogoPrincipiaUplink/client/src/PlanComposer/index.tsx": 3,
  // The one place a magnitude is unavoidable on the INPUT side: a DOM field
  // holds a string, so somewhere the value has to become a number and back.
  // Having it here once is what lets every widget stop doing it: `UnitInput`
  // emits a `Value`, so a call site never sees a bare number at all.
  "packages/ui-kit/src/UnitInput.tsx": 1,
  // Raised deliberately, and this file is where the escape hatch belongs: its
  // job IS the wire shape, and the receiving side binds every instant and every
  // Δv component to a plain double. A `Value` reaching it is refused from inside
  // the handler, which loses the whole plan and marks the vessel uplink
  // unavailable for the session. Unwrapping once here is what stops every caller
  // building that shape by hand and finding out the same way.
  "mod/sitrep-sdk/src/plan-composition.ts": 8,
  "mod/sitrep-sdk/src/spine/timeline-store.ts": 1,
  "mod/sitrep-sdk/src/testing/render.tsx": 1,
  "packages/app/src/alarms/WarpObserver.ts": 1,
  "packages/app/src/telemetry/KspCalendarObserver.tsx": 4,
  // 3, all three in `commsLegTimeSeconds`: a leg's share of the path delay is
  // `hopMeters * (delaySeconds / totalMeters)`, a length over a length, and the
  // algebra has no term for a ratio of two same-unit values. The three unwraps
  // are deliberately together so the route's other call sites hand it Values.
  "packages/components/src/CommSignal/commsRoute.ts": 3,
  "packages/components/src/CommSignal/index.tsx": 1,
  "packages/components/src/ContractManager/index.tsx": 2,
  "packages/components/src/CrewStatus/badge.ts": 2,
  "packages/components/src/CrewStatus/index.tsx": 1,
  "packages/components/src/CurrentOrbit/index.tsx": 3,
  "packages/components/src/FleetComms/index.tsx": 15,
  "packages/components/src/FleetRoster/index.tsx": 3,
  "packages/components/src/FuelStatus/index.tsx": 1,
  // 19, down from 34: every plot on this widget is a contribution now, and each
  // reads its own Topics. What the widget used to unwrap once and hand down as
  // props (the terrain patch, the drift, the speeds) it no longer unwraps at
  // all. The nineteenth is the altitude RAIL's own AGL: the rail is a gauge
  // rather than a plot, so it stayed the widget's and reads its one number
  // here.
  //
  // The three entries below are where those reads went, and they add up to more
  // than the sixteen that left. That is the cost of the model rather than a
  // regression to work off: a plot that derives its own inputs cannot share the
  // host's derivation, because a host with a derivation to share is a host with
  // a privilege an outside author does not have. Three plots reading the same
  // four Topics unwrap them three times, on purpose.
  "packages/components/src/LandingStatus/index.tsx": 19,
  // 7: the descent envelope's own layers, in the plot's own axes. The two
  // terminal anchors, the height and the speed set the frame and feed the
  // integration; the drag ratio scales a mark and the Mach number decides
  // whether the projection is drawn as an estimate. All arithmetic, none of it
  // a term the algebra has, and every number a READER sees still goes out
  // through `writeQuantity`.
  "packages/components/src/LandingStatus/descentLayers.ts": 7,
  // 11: the cross-section. The terrain patch is a list of elevations that
  // becomes a polyline in the plot's own space, and the drift, the height and
  // the two speed components set its frame and its vector. Every number a
  // READER sees still leaves through `writeQuantity`.
  "packages/components/src/LandingStatus/crossSectionPlot.ts": 11,
  // 20: the reticle, and the highest of the three because it derives the most.
  // Four coordinates for the great-circle drift, the patch and its footprint
  // for the relief, and the dispersion zone, which is not on the wire at all:
  // it is a horizontal-travel estimate that needs the speed, the time to impact
  // and, in vacuum, a surface gravity backed out of mu and the radius.
  "packages/components/src/LandingStatus/touchdownReticlePlot.ts": 20,
  "packages/components/src/LaunchDirector/index.tsx": 1,
  // 1: the view instant, unwrapped to bucket it and to hand it to the frame
  // arithmetic. Every function that solves a body's position takes a bare UT,
  // because a Kepler solve is trigonometry on a number and not an operation the
  // algebra has a term for.
  "packages/components/src/LibrationPoints/index.tsx": 1,
  "packages/components/src/ManeuverPlanner/index.tsx": 5,
  "packages/components/src/ManeuverPlanner/LocalManeuverTriggerService.ts": 10,
  // 16: the sixteenth is a maneuver node's own UT. It reads the modern
  // vessel.maneuver shape, where the instant is a Value; the horizon it feeds
  // is plain-number geometry against a plain-number view instant, so the
  // unwrap belongs at that boundary rather than one term deeper.
  "packages/components/src/MapView/index.tsx": 16,
  "packages/components/src/MapView/vanillaPoiProvider.ts": 2,
  "packages/components/src/MissionEventLog/useMissionEvents.ts": 1,
  "packages/components/src/Navball/index.tsx": 1,
  "packages/components/src/OrbitView/index.tsx": 8,
  "packages/components/src/ResourceOps/index.tsx": 1,
  "packages/components/src/SemiMajorAxis/index.tsx": 2,
  // 1: the view instant, unwrapped to bound a history window. sampleRange
  // takes plain UT numbers because a store index is not a quantity.
  "packages/components/src/shared/usePastTrack.ts": 1,
  "packages/components/src/shared/dockAngles.ts": 1,
  "packages/components/src/shared/OrbitalEventChips.tsx": 1,
  "packages/components/src/Strategies/index.tsx": 4,
  "packages/components/src/SystemView/index.tsx": 27,
  "packages/components/src/SystemView/useCelestialBodies.ts": 2,
  "packages/components/src/SystemView/usePhaseAngles.ts": 7,
  "packages/components/src/Targeting/index.tsx": 5,
  "packages/components/src/ThermalStatus/index.tsx": 13,
  // +1 for the Δv budget the reach list compares against. `calc/transfer.ts` and
  // the porkchop are deliberately plain-SI ("no React, no side effects", see their
  // own docs), so a `Value<"m/s">` off the wire has to shed its unit exactly once
  // to be compared against a solver's cost. Doing it in the algebra instead would
  // mean wrapping every figure the coplanar model returns.
  "packages/components/src/TransferWindow/index.tsx": 3,
  // The shared ΔV budget's one raw read: `totalVac` is `Value<"m/s"> | null` and
  // the feasibility deduction below it subtracts plain node magnitudes in a
  // running total. Doing it in the algebra would wrap and unwrap once per node
  // for a number that never leaves this function.
  "packages/data/src/hooks/useManeuverFeasibility.ts": 1,
  // 4: the burn instant and the plan's own total, unwrapped here because this
  // hook IS the boundary between the wire shape and the plain-number geometry
  // every node consumer works in. The three delta-v components go through
  // ui-kit's `magnitudeOr` instead, which is what a component absent from the
  // wire wants: nothing added to the vector, said in one place.
  "packages/data/src/hooks/useManeuverNodes.ts": 4,
  "packages/data/src/hooks/useDataSeries.ts": 1,
  "packages/data/src/hooks/vesselPartsAdapter.ts": 20,
  "packages/data/src/replaySession/ReplaySessionBanner.tsx": 1,
  "packages/sitrep-client/src/auto-command.ts": 1,
  "packages/sitrep-client/src/control-expectation.ts": 2,
  // `numOrNull`, the one funnel where a body's wire quantities become the plain
  // numbers the system diagram scales into SVG coordinates. One place,
  // deliberately, and it is why re-pointing that file at the unit system was a
  // two-line change.
  "mod/sitrep-sdk/src/spine/celestial-facts.ts": 1,
  // Two: reading a stage field's magnitude out of a wire row typed `unknown`
  // (there is no Value to do algebra with until it has been recognised as one),
  // and the budget's age against the frame's view UT, which arrives as a plain
  // number on `ProcessorFrame` rather than as an instant.
  "mod/sitrep-sdk/src/spine/delta-v-budget.ts": 2,
  // The Value arm of the evaluator's result-equality walk. It compares the two
  // own properties directly BECAUSE it must not go through the algebra: the
  // algebra throws across dimensions, and a comparison that throws when a
  // processor changes a unit is worse than one that answers "not equal".
  "mod/sitrep-sdk/src/spine/processorEvaluator.ts": 1,
  "mod/sitrep-sdk/src/spine/delay-authority.ts": 1,
  "packages/sitrep-client/src/fleet-position.ts": 1,
  // The one decode of a `fleet.` payload's quantities. Whether a quantity
  // arrives wrapped depends on the TOPIC, not the type: `wrapTopicPayload` keys
  // on the exact topic string, so `fleet.silence` delivers a Value where its
  // per-guid sibling delivers a bare number for the same field. A reader of
  // both has to accept either. Not arithmetic: the number is handed to the
  // caller and never computed with here.
  "packages/sitrep-client/src/wire-magnitude.ts": 1,
  // `canPropagate` accepts a horizon UT either wrapped (as the wire delivers it)
  // or already unwrapped, so one read normalises the two. Not arithmetic: the
  // number is compared against a window and never computed with.
  "mod/sitrep-sdk/src/spine/kepler.ts": 1,
  // The trajectory arc's points arrive either wrapped (as the wire delivers
  // them) or already unwrapped (as a caller-built fixture has them), so one read
  // normalises the two, exactly as `canPropagate`'s does above. Not arithmetic:
  // the numbers go into a rotation matrix as raw metres, which is geometry in a
  // single frame with a single unit and has no dimension for the algebra to
  // check.
  "mod/sitrep-sdk/src/spine/orbit-trajectory.ts": 1,
  "mod/sitrep-sdk/src/spine/orbit-patches.ts": 14,
  "mod/sitrep-sdk/src/spine/use-command.ts": 1,
  "packages/sitrep-client/src/use-control-stream.tsx": 2,
  "mod/sitrep-sdk/src/spine/vessel-state.ts": 2,
  "packages/ui-kit/src/Countdown.tsx": 1,
  // 1, and it is the implementation: this is the ONE unwrap in the repo, moved
  // down from ui-kit on 2026-08-25 so `sitrep-sdk`'s own files could reach it
  // without a cycle. ui-kit re-exports it and now spends none.
  "mod/sitrep-sdk/src/magnitude.ts": 1,
  "packages/ui-kit/src/MissionDate.tsx": 1,
  "packages/ui-kit/src/Unit.tsx": 1,
  "packages/ui-kit/src/units.ts": 2,
};

/**
 * Used as a guard on the guard. If the search silently stops matching (a bad
 * regex, a moved root, a renamed extension) every count reads as zero and the
 * budget reports success while checking nothing.
 *
 * That is not hypothetical: the regex for this very check returned zero matches
 * on the first attempt, because `git grep -E` does not take `\b`.
 *
 * Deliberately well under the real total, so ordinary shrinking never trips it.
 */
const MINIMUM_FILES_EXPECTED = 40;

const SEARCH_GLOBS = ["*.ts", "*.tsx"];

/**
 * A real property access: something identifier-ish, `)`, `]` or `?` sits
 * immediately before the dot. This is deliberately not a bare `\.magnitude`,
 * which also matches the two dozen comments that write the word in backticks
 * to explain why a particular unwrap is correct. Those are prose, and a budget
 * that counted them would charge a file for documenting itself.
 *
 * The `]` comes FIRST inside the bracket expression because POSIX has no
 * escaping in there: `[...\]...]` ends the class at the backslash, and the
 * whole pattern then silently matches nothing.
 */
const PROPERTY_ACCESS = String.raw`[]A-Za-z0-9_$)?]\.magnitude`;

/**
 * Excluded from the budget:
 *  - `/dist/` build output, not source
 *  - tests and fixtures, which own the values they construct
 *  - `__generated__`, written by the contract generator
 *  - `unit-system/value.ts`, which IMPLEMENTS `.magnitude`
 */
const EXCLUDED =
  /\/dist\/|\.test\.|\.spec\.|test-d|__fixtures__|__generated__|unit-system\/value\.ts/;

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function countsByFile(root: string): Map<string, number> {
  let out: string;
  try {
    out = execFileSync(
      "git",
      // `--untracked` is load-bearing: `git grep` alone searches only
      // TRACKED files, so a violation introduced in a BRAND-NEW file is
      // invisible to this scan until the moment it is staged, and a local
      // run before `git add` reports success while not looking at it. It
      // still honours .gitignore, so build output stays out.
      ["grep", "--untracked", "-nE", PROPERTY_ACCESS, "--", ...SEARCH_GLOBS],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
    );
  } catch (err) {
    // git grep exits 1 when nothing matches. That is not a pass here: the whole
    // repo losing every magnitude at once is a broken search, and the file
    // floor below is what says so.
    if ((err as { status?: number }).status === 1) return new Map();
    throw err;
  }
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    if (!line || EXCLUDED.test(line)) continue;
    const file = line.slice(0, line.indexOf(":"));
    if (!file) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("the magnitude budget only shrinks", () => {
  const counts = countsByFile(root);

  it("is actually looking at the codebase", () => {
    expect(counts.size).toBeGreaterThanOrEqual(MINIMUM_FILES_EXPECTED);
  });

  it("has no file over its budget, and no unbudgeted file using one", () => {
    const over: string[] = [];
    for (const [file, used] of [...counts].sort()) {
      const budget = MAGNITUDE_BUDGET[file];
      if (budget === undefined) {
        over.push(`  ${file}: ${used} (not on the list)`);
      } else if (used > budget) {
        over.push(`  ${file}: ${used}, budget ${budget}`);
      }
    }
    if (over.length > 0) {
      throw new Error(
        "`.magnitude` is an escape hatch and these files reach for it more " +
          "than the budget allows. If the new use is arithmetic, do it in the " +
          "algebra (a.minus(b), value(unit, n), .in(unit)) instead. If it " +
          "genuinely needs the raw number, raise the count here and say why:\n" +
          over.join("\n"),
      );
    }
    expect(over).toEqual([]);
  });
});
