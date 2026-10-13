import { describe, expect, it } from "vitest";
import { value } from "../unit-system/value";
import {
  type OrbitElements,
  PropagationHorizonKindLike,
  solve,
  solveAnomalies,
  solveConic,
  solveEccentricAnomaly,
  solveHyperbolicAnomaly,
  TrajectoryKindLike,
  trueAnomalyFromHyperbolic,
} from "./kepler";
import {
  propagateVesselOrbit,
  trySolve,
  trySolveAnomalies,
  type WireOrbitElements,
} from "./kepler-reckoning";
import { openOrbitArc, orbitRing, orbitTrajectory } from "./orbit-trajectory";
import { conicApsides, solveOrbit } from "./orbital-solve";
import { orbitalPeriod } from "./propagation";

/*
 * A Hohmann arrival at the Mun. The excess speed fixes the semi-major axis at
 * -mu/v², and the periapsis radius then fixes the eccentricity, so every
 * expected figure below is written from those two numbers and the vis-viva
 * equation, never from the solver under test.
 */
const MUN_MU = 6.5138398e10;
const MUN_SOI = 2_429_559;
const EXCESS_SPEED = 278;
const PERIAPSIS_RADIUS = 250_000;
const SMA = -MUN_MU / EXCESS_SPEED ** 2;
const ECC = 1 + PERIAPSIS_RADIUS / Math.abs(SMA);
const MEAN_MOTION = Math.sqrt(MUN_MU / Math.abs(SMA) ** 3);

function flyby(overrides: Partial<OrbitElements> = {}): OrbitElements {
  return {
    sma: SMA,
    ecc: ECC,
    inc: 0.3,
    lan: 1.1,
    argPe: 2.2,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
    mu: MUN_MU,
    ...overrides,
  };
}

function wire(elements: OrbitElements): WireOrbitElements {
  const deg = (rad: number) => (rad * 180) / Math.PI;
  return {
    sma: elements.sma,
    ecc: elements.ecc,
    inc: deg(elements.inc),
    lan: deg(elements.lan),
    argPe: deg(elements.argPe),
    meanAnomalyAtEpoch: elements.meanAnomalyAtEpoch,
    epoch: elements.epoch,
    mu: elements.mu,
  };
}

const length = (v: readonly [number, number, number]) => Math.hypot(...v);

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

describe("solveHyperbolicAnomaly", () => {
  it("solves M = e·sinh(H) − H across grazing and steep orbits, near and far from periapsis", () => {
    const eccentricities = [1 + 1e-9, 1.000001, 1.01, ECC, 2, 10, 500];
    const anomalies = [1e-12, 1e-6, 0.01, 0.5, 1, 7, 100, 1e4, 1e7];
    for (const ecc of eccentricities) {
      for (const m of anomalies) {
        for (const meanAnomaly of [m, -m]) {
          const h = solveHyperbolicAnomaly(meanAnomaly, ecc);
          expect(Number.isFinite(h)).toBe(true);
          expect(Math.sign(h)).toBe(Math.sign(meanAnomaly));
          const back = ecc * Math.sinh(h) - h;
          expect(Math.abs(back - meanAnomaly)).toBeLessThanOrEqual(
            1e-9 * Math.max(1, Math.abs(meanAnomaly)),
          );
        }
      }
    }
  });

  it("is zero at periapsis", () => {
    expect(solveHyperbolicAnomaly(0, ECC)).toBe(0);
  });

  it("refuses an eccentricity that is not above 1, by name", () => {
    expect(() => solveHyperbolicAnomaly(1, 1)).toThrow(RangeError);
    expect(() => solveHyperbolicAnomaly(1, 0.5)).toThrow(/open orbit/);
  });
});

