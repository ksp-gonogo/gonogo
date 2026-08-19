import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  solveAnomalies,
  solveEccentricAnomaly,
} from "../../../mod/sitrep-sdk/src/spine/kepler";
import { solveKepler as coreSolveKepler } from "./calc/trajectory";

/**
 * What any solver of Kepler's equation must satisfy, applied to every
 * implementation in the repo that has one.
 *
 * Written BEFORE increment 6 consolidates the client-side implementations, and that
 * is the whole reason it exists: the finding that one of them returns non-solutions
 * from e = 0.994 upward lived in a report and in a probe that was deleted. The
 * finding is durable, the instrument that found it was not, and after a
 * consolidation the only way to know the survivor is the right one is to have had
 * the check in the repo beforehand.
 *
 * The primary check is the RESIDUAL, `|E - e sin(E) - M|`. It is self-validating in
 * a way a golden fixture is not: a fixture can be satisfied by capturing a wrong
 * implementation's output and calling it expected, which is exactly how a wrong
 * solver survives, whereas a residual can only be satisfied by actually solving the
 * equation. The one thing it cannot catch is a shared misunderstanding of the
 * equation itself, since a consistently-wrong-but-self-consistent solver satisfies
 * it; the area-law check below is what closes that, from an independent starting
 * point rather than from a trusted number.
 *
 * The C# side is held to the same grid, through `IPropagationProvider`, by
 * `mod/Sitrep.Propagation.Tests/KeplerEquationConformanceTests.cs`. Both read the
 * grid from the same fixture so the two languages cannot drift apart about what the
 * contract is.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

interface PublishedTriple {
  id: string;
  source: string;
  units: "degrees" | "radians";
  eccentricity: number;
  meanAnomaly: number;
  eccentricAnomaly: number;
  toleranceRadians: number;
}

interface Grid {
  eccentricities: number[];
  meanAnomaliesNearZero: number[];
  meanAnomalySweepCount: number;
  maxAbsoluteResidualRadians: number;
  maxMeanAnomalyErrorForRoundTripRadians: number;
  areaLawRelativeTolerance: number;
  areaLawSimpsonIntervals: number;
  publishedTriples: PublishedTriple[];
}

/** Published values are stored in the units they were PRINTED in, so no transcription happens in the fixture. */
function toRadians(value: number, units: "degrees" | "radians"): number {
  return units === "degrees" ? (value * Math.PI) / 180 : value;
}

const grid: Grid = JSON.parse(
  readFileSync(
    join(repoRoot, "mod", "golden-fixtures", "kepler-equation.json"),
    "utf8",
  ),
);

/**
 * Every mean anomaly the grid asks for: a uniform sweep of the full revolution, plus
 * an explicitly dense cluster near zero. The cluster is not decoration. A uniform
 * sweep alone misses the defect this suite was written for, because the solution
 * turns nearly discontinuous only in the first fraction of a radian after periapsis.
 */
function meanAnomalies(): number[] {
  const sweep: number[] = [];
  for (let i = 0; i < grid.meanAnomalySweepCount; i++) {
    sweep.push((2 * Math.PI * i) / grid.meanAnomalySweepCount);
  }
  return [...grid.meanAnomaliesNearZero, ...sweep];
}

/** Wrap into (-pi, pi], so a residual is never reported as ~2pi. */
function wrapPi(radians: number): number {
  const twoPi = 2 * Math.PI;
  let x = radians % twoPi;
  if (x > Math.PI) x -= twoPi;
  if (x <= -Math.PI) x += twoPi;
  return x;
}

function residual(E: number, e: number, M: number): number {
  return Math.abs(wrapPi(E - e * Math.sin(E) - M));
}

/**
 * How far E is allowed to move for a round trip, DERIVED rather than picked. The map
 * M -> E is stiff near periapsis of a very eccentric orbit (`dE/dM = 1 / (1 - e cos
 * E)`, which is 1e5 at e = 0.99999), so a fixed tolerance in E would either be too
 * loose everywhere or fail on conditioning alone where the suite matters most.
 */
function allowedEccentricAnomalyError(E: number, e: number): number {
  const dEdM = 1 / Math.max(1 - e * Math.cos(E), Number.EPSILON);
  return grid.maxMeanAnomalyErrorForRoundTripRadians * dEdM + 1e-12;
}

