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
  "mod/GonogoKerbalismUplink/client/src/ecosystem.ts": 1,
  "mod/GonogoKerbalismUplink/client/src/processor.ts": 1,
  "mod/GonogoKerbalismUplink/client/src/resourceProjection.ts": 5,
  "mod/GonogoKerbalismUplink/client/src/ScienceFileManager/index.tsx": 1,
  "mod/GonogoKerbcastUplink/client/src/CameraFeed/CameraFeed.tsx": 4,
  "mod/GonogoKosUplink/client/src/KosTerminal/index.tsx": 1,
  "mod/GonogoScansatUplink/client/src/Scanning/Minimap.tsx": 2,
  "mod/sitrep-sdk/src/command-delay.ts": 5,
  "mod/sitrep-sdk/src/spine/timeline-store.ts": 1,
  "mod/sitrep-sdk/src/testing/render.tsx": 1,
  "packages/app/src/alarms/WarpObserver.ts": 1,
  "packages/app/src/maneuverTriggers/ManeuverTriggerHostService.ts": 1,
  "packages/app/src/telemetry/KspCalendarObserver.tsx": 4,
  "packages/components/src/CommSignal/index.tsx": 1,
  "packages/components/src/ContractManager/index.tsx": 2,
  "packages/components/src/CrewStatus/badge.ts": 2,
  "packages/components/src/CrewStatus/index.tsx": 1,
  "packages/components/src/CurrentOrbit/index.tsx": 3,
  "packages/components/src/DistanceToTarget/index.tsx": 5,
  "packages/components/src/FleetComms/index.tsx": 15,
  "packages/components/src/FleetRoster/index.tsx": 3,
  "packages/components/src/FuelStatus/index.tsx": 1,
  "packages/components/src/LandingStatus/index.tsx": 39,
  "packages/components/src/LaunchDirector/index.tsx": 1,
  "packages/components/src/ManeuverPlanner/index.tsx": 5,
  "packages/components/src/ManeuverPlanner/LocalManeuverTriggerService.ts": 10,
  "packages/components/src/MapView/index.tsx": 15,
  "packages/components/src/MapView/vanillaPoiProvider.ts": 2,
  "packages/components/src/MissionEventLog/useMissionEvents.ts": 1,
  "packages/components/src/Navball/index.tsx": 1,
  "packages/components/src/OrbitView/index.tsx": 8,
  "packages/components/src/ResourceOps/index.tsx": 1,
  "packages/components/src/SemiMajorAxis/index.tsx": 2,
  "packages/components/src/shared/dockAngles.ts": 1,
  "packages/components/src/shared/OrbitalEventChips.tsx": 1,
  "packages/components/src/SpaceWeather/index.tsx": 1,
  "packages/components/src/Strategies/index.tsx": 4,
  "packages/components/src/SystemView/index.tsx": 27,
  "packages/components/src/SystemView/useCelestialBodies.ts": 2,
  "packages/components/src/SystemView/usePhaseAngles.ts": 7,
  "packages/components/src/ThermalStatus/index.tsx": 13,
  "packages/components/src/TransferWindow/index.tsx": 2,
  "packages/data/src/hooks/useDataSeries.ts": 1,
  "packages/data/src/hooks/useVesselDeltaV.ts": 1,
  "packages/data/src/hooks/vesselPartsAdapter.ts": 20,
  "packages/data/src/replaySession/ReplaySessionBanner.tsx": 1,
  "packages/sitrep-client/src/auto-command.ts": 1,
  "packages/sitrep-client/src/control-expectation.ts": 2,
  "packages/sitrep-client/src/delay-authority.ts": 1,
  "packages/sitrep-client/src/fleet-position.ts": 1,
  "packages/sitrep-client/src/maneuver-legacy.ts": 6,
  "packages/sitrep-client/src/orbit-patches.ts": 14,
  "packages/sitrep-client/src/use-command.ts": 1,
  "packages/sitrep-client/src/use-control-stream.tsx": 2,
  "packages/sitrep-client/src/vessel-state.ts": 2,
  "packages/ui-kit/src/Countdown.tsx": 1,
  "packages/ui-kit/src/magnitude.ts": 1,
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
      ["grep", "-nE", PROPERTY_ACCESS, "--", ...SEARCH_GLOBS],
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