describe("solve on an open orbit", () => {
  it("puts the craft at the stated periapsis, at the vis-viva speed, when the mean anomaly is zero", () => {
    const state = solve(flyby(), 0);
    expect(length(state.position)).toBeCloseTo(PERIAPSIS_RADIUS, 3);
    expect(length(state.velocity)).toBeCloseTo(
      Math.sqrt(EXCESS_SPEED ** 2 + (2 * MUN_MU) / PERIAPSIS_RADIUS),
      6,
    );
  });

  it("conserves energy and angular momentum along the whole pass", () => {
    const energy = EXCESS_SPEED ** 2 / 2;
    const momentum = Math.sqrt(MUN_MU * Math.abs(SMA) * (ECC * ECC - 1));
    for (const ut of [-40_000, -9000, -600, 0, 45, 3000, 9000, 250_000]) {
      const { position, velocity } = solve(flyby(), ut);
      const r = length(position);
      const v = length(velocity);
      expect((v * v) / 2 - MUN_MU / r).toBeCloseTo(energy, 5);
      expect(length(cross(position, velocity))).toBeCloseTo(momentum, 1);
    }
  });

  it("approaches the excess speed far from the body", () => {
    const { position, velocity } = solve(flyby(), 5e9);
    expect(length(position)).toBeGreaterThan(1e12);
    expect(length(velocity)).toBeCloseTo(EXCESS_SPEED, 3);
  });

  it("moves at the velocity it reports", () => {
    for (const ut of [-7000, -300, 0, 1200, 8000]) {
      const before = solve(flyby(), ut - 0.5).position;
      const after = solve(flyby(), ut + 0.5).position;
      const { velocity } = solve(flyby(), ut);
      for (let axis = 0; axis < 3; axis++) {
        expect(after[axis] - before[axis]).toBeCloseTo(velocity[axis], 2);
      }
    }
  });

  it("crosses the sphere of influence at the instant the hyperbolic anomaly gives", () => {
    const edge = Math.acosh((1 + MUN_SOI / Math.abs(SMA)) / ECC);
    const exitUt = (ECC * Math.sinh(edge) - edge) / MEAN_MOTION;
    expect(length(solve(flyby(), exitUt).position)).toBeCloseTo(MUN_SOI, 2);
    expect(length(solve(flyby(), -exitUt).position)).toBeCloseTo(MUN_SOI, 2);
  });

  it("reads only the size of the semi-major axis", () => {
    const negative = solve(flyby(), 1234);
    const positive = solve(flyby({ sma: Math.abs(SMA) }), 1234);
    expect(positive).toEqual(negative);
  });

  it("carries the mean anomaly unwrapped and keeps the true anomaly inside the asymptotes", () => {
    const limit = Math.acos(-1 / ECC);
    for (const ut of [-1e6, -5000, 5000, 1e6]) {
      const solved = solveAnomalies(flyby(), ut);
      expect(solved.meanAnomaly).toBeCloseTo(MEAN_MOTION * ut, 9);
      expect(Math.abs(solved.trueAnomaly)).toBeLessThan(limit);
      expect(Math.sign(solved.trueAnomaly)).toBe(Math.sign(ut));
      expect(solved.trueAnomaly).toBe(
        trueAnomalyFromHyperbolic(solved.eccentricAnomaly, ECC),
      );
    }
  });

  it("agrees with solveConic given the same mean motion", () => {
    const elements = flyby({ meanAnomalyAtEpoch: -1.06 });
    const conic = solveConic(
      {
        sma: value("m", elements.sma),
        ecc: value("1", elements.ecc),
        meanAnomalyAtEpoch: value("rad", elements.meanAnomalyAtEpoch),
        epoch: value("ut", elements.epoch),
      },
      value("rad·s⁻¹", MEAN_MOTION),
      value("ut", 2500),
    );
    const direct = solveAnomalies(elements, 2500);
    expect(conic.trueAnomaly).toBeCloseTo(direct.trueAnomaly, 12);
    expect(conic.meanAnomaly).toBeCloseTo(direct.meanAnomaly, 12);
    expect(conic.radius).toBeCloseTo(length(solve(elements, 2500).position), 4);
  });
});

describe("the non-throwing doors on an open orbit", () => {
  it("answer with finite figures, where a model reading them would otherwise carry NaN", () => {
    const elements = flyby({ meanAnomalyAtEpoch: -1.06 });
    const anomalies = trySolveAnomalies(elements, 2500);
    expect(anomalies?.meanAnomaly).toBeCloseTo(-1.06 + MEAN_MOTION * 2500, 12);
    const state = propagateVesselOrbit(wire(elements), 2500);
    expect(state).not.toBeNull();
    for (const n of [...(state?.position ?? []), ...(state?.velocity ?? [])]) {
      expect(Number.isFinite(n)).toBe(true);
    }
  });
});

describe("a parabolic orbit", () => {
  const parabolic = flyby({ ecc: 1 });

  it("is refused by name and never answered with NaN", () => {
    expect(() => solve(parabolic, 0)).toThrow(/parabolic/i);
    expect(() => solveAnomalies(parabolic, 0)).toThrow(RangeError);
    expect(() =>
      solveConic(
        {
          sma: value("m", SMA),
          ecc: value("1", 1),
          meanAnomalyAtEpoch: value("rad", 0),
          epoch: value("ut", 0),
        },
        value("rad·s⁻¹", MEAN_MOTION),
        value("ut", 0),
      ),
    ).toThrow(/parabolic/i);
    expect(() => solveEccentricAnomaly(0.3, 1)).toThrow(RangeError);
  });

  it("is null through the non-throwing doors", () => {
    expect(trySolve(parabolic, 0)).toBeNull();
    expect(trySolveAnomalies(parabolic, 0)).toBeNull();
    expect(propagateVesselOrbit(wire(parabolic), 0)).toBeNull();
  });
});