/**
 * The fraction of the ellipse's area swept from periapsis out to eccentric anomaly
 * E, by the radius vector from the OCCUPIED FOCUS, integrated numerically.
 *
 * This is the check of a different kind. The residual cannot tell a correct equation
 * from a consistently-wrong one, and the brief's remedy for that was two or three
 * externally-published triples; I could not source any I would stand behind (see
 * `publishedTriplesNote` in the fixture). This closes the same gap without needing a
 * trusted number, by deriving the relationship from somewhere else entirely: Kepler's
 * SECOND law says the radius sweeps equal areas in equal times, so the swept fraction
 * must equal M / 2pi by definition of the mean anomaly. Nothing here uses Kepler's
 * equation, only the ellipse's own parametrisation `(a(cos E - e), b sin E)` and
 * Simpson's rule, so a misstated equation (a sign flip, a `tan` for a `sin`) fails
 * it while satisfying the residual perfectly.
 */
function sweptAreaFraction(E: number, e: number, intervals: number): number {
  const a = 1;
  const b = Math.sqrt(1 - e * e);

  // dA/dE' = (1/2)(x y' - y x') for x = a(cos E' - e), y = b sin E'.
  const integrand = (Ep: number) =>
    0.5 *
    (a * (Math.cos(Ep) - e) * (b * Math.cos(Ep)) -
      b * Math.sin(Ep) * (-a * Math.sin(Ep)));

  const n = intervals % 2 === 0 ? intervals : intervals + 1;
  const h = E / n;
  let total = integrand(0) + integrand(E);
  for (let i = 1; i < n; i++) {
    total += (i % 2 === 0 ? 2 : 4) * integrand(i * h);
  }
  const swept = (h / 3) * total;

  return swept / (Math.PI * a * b);
}

/**
 * The implementations this suite can actually reach, and the ones it cannot.
 *
 * There is now ONE Newton iteration on this equation in the repo, in
 * `sitrep-sdk/src/spine/kepler.ts`. The entries below are the public names that reach
 * it; each is pinned separately so that giving any of them an implementation of its
 * own again is caught here rather than discovered later.
 */
const CONFORMANT: ReadonlyArray<{
  name: string;
  solve: (M: number, e: number) => number;
}> = [
  {
    name: "mod/sitrep-sdk/src/spine/kepler.ts (solveEccentricAnomaly)",
    solve: (M, e) => solveEccentricAnomaly(M, e),
  },
  {
    name: "mod/sitrep-sdk/src/spine/kepler.ts (solveAnomalies)",
    solve: (M, e) =>
      solveAnomalies(
        {
          sma: 1e6,
          ecc: e,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: M,
          epoch: 0,
          mu: 3.5316e12,
        },
        0,
      ).eccentricAnomaly,
  },
  {
    // The same function as the first entry now, reached through the name its own
    // callers use. Kept as a separate entry rather than folded in, because what is
    // being pinned is that this exported NAME satisfies the contract: if anyone ever
    // gives it an implementation of its own again, the suite is what notices.
    name: "packages/core/src/calc/trajectory.ts (solveKepler)",
    solve: (M, e) => coreSolveKepler(M, e),
  },
];

