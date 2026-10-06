import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Advancing a conic in time (step the mean anomaly, solve Kepler's equation,
 * take the radius) happens in `solveConic`, in the SDK's `kepler.ts`, and
 * nowhere else. A caller that needs where a craft is along its orbit asks it;
 * a caller that steps the anomaly itself is a second solver that can disagree
 * about a sign or a unit with the first and draw a plausible, wrong curve.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");

/** Files that used to advance a conic by hand and now go through `solveConic`. */
const CALLERS = [
  "mod/sitrep-sdk/src/spine/orbit-patches.ts",
  "packages/core/src/calc/maneuver.ts",
];

const PRIMITIVES =
  /\b(solveKepler|solveEccentricAnomaly|meanAnomalyAt|eccentricToTrueAnomaly|trueAnomalyFromEccentric)\b/;

function codeLines(path: string): string[] {
  return readFileSync(join(ROOT, path), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/?\*)/.test(line));
}

describe("one conic arithmetic path", () => {
  it.each(CALLERS)("%s advances a conic through solveConic", (path) => {
    const hits = codeLines(path).filter((line) => PRIMITIVES.test(line));
    expect(hits).toEqual([]);
  });
});