describe("what an open orbit lacks", () => {
  const inbound = wire(flyby({ meanAnomalyAtEpoch: -1.06 }));

  it("has no period and no apoapsis, and both are absent, not zero", () => {
    const solved = solveOrbit(inbound, value("ut", 0), 200_000);
    expect(solved.period).toBeNull();
    expect(solved.apoapsisRadius).toBeNull();
    expect(solved.apoapsisAlt).toBeNull();
    expect(solved.timeToAp).toBeNull();
    expect(orbitalPeriod(flyby())).toBeNull();
    expect(orbitalPeriod(flyby({ sma: Math.abs(SMA) }))).toBeNull();
    expect(conicApsides(inbound, 200_000).apoapsisRadius).toBeNull();
  });

  it("keeps its periapsis, its anomaly and its radius", () => {
    const solved = solveOrbit(inbound, value("ut", 0), 200_000);
    expect(solved.periapsisRadius).toBeCloseTo(PERIAPSIS_RADIUS, 3);
    expect(solved.periapsisAlt).toBeCloseTo(PERIAPSIS_RADIUS - 200_000, 3);
    expect(solved.orbitalRadius).toBeGreaterThan(PERIAPSIS_RADIUS);
    expect(solved.orbitalRadius).toBeLessThan(MUN_SOI);
    // Inbound, so the craft is in the half of the orbit before periapsis.
    expect(solved.trueAnomaly).toBeGreaterThan(180);
    expect(solved.trueAnomaly).toBeLessThan(360);
  });

  it("counts down to its one periapsis and has no next one after it", () => {
    const before = solveOrbit(inbound, value("ut", 0), undefined);
    expect(before.timeToPe).toBeCloseTo(1.06 / MEAN_MOTION, 6);
    expect(before.nextApsisType).toBe(-1);
    expect(before.timeToNextApsis).toBe(before.timeToPe);

    const after = solveOrbit(inbound, value("ut", 6000), undefined);
    expect(after.timeToPe).toBeNull();
    expect(after.nextApsisType).toBeNull();
    expect(after.timeToNextApsis).toBeNull();
    expect(after.trueAnomaly).toBeGreaterThan(0);
    expect(after.trueAnomaly).toBeLessThan(180);
  });
});

describe("drawing an open orbit", () => {
  it("has no closed ring", () => {
    expect(orbitRing(flyby())).toEqual([]);
  });

  it("is an arc from one edge of the sphere of influence to the other, through periapsis", () => {
    const arc = openOrbitArc(flyby(), MUN_SOI, 64);
    expect(arc).toHaveLength(65);
    const radii = arc.map(length);
    expect(radii[0]).toBeCloseTo(MUN_SOI, 3);
    expect(radii[64]).toBeCloseTo(MUN_SOI, 3);
    expect(Math.max(...radii)).toBeCloseTo(MUN_SOI, 3);
    expect(Math.min(...radii)).toBeCloseTo(PERIAPSIS_RADIUS, 3);
    expect(radii[32]).toBeCloseTo(PERIAPSIS_RADIUS, 3);
  });

  it("passes through the places the solver puts the craft", () => {
    const arc = openOrbitArc(flyby(), MUN_SOI, 2048);
    for (const ut of [-5000, -500, 0, 2500]) {
      const { position } = solve(flyby(), ut);
      const nearest = Math.min(
        ...arc.map((p) =>
          Math.hypot(
            p[0] - position[0],
            p[1] - position[1],
            p[2] - position[2],
          ),
        ),
      );
      expect(nearest).toBeLessThan(2000);
    }
  });

  it("has no points for a closed orbit or a radius inside periapsis", () => {
    expect(openOrbitArc(flyby({ sma: 700_000, ecc: 0.2 }), MUN_SOI)).toEqual(
      [],
    );
    expect(openOrbitArc(flyby(), PERIAPSIS_RADIUS / 2)).toEqual([]);
    expect(openOrbitArc(flyby(), Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it("samples an integrated open orbit forward to the horizon its provider stated", () => {
    const answer = orbitTrajectory({
      orbit: {
        ...wire(flyby({ meanAnomalyAtEpoch: -1.06 })),
        horizon: {
          kind: PropagationHorizonKindLike.Until,
          untilUt: 4000,
          trajectoryKind: TrajectoryKindLike.Integrated,
        },
      },
      viewUt: 0,
      samples: 32,
    });
    expect(answer.shape).toBe("arc");
    if (answer.shape !== "arc") return;
    expect(answer.toUt).toBe(4000);
    expect(answer.farEnd).toBe("horizon");
    expect(answer.points).toHaveLength(32);
    for (const p of answer.points) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    }
  });

  it("draws no arc for an integrated open orbit with no bound, which nothing ends", () => {
    const answer = orbitTrajectory({
      orbit: {
        ...wire(flyby()),
        horizon: {
          kind: PropagationHorizonKindLike.Unbounded,
          trajectoryKind: TrajectoryKindLike.Integrated,
        },
      },
      viewUt: 0,
    });
    expect(answer).toMatchObject({
      shape: "withheld",
      reason: "no-arc-available",
    });
  });
});