describe("Kepler's equation: the contract every solver must satisfy", () => {
  for (const impl of CONFORMANT) {
    describe(impl.name, () => {
      it("solves the equation to machine precision across the whole grid", () => {
        const failures: string[] = [];
        for (const e of grid.eccentricities) {
          for (const M of meanAnomalies()) {
            const E = impl.solve(M, e);
            const r = residual(E, e, M);
            if (!(r <= grid.maxAbsoluteResidualRadians)) {
              failures.push(
                `e=${e} M=${M} E=${E} residual=${r.toExponential(3)}`,
              );
            }
          }
        }
        expect(failures.slice(0, 10)).toEqual([]);
      });

      it("round-trips E -> M -> E within the conditioning of the problem", () => {
        const failures: string[] = [];
        for (const e of grid.eccentricities) {
          for (let i = 0; i <= 64; i++) {
            const E = (2 * Math.PI * i) / 64;
            const M = E - e * Math.sin(E);
            const back = impl.solve(M, e);
            const drift = Math.abs(wrapPi(back - E));
            if (!(drift <= allowedEccentricAnomalyError(E, e))) {
              failures.push(
                `e=${e} E=${E} -> M=${M} -> E'=${back} drift=${drift.toExponential(3)}` +
                  ` allowed=${allowedEccentricAnomalyError(E, e).toExponential(3)}`,
              );
            }
          }
        }
        expect(failures.slice(0, 10)).toEqual([]);
      });

      it("agrees with Kepler's SECOND law, which the residual alone cannot check", () => {
        const failures: string[] = [];
        // Away from E = 0, where the swept area is zero and a relative tolerance has
        // nothing to be relative to.
        for (const e of [0, 0.5, 0.9, 0.99, 0.999]) {
          for (const M of [0.4, 1.0, 2.0, 3.0, 4.5, 6.0]) {
            const E = impl.solve(M, e);
            const fraction = sweptAreaFraction(
              E,
              e,
              grid.areaLawSimpsonIntervals,
            );
            const expected = M / (2 * Math.PI);
            const relative =
              Math.abs(fraction - expected) /
              Math.max(Math.abs(expected), 1e-12);
            if (!(relative <= grid.areaLawRelativeTolerance)) {
              failures.push(
                `e=${e} M=${M}: swept ${fraction} of the ellipse, mean anomaly implies ${expected}`,
              );
            }
          }
        }
        expect(failures.slice(0, 10)).toEqual([]);
      });

      it("reproduces every published Meeus value", () => {
        // The externally-attributable half. The residual proves an implementation
        // solves the equation as WE state it; these prove we state it the way an
        // outside authority does, at two eccentricities including 0.99. Read
        // `publishedTriplesProvenance` in the fixture before trusting the digits:
        // they come through a port lineage, and what makes them usable is that each
        // was verified to satisfy the equation rather than taken on faith.
        for (const triple of grid.publishedTriples) {
          const M = toRadians(triple.meanAnomaly, triple.units);
          const expected = toRadians(triple.eccentricAnomaly, triple.units);

          const actual = impl.solve(M, triple.eccentricity);

          expect(
            Math.abs(wrapPi(actual - expected)),
            `${triple.id} (${triple.source}): got ${actual}, published ${expected}`,
          ).toBeLessThan(triple.toleranceRadians);
        }
      });

      it("refuses an eccentricity the elliptic form does not describe", () => {
        // The contract, picked rather than left to whichever file a caller happened
        // to reach: at e >= 1 the elliptic form of Kepler's equation does not apply,
        // so a solver must refuse rather than return a number.
        for (const e of [1.0, 1.4, 2.5]) {
          expect(() => impl.solve(1.0, e)).toThrow();
        }
      });
    });
  }

  describe("the guards on the guards", () => {
    it("the area-law check REJECTS a plausible wrong solver", () => {
      // Without this, the area-law check is an instrument with no demonstrated
      // ability to fail, which is the shape of every false green found on this
      // subsystem: a check that cannot represent the failure reports success. E = M
      // is the right answer for a circular orbit and a wrong one for any other, so
      // it is the most plausible wrong solver there is.
      const naive = (M: number) => M;

      const atCircular = sweptAreaFraction(
        naive(2.0),
        0,
        grid.areaLawSimpsonIntervals,
      );
      expect(Math.abs(atCircular - 2.0 / (2 * Math.PI))).toBeLessThan(1e-9);

      const atEccentric = sweptAreaFraction(
        naive(2.0),
        0.9,
        grid.areaLawSimpsonIntervals,
      );
      expect(Math.abs(atEccentric - 2.0 / (2 * Math.PI))).toBeGreaterThan(0.05);
    });

    it("every published triple is a genuine solution, not just a quoted number", () => {
      // The guard on the published values themselves. They arrive through a port
      // lineage rather than from the book, so they are checked against the equation
      // before anything is asked to match them: a mistranscribed digit would make
      // this fail here rather than turn into a false expectation for every
      // implementation above.
      for (const triple of grid.publishedTriples) {
        const M = toRadians(triple.meanAnomaly, triple.units);
        const E = toRadians(triple.eccentricAnomaly, triple.units);

        expect(
          residual(E, triple.eccentricity, M),
          `${triple.id}: published E does not satisfy Kepler's equation`,
        ).toBeLessThan(triple.toleranceRadians);
      }
    });

    it("the residual check REJECTS both a naive answer and one half an orbit away", () => {
      // The companion demonstration for the primary check, so neither is trusted on
      // the strength of having passed. Half an orbit out is the shape of the real
      // defect: trajectory.ts's worst answers are off by close to pi.
      const e = 0.9;
      const M = 1.0;
      const correct = CONFORMANT[0].solve(M, e);

      expect(residual(correct, e, M)).toBeLessThan(
        grid.maxAbsoluteResidualRadians,
      );
      expect(residual(M, e, M)).toBeGreaterThan(0.1);
      expect(residual(correct + Math.PI, e, M)).toBeGreaterThan(0.1);
    });
  });

  describe("ONE solver, and the ratchet that keeps it that way", () => {
    /**
     * The Newton residual line, `E - e*sin(E) - M`, as all three implementations
     * wrote it. It is the most distinctive line in a Newton solve of this equation
     * and the one every copy had.
     */
    const NEWTON_RESIDUAL = /Math\.sin\([A-Za-z0-9_]+\) - [A-Za-z0-9_.]+;?$/m;

    /** Every TypeScript source in the repo, excluding build output and this file. */
    function sourcesToScan(): string[] {
      const out: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (
              ["node_modules", "dist", ".turbo", "test-results"].includes(
                entry.name,
              )
            ) {
              continue;
            }
            walk(full);
          } else if (
            entry.name.endsWith(".ts") ||
            entry.name.endsWith(".tsx")
          ) {
            out.push(full);
          }
        }
      };
      walk(join(repoRoot, "packages"));
      // `mod/` as well, and it is not optional. The kernel itself lives under
      // mod/sitrep-sdk now, so a scan of `packages/` alone would neither find the
      // kernel (making the "detector points at something real" check vacuous) nor
      // catch a second solver written in the sdk or in any Uplink client, which is
      // most of the code that would plausibly want one.
      walk(join(repoRoot, "mod"));
      return out;
    }

    it("exactly one file in the repo iterates Newton on Kepler's equation", () => {
      // The invariant the fix bought. There were THREE: kepler.ts, trajectory.ts, and
      // a hand-copy of trajectory.ts inside orbit-patches.ts whose own comment
      // advertised itself as "same tolerance/cap". Two of them shared a defect
      // precisely because one was copied from the other, and the copy is why fixing
      // the original would not have been enough.
      const kernel = join(
        repoRoot,
        "mod",
        "sitrep-sdk",
        "src",
        "spine",
        "kepler.ts",
      );
      const offenders = sourcesToScan()
        .filter(
          (file) =>
            file !== kernel && !file.endsWith("kepler-conformance.test.ts"),
        )
        .filter((file) => NEWTON_RESIDUAL.test(readFileSync(file, "utf8")));

      expect(offenders.map((f) => f.slice(repoRoot.length + 1))).toEqual([]);
    });

    it("the detector fires on both implementations that were deleted", () => {
      // The guard on the guard, and this one is not hypothetical: the two bodies
      // below are the deleted solvers verbatim. A detector for a shape nobody can
      // demonstrate it catching is the failure mode this whole subsystem keeps
      // producing, so it is demonstrated here against the real thing.
      const deletedFromTrajectory = `
        const M = normalisePi(meanAnomaly);
        let E = M + eccentricity * Math.sin(M);
        for (let i = 0; i < maxIterations; i++) {
          const f = E - eccentricity * Math.sin(E) - M;
          const fp = 1 - eccentricity * Math.cos(E);
          const dE = f / fp;
          E -= dE;
          if (Math.abs(dE) < tolerance) return E;
        }
        return E;`;
      const deletedFromOrbitPatches = `
        const M = normalisePi(meanAnomaly);
        let E = M + eccentricity * Math.sin(M);
        for (let i = 0; i < 50; i++) {
          const f = E - eccentricity * Math.sin(E) - M;
          const fp = 1 - eccentricity * Math.cos(E);
          const dE = f / fp;
          E -= dE;
          if (Math.abs(dE) < 1e-10) return E;
        }
        return E;`;

      expect(NEWTON_RESIDUAL.test(deletedFromTrajectory)).toBe(true);
      expect(NEWTON_RESIDUAL.test(deletedFromOrbitPatches)).toBe(true);
      expect(NEWTON_RESIDUAL.test("const r = a * (1 - e * Math.cos(E));")).toBe(
        false,
      );
    });

    it("the kernel itself is what the detector finds, so the scan is looking in the right place", () => {
      const kernel = readFileSync(
        join(repoRoot, "mod", "sitrep-sdk", "src", "spine", "kepler.ts"),
        "utf8",
      );

      expect(NEWTON_RESIDUAL.test(kernel)).toBe(true);
    });

    it("propagation.ts and orbit-patches.ts consume the kernel rather than carrying one", () => {
      for (const file of ["propagation.ts", "orbit-patches.ts"]) {
        const source = readFileSync(
          join(repoRoot, "mod", "sitrep-sdk", "src", "spine", file),
          "utf8",
        );

        expect(source, `${file} should import from the kernel`).toMatch(
          /import \{[^}]*solve[^}]*\} from "\.\/kepler"/,
        );
        expect(source, `${file} should define no solver`).not.toMatch(
          /function\s+solve(Kepler|EccentricAnomaly)/,
        );
      }
    });
  });
});
