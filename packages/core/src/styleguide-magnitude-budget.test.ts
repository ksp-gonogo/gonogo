import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
 * Per-file `.magnitude` budget. Each entry EQUALS what its file uses: a file
 * absent from this map may not use any, a file over its number fails, and so
 * does a file under it, because an entry above the live count is permission for
 * that many new unwraps rather than a record of anything. See "has no entry
 * above what its file actually uses" below for why that arm throws rather than
 * warning.
 */
const MAGNITUDE_BUDGET: Record<string, number> = {
  // ONE, in a named `kilograms()` helper at the command boundary and nowhere else.
  // `rp1.contracts.setPayload` declares its two fields as `int?` in kilograms,
  // because RP-1 stores them as `int` and validates against an integer range and
  // an integer step, so a raw number has to exist where the typed value meets the
  // wire. The figures a READER sees go out through `<Unit>`.
  "mod/GonogoRp1Uplink/client/src/ContractPayload/index.tsx": 1,
  /*
   * The one place a wire Value meets transcribed arithmetic. A new complex is
   * priced against what the operator is typing, so its pad and integration halves
   * are a closed form over plain numbers, transcribed from RP-1 and pinned against
   * figures the shipped assembly generated. The resource half arrives as a
   * funds-per-unit Value and has to join those as a number to be summed with them.
   * Every figure a READER sees goes back out through `<Unit>`.
   */
  "mod/GonogoRp1Uplink/client/src/KscComplexes/lcCost.ts": 1,
  /*
   * ONE, where the delay reading leaves the contract for the design system.
   * `signalDelayPresentation` decides which of the two delay readings a console
   * draws, and it lives in `ui-kit`, which is props-driven and carries no
   * contract types: `InFlightList` beside it takes plain seconds for the same
   * reason. So the terminal unwraps once, here, and the figure a READER sees
   * goes back out through `<Unit>` inside the badge.
   */
  "mod/GonogoKosUplink/client/src/KosTerminal/index.tsx": 1,
  "mod/GonogoKerbalismUplink/client/src/processor.ts": 1,
  "mod/GonogoKerbalismUplink/client/src/SpaceWeather/index.tsx": 1,
  "mod/GonogoKerbalismUplink/client/src/resourceProjection.ts": 4,
  // 11, up from the 4 this file used while it was a React overlay drawing on a
  // host plot's axes, and the rise is the price of the overlay slot going away.
  // A CONTRIBUTION is handed raw Topic payloads rather than a host context, so
  // where it used to be given `ctx.terminalVelocityAt` and `ctx.projectDescent`
  // already built, it now unwraps the two terminal anchors, the height, the
  // speed and the body's radius and gravitational parameter to build them
  // itself. Every one of those feeds an integration or a square root, which is
  // arithmetic the algebra has no term for; the numbers a READER sees still go
  // out through `writeQuantity`.
  // 12th: the parent body's surface gravity, which the stream reports in g and
  // the descent integration needs in m/s². The conversion IS in the algebra
  // (`.in("m/s²")`); the unwrap is the last step, handing a plain number to
  // `projectDescent`, whose options are numbers throughout.
  "mod/GonogoFerramAerospaceResearchUplink/client/src/DescentEnvelope/index.ts": 12,
  // 1: the contribution entry carries a BARE bits/sec so CommSignal can compare
  // legs to find the bottleneck. A comparison across a slot boundary cannot
  // carry a Value, because the entry crosses the published contract as JSON.
  "mod/GonogoRealAntennasUplink/client/src/CommSignal/hopRates.ts": 1,
  /*
   * Three THRESHOLD reads, none of them arithmetic on a quantity. RealFuels'
   * ullage bands are its own cascade of six fixed cut-offs, so the section
   * compares the stability against literals rather than deriving anything; one
   * ignition left rather than several picks the badge severity; and a tank
   * count decides whether the boiloff row exists at all and whether its label
   * is singular. There is no `.minus`/`.in` form of "which of six bands is this
   * in", and the two counts are cardinalities rather than measurements.
   */
  "mod/GonogoRealFuelsUplink/client/src/EngineRealism/index.tsx": 3,
  "mod/sitrep-sdk/src/command-delay.ts": 4,
  // 1, in `degradeRatingOf`, and this file exists so that number stays 1. The
  // link grading has to reach a consumer as a raw number, because what a
  // consumer DOES with it is arithmetic on a quality ladder (a bitrate rung, how
  // much noise to mix) rather than anything in a dimension, and no `Unit` ever
  // renders it. What is unwrapped here is also the thing being CHECKED: the
  // 0..1 promise is re-kept on arrival, and doing it once here is the point: the
  // alternative is every consumer clamping at its own call site, which is the
  // shape `1 - comms.signalStrength` already took.
  //
  // ONE, and only because `DegradeRating.level` is a plain number on the way
  // out. The non-finite check is `Value.isFinite()` and the clamp is
  // `.max(0).min(1)`, both in the algebra. This file used to unwrap for all
  // three, which is exactly the escape `isFinite()` was added to retire.
  "mod/sitrep-sdk/src/comms-degrade.ts": 1,
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
  // 4: the same boundary as the entry above, for the Uplink's own send command.
  // `PrincipiaComposedBurn` is carried INSIDE an args record rather than being
  // one, so codegen's "an Args type is a wire-WRITE" exemption does not reach it
  // and its instant and three components are typed as `Value`s. The receiving
  // side binds each to a plain double and rejects an object bag from inside the
  // handler, so passing them through lost the whole plan. Unwrapped where the
  // command shape is built, exactly as `planSendArgs` does.
  "mod/GonogoPrincipiaUplink/client/src/PlanSlots/index.tsx": 4,
  "mod/sitrep-sdk/src/spine/timeline-store.ts": 1,
  "mod/sitrep-sdk/src/testing/render.tsx": 1,
  "packages/app/src/alarms/WarpObserver.ts": 1,
  /*
   * 1 each, and both are the wire boundary. A Commcast message crosses PeerJS
   * as JSON, so the separation it freezes has to be a plain `number | null`:
   * a `Value<"s">` serialises to an object the receiving side would then have
   * to unwrap by hand at every read, which is the same unwrap done N times
   * instead of once. The context's is the mirror of it, turning the published
   * pair matrix into the lookup the reveal rule indexes.
   */
  "packages/app/src/commcast/CommcastComponent.tsx": 1,
  "packages/app/src/commcast/CommcastContext.tsx": 1,
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
  // 1: minting a Value from a contributed row's magnitude-and-unit pair so the
  // host can render it through Unit. The slot cannot carry a Value (its two
  // declarations must be structurally identical to merge, and a Value reached
  // by two module paths is not), so the raw number arrives by contract and the
  // unwrap is the reconstruction rather than an escape.
  "packages/components/src/Navball/index.tsx": 1,
  "packages/components/src/OrbitView/index.tsx": 6,
  "packages/components/src/SemiMajorAxis/index.tsx": 1,
  // 1: the view instant, unwrapped to bound a history window. sampleRange
  // takes plain UT numbers because a store index is not a quantity.
  "packages/components/src/shared/usePastTrack.ts": 1,
  "packages/components/src/shared/dockAngles.ts": 1,
  "packages/components/src/shared/OrbitalEventChips.tsx": 1,
  "packages/components/src/Strategies/index.tsx": 1,
  "packages/components/src/SystemView/index.tsx": 23,
  "packages/components/src/SystemView/usePhaseAngles.ts": 7,
  "packages/components/src/Targeting/index.tsx": 5,
  "packages/components/src/ThermalStatus/index.tsx": 13,
  // +1 for the Δv budget the reach list compares against. `calc/transfer.ts` and
  // the porkchop are deliberately plain-SI ("no React, no side effects", see their
  // own docs), so a `Value<"m/s">` off the wire has to shed its unit exactly once
  // to be compared against a solver's cost. Doing it in the algebra instead would
  // mean wrapping every figure the coplanar model returns.
  "packages/components/src/TransferWindow/index.tsx": 2,
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

/**
 * Entries sitting above what their file actually uses, formatted for the
 * failure. A pure function of the two inputs so the planted check below can
 * drive it with a synthetic pair whose answer is known: the shrink arm is the
 * half whose whole purpose is to make a stale number visible, so it being
 * silently broken would restore the exact defect it was added to fix.
 */
function staleEntries(
  budget: Record<string, number>,
  counts: Map<string, number>,
): string[] {
  const stale: string[] = [];
  for (const [file, allowed] of Object.entries(budget).sort()) {
    const used = counts.get(file) ?? 0;
    if (used < allowed) {
      stale.push(
        `  ${file}: ${allowed} -> ${used}${used === 0 ? " (delete the entry)" : ""}`,
      );
    }
  }
  return stale;
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("the magnitude budget only shrinks", () => {
  const counts = countsByFile(root);

  it("is actually looking at the codebase", () => {
    expect(counts.size).toBeGreaterThanOrEqual(MINIMUM_FILES_EXPECTED);
  });

  it("can see a violation (planted)", () => {
    /*
     * The file floor above catches a walk that stops finding files. It cannot
     * catch a walk that finds them and a PATTERN that stops matching, which is
     * the failure this regex has already had once: `git grep -E` takes no `\b`,
     * and the first version of it matched nothing and reported a clean tree.
     *
     * Planted through `git grep` itself, never `new RegExp(PROPERTY_ACCESS)`.
     * The two are not the same pattern: this is POSIX ERE, where the leading
     * `]` in `[]A-Za-z0-9_$)?]` is a literal member of the class, while
     * JavaScript reads `[]` as an EMPTY class and then chokes on the unmatched
     * `)`. A JS-side check would either throw or, with the brackets respelt to
     * make it parse, pass while measuring a pattern the scan never runs. The
     * instrument has to be the engine under test.
     */
    const planted = join(mkdtempSync(join(tmpdir(), "mag-ratchet-")), "p.ts");
    try {
      writeFileSync(
        planted,
        [
          "const a = reading.magnitude;", // identifier before the dot
          "const b = readings[0].magnitude;", // `]`, the class's first member
          "const c = f().magnitude;", // `)`
          "const d = maybe?.magnitude;", // optional chain
          "// prose about `.magnitude` is not a use of it",
        ].join("\n"),
      );
      /*
       * `cwd` is the temp dir, which sits outside any repository: `git grep
       * --no-index` refuses a path outside the repo it finds from cwd, so
       * running it from inside this checkout would fail on the path rather than
       * answer about the pattern.
       */
      const hits = execFileSync(
        "git",
        ["grep", "--no-index", "-nE", PROPERTY_ACCESS, "--", "p.ts"],
        { cwd: dirname(planted), encoding: "utf8" },
      )
        .trim()
        .split("\n");
      // Four uses seen, and the comment line not charged: a budget that billed
      // a file for explaining itself is how the explanations get deleted.
      expect(hits).toHaveLength(4);
    } finally {
      rmSync(dirname(planted), { recursive: true, force: true });
    }
  });

  it("can see a stale entry (planted)", () => {
    /*
     * The shrink arm's own guard-on-the-guard. The two planted checks around it
     * prove the SCAN can still see a violation; neither says anything about the
     * comparison that turns a scan result into a stale-entry failure, and a
     * comparison that stopped comparing would report a tight list forever.
     * That is not a hypothetical failure mode, it is the one this arm exists to
     * fix: on the sibling styled-components ratchet the equivalent signal was a
     * `console.warn` into a suppressed stream, which is indistinguishable from
     * no signal at all and stayed that way through thirty imports.
     *
     * Synthetic inputs, because the real tree is tight and a tight tree cannot
     * demonstrate the arm firing.
     */
    const stale = staleEntries(
      { over: 4, exact: 2, gone: 1, absent: 3 },
      new Map([
        ["over", 2],
        ["exact", 2],
        ["gone", 0],
      ]),
    );
    expect(stale).toEqual([
      "  absent: 3 -> 0 (delete the entry)",
      "  gone: 1 -> 0 (delete the entry)",
      "  over: 4 -> 2",
    ]);
    // A file at its number is not stale, and a file OVER it is the other arm's
    // business: this one must stay silent on both or it double-reports.
    expect(
      staleEntries(
        { exact: 2, under: 1 },
        new Map([
          ["exact", 2],
          ["under", 5],
        ]),
      ),
    ).toEqual([]);
  });

  it("has no entry for a path that no longer exists", () => {
    /*
     * An Rp1 Uplink widget's entry sat on this list carrying 2 after its whole
     * directory was deleted. A budget entry for a file that is gone can never
     * be spent, so it never trips the over-budget arm and never gets removed:
     * it is pure slack that no run reports. The sibling token ratchet already
     * guards this ("excuses no path that has moved or been deleted"); this one
     * did not, which is how the entry outlived its file.
     */
    const missing = Object.keys(MAGNITUDE_BUDGET)
      .filter((rel) => !existsSync(join(root, rel)))
      .sort();
    expect(missing, "budgeted paths that no longer exist, delete them").toEqual(
      [],
    );
  });

  it("has no entry above what its file actually uses", () => {
    /*
     * The shrink arm, and the reason the sum of this list is exactly the live
     * count rather than comfortably above it. An entry of 4 on a file that uses
     * 2 is not a record of anything: it is permission for two more, and the
     * over-budget arm below cannot see them because they fit.
     *
     * This used to be nothing at all here, and on the sibling styled-components
     * ratchet it was a `console.warn`. Vitest 4's default reporter suppresses
     * console output for a PASSING test and both `pnpm test` and CI run the
     * default reporter, so that warning reached no stream anyone reads and went
     * unheard through thirty imports. Failing is the only signal here that has
     * been shown to move a number, and unlike "someone read the log" it can be
     * tested by planting a shrink.
     *
     * Not a new contract so much as a consistent one: the sibling test above
     * already hard-fails a budget entry whose file was DELETED. A file that
     * merely dropped half its unwraps is the same stale slack, caught later.
     *
     * Lowering is by hand on purpose. There is no `--update`, so a number that
     * was CHOSEN and explained in a comment above it can never be quietly
     * rewritten by a tool: the failure hands you the figure and makes you walk
     * past the reasoning to type it.
     */
    const stale = staleEntries(MAGNITUDE_BUDGET, counts);
    if (stale.length > 0) {
      throw new Error(
        "These entries sit above what their file uses, and the gap is " +
          "permission for that many new unwraps which the over-budget check " +
          "cannot see. Lower each one (or delete it, where the file now uses " +
          "none) in packages/core/src/styleguide-magnitude-budget.test.ts. If " +
          "an entry carries a comment, read it first: the number was chosen, " +
          "and the note may need rewriting rather than deleting:\n" +
          stale.join("\n"),
      );
    }
    expect(stale).toEqual([]);
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
          "algebra (a.minus(b), value(unit, n), .in(unit)) instead.\n\n" +
          "BEFORE RAISING THE COUNT, ask what method Value is missing. A count " +
          "that goes up because the algebra cannot express something is an API " +
          "gap: widen Value and the budget falls on its own. A count that goes " +
          "up because the method already exists and was not used is a mistake. " +
          "`isFinite()` was added to retire `Number.isFinite(x.magnitude)`, and " +
          "`min`/`max` take a bare operand so `x.max(0)` replaces " +
          "`Math.max(0, x.magnitude)`. See 'A budget entry is often a missing " +
          "API' in docs/ratchets.md.\n\n" +
          "Only a genuine boundary earns an entry: a plain-number return type, " +
          "a third-party call, a wire shape you do not own. Raise the count " +
          "here only then, and say which boundary it is:\n" +
          over.join("\n"),
      );
    }
    expect(over).toEqual([]);
  });
});
