import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A prediction a widget makes for itself must say why it is not a registered
 * reckoner.
 *
 * `registerReckoner` carries a Topic's own value forward past its last
 * observation. A widget's own solves either describe an event that has not
 * happened, from measurements at the view time, or lay out geometry from a
 * published conic, and their outputs sit on no channel, so none of them can be
 * one. That is a fact about each file, and it is only worth having where a
 * maintainer reads it, so every widget file that predicts must open a
 * paragraph with `Not a reckoner:` and give the reason.
 *
 * A file counts as predicting when it exports a `solve*`, `predict*`,
 * `propagate*`, `extrapolate*` or `forecast*` function, or calls one of the
 * propagation and solver entry points in `PREDICTOR_CALLS`. LandingStatus also
 * counts a `project*` export, a prefix that elsewhere names screen projection.
 * `PREDICTING_FILES` names the ones that exist today and each must carry the
 * marker; a new predicting file fails until it is added here with its reason
 * written. Files the patterns cannot see (`clocks.ts`, whose
 * `deriveDelayClocks` has none of those prefixes, and `useBodyRotation.ts`,
 * which advances an angle by arithmetic) are listed by hand.
 *
 * `projectDescent` lives in the sdk, so its own file is checked for the marker
 * as well, though a caller anywhere else in a widget is found by its call.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

const LANDING_DIR = "packages/components/src/LandingStatus/";

const WIDGET_PATHSPECS = [
  "packages/components/src",
  "mod/Gonogo*Uplink/client",
];

const PREDICTING_FILES = [
  "mod/sitrep-sdk/src/descent.ts",
  "packages/components/src/LandingStatus/clocks.ts",
  "packages/components/src/LandingStatus/descentLayers.ts",
  "packages/components/src/LandingStatus/solveLanding.ts",
  "packages/components/src/MapView/useGroundTrackPrediction.ts",
  "packages/components/src/MapView/useModelledPosition.ts",
  "packages/components/src/ManeuverPlanner/planning.ts",
  "packages/components/src/SystemView/predictedTrajectory.ts",
  "packages/components/src/SystemView/transferWindow.ts",
  "packages/components/src/SystemView/useBodyRotation.ts",
  "packages/components/src/SystemView/usePhaseAngles.ts",
  "packages/components/src/TransferWindow/transferData.ts",
];

const MARKER = /^ \* Not a reckoner:/m;

const NAMED_RE =
  /export (?:async )?function (?:solve|predict|propagate|extrapolate|forecast)[A-Z]\w*|export const (?:solve|predict|propagate|extrapolate|forecast)[A-Z]\w*\s*=/;

const LANDING_NAMED_RE =
  /export (?:async )?function project[A-Z]\w*|export const project[A-Z]\w*\s*=/;

const PREDICTOR_CALLS_RE =
  /\b(?:projectDescent|patchArc|deriveTrueAnomalyDeg|predictGroundTrack|stateAtUT|propagateVesselOrbit|keplerAdmissibility|buildPorkchop|hohmann[A-Za-z]*)\(|\bkeplerTransferSolver\b/;

function predicts(file: string, source: string): boolean {
  return (
    NAMED_RE.test(source) ||
    PREDICTOR_CALLS_RE.test(source) ||
    (file.startsWith(LANDING_DIR) && LANDING_NAMED_RE.test(source))
  );
}

function isSource(file: string): boolean {
  return (
    /\.tsx?$/.test(file) &&
    !/\.(test|test-d|stories)\.tsx?$/.test(file) &&
    !file.includes("/__") &&
    !file.includes("/test/")
  );
}

function trackedWidgetSources(): string[] {
  return execFileSync("git", ["ls-files", ...WIDGET_PATHSPECS], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file !== "" && isSource(file));
}

function predictingFiles(read: (file: string) => string): string[] {
  return trackedWidgetSources().filter((file) => predicts(file, read(file)));
}

function readRepoFile(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** The widget files that predict but are not named in `PREDICTING_FILES`. */
function unlisted(found: readonly string[]): string[] {
  return found.filter((file) => !PREDICTING_FILES.includes(file));
}

/** The files in `PREDICTING_FILES` that carry no marker paragraph. */
function unexplained(read: (file: string) => string): string[] {
  return PREDICTING_FILES.filter((file) => !MARKER.test(read(file)));
}

describe("widget predictions say why they are not reckoners", () => {
  it("can see a predictor and a marker (planted)", () => {
    for (const planted of [
      "export function solveThing() {}",
      "export function predictLanding() {}",
      "export async function propagateBody() {}",
      "export const extrapolateFuel = () => 0;",
      "export const forecastPower = () => 0;",
      "const x = projectDescent({ a });",
      "const arc = patchArc(patch, 64);",
      "const nu = deriveTrueAnomalyDeg({ ut });",
      "const track = predictGroundTrack(args);",
      "const plan = hohmannToRadius(orbit, mu, ut, r);",
      "const solver = keplerTransferSolver;",
    ]) {
      expect(
        predicts("packages/components/src/X/x.ts", planted),
        `blind to ${planted}`,
      ).toBe(true);
    }
    expect(
      predicts(`${LANDING_DIR}x.ts`, "export async function projectPath() {}"),
    ).toBe(true);
    for (const innocent of [
      "export function buildPlot() {}",
      "export function deriveBoard() {}",
      "export function projectEntityPosition() {}",
      "export function countdownOf() {}",
    ]) {
      expect(
        predicts("packages/components/src/X/x.ts", innocent),
        `false alarm on ${innocent}`,
      ).toBe(false);
    }
    expect(MARKER.test("/**\n * Not a reckoner: because.\n */")).toBe(true);
    expect(MARKER.test("/**\n * It is not a reckoner.\n */")).toBe(false);
  });

  it("names every predicting file in widget code", () => {
    const missing = unlisted(predictingFiles(readRepoFile));
    expect(
      missing,
      `These files predict and are not in PREDICTING_FILES in packages/core/src/styleguide-local-predictors.test.ts. ` +
        `Write a "Not a reckoner:" paragraph in each saying why it cannot be one, then add it.`,
    ).toEqual([]);
  });

  it("lists no file that is gone", () => {
    const gone = PREDICTING_FILES.filter(
      (file) => !existsSync(join(ROOT, file)),
    );
    expect(
      gone,
      "These files no longer exist. Remove them from PREDICTING_FILES.",
    ).toEqual([]);
  });

  it("keeps the written reason in every listed file", () => {
    expect(
      unexplained(readRepoFile),
      'These files lost their "Not a reckoner:" paragraph. Restore the reason, or decide the solve now is a reckoner.',
    ).toEqual([]);
  });

  it("fails when a listed file loses its reason (planted)", () => {
    expect(unexplained(() => "/** no reason here */")).toEqual(
      PREDICTING_FILES,
    );
  });

  it("fails when a new predicting file appears (planted)", () => {
    const planted = "packages/components/src/Fuel/newSolve.ts";
    expect(unlisted([...PREDICTING_FILES, planted])).toEqual([planted]);
  });
});
