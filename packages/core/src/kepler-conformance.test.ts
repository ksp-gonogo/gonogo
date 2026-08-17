import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { solveAnomalies } from "../../sitrep-client/src/kepler";
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

interface Grid {
  eccentricities: number[];
  meanAnomaliesNearZero: number[];
  meanAnomalySweepCount: number;
  maxAbsoluteResidualRadians: number;
  maxMeanAnomalyErrorForRoundTripRadians: number;
  areaLawRelativeTolerance: number;
  areaLawSimpsonIntervals: number;
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
 * The brief said "all five". There are not five. `packages/sitrep-client/src/propagation.ts`
 * has no solver of its own and imports `solve` from `kepler.ts`, so it is a consumer
 * rather than an implementation; and `orbit-patches.ts`'s `solveKepler` is
 * module-private, so nothing outside that file can call it. Both facts are pinned
 * below rather than asserted in prose, because both would stop being true silently.
 */
const CONFORMANT: ReadonlyArray<{
  name: string;
  solve: (M: number, e: number) => number;
}> = [
  {
    name: "packages/sitrep-client/src/kepler.ts (solveAnomalies)",
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
];

/**
 * Held to the contract and known to fail it.
 *
 * Landing this suite red would block every agent's pre-push on a shared branch, so
 * the failure is pinned as an assertion of the CURRENT behaviour instead of left to
 * fail. The number stays visible either way, and this has a property a skip does not:
 * it fails the moment someone fixes the file, which is exactly when it should be
 * deleted.
 *
 * WHEN THIS BLOCK FAILS: the implementation has been fixed. Delete the block and move
 * the entry into CONFORMANT above. Do not weaken it.
 *
 * <b>Note what is NOT claimed.</b> There is no threshold here, because the defect is
 * not one. Above the onset the solver fails on a small fraction of mean anomalies,
 * all just after periapsis, and passes on the rest: at e = 0.994 it is 736 points in
 * 200,000, at e = 0.999 it is 5,251. So `noFailureObservedAtOrBelow` is a statement
 * about a 200,000-sample sweep and not a safety guarantee, and it is named that way
 * on purpose. An earlier, coarser sweep put the onset at 0.997; density moved it.
 */
const KNOWN_BROKEN = {
  name: "packages/core/src/calc/trajectory.ts (solveKepler)",
  solve: coreSolveKepler,
  noFailureObservedAtOrBelow: 0.993,
  failsSporadicallyAtOrAbove: 0.994,
};

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

  describe(`${KNOWN_BROKEN.name} [KNOWN BROKEN, do not fix here]`, () => {
    it(`has no observed failure at or below e = ${KNOWN_BROKEN.noFailureObservedAtOrBelow}`, () => {
      const failures: string[] = [];
      for (const e of grid.eccentricities.filter(
        (x) => x <= KNOWN_BROKEN.noFailureObservedAtOrBelow,
      )) {
        for (const M of meanAnomalies()) {
          const r = residual(KNOWN_BROKEN.solve(M, e), e, M);
          if (!(r <= grid.maxAbsoluteResidualRadians)) {
            failures.push(`e=${e} M=${M} residual=${r.toExponential(3)}`);
          }
        }
      }
      expect(failures.slice(0, 10)).toEqual([]);
    });

    it(`returns NON-SOLUTIONS at and above e = ${KNOWN_BROKEN.failsSporadicallyAtOrAbove}, off by up to pi`, () => {
      // Pinned, not skipped, and pinned as the failure rather than as an absence.
      // The cause is one missing branch: kepler.ts and the C# provider start Newton
      // at E = pi once e >= 0.8, which is the guard that keeps it converging near
      // periapsis of a very eccentric orbit, and this implementation always starts
      // at M + e sin(M). It then returns its last iterate whether or not the
      // tolerance was met, and says nothing.
      let worstResidual = 0;
      let worstAt = "";
      let failing = 0;
      let total = 0;
      for (const e of grid.eccentricities.filter(
        (x) => x >= KNOWN_BROKEN.failsSporadicallyAtOrAbove,
      )) {
        for (const M of meanAnomalies()) {
          total++;
          const r = residual(KNOWN_BROKEN.solve(M, e), e, M);
          if (r > 1e-9) failing++;
          if (r > worstResidual) {
            worstResidual = r;
            worstAt = `e=${e} M=${M}`;
          }
        }
      }

      // Off by of order pi, i.e. the answer is on the far side of the orbit, and on
      // a MINORITY of points, which is why no threshold is claimed anywhere here.
      expect(worstResidual).toBeGreaterThan(1.0);
      expect(failing).toBeGreaterThan(0);
      expect(failing).toBeLessThan(total);
      // Recorded so the numbers survive in the run log rather than only in a report.
      expect(
        `worst residual ${worstResidual.toFixed(2)} rad at ${worstAt}`,
      ).toContain("rad at e=");
    });

    it("returns a confident number for an eccentricity the elliptic form does not describe", () => {
      // The other half of the same defect, and the reason the boundary contract is
      // asserted above rather than left implicit: same input, one refusal from
      // kepler.ts and one meaningless number from here.
      expect(() => KNOWN_BROKEN.solve(1.0, 1.4)).not.toThrow();
      expect(Number.isFinite(KNOWN_BROKEN.solve(1.0, 1.4))).toBe(true);
    });
  });

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

  describe("what this suite cannot reach, pinned so it cannot change silently", () => {
    it("orbit-patches.ts carries a private copy of the trajectory.ts solver, so the verdict transfers", () => {
      // It cannot be called from outside its module, so it cannot be swept directly,
      // and exporting it would mean editing a file this task is not allowed to touch.
      // What CAN be checked is that it is still the same algorithm: same starter,
      // same tolerance, same iteration cap, same silent return of the last iterate.
      const source = readFileSync(
        join(repoRoot, "packages", "sitrep-client", "src", "orbit-patches.ts"),
        "utf8",
      );

      expect(source).toContain("let E = M + eccentricity * Math.sin(M)");
      expect(source).toContain("if (Math.abs(dE) < 1e-10) return E;");
      expect(source).not.toContain("Math.PI :");
      expect(source).not.toMatch(/export function solveKepler/);
    });

    it("propagation.ts has no solver of its own, so it is a consumer rather than a fifth implementation", () => {
      const source = readFileSync(
        join(repoRoot, "packages", "sitrep-client", "src", "propagation.ts"),
        "utf8",
      );

      expect(source).toContain('import { solve } from "./kepler"');
      expect(source).not.toMatch(/function\s+solve(Kepler|EccentricAnomaly)/);
    });
  });
});
