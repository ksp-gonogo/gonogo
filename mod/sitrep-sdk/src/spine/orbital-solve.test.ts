import { describe, expect, it } from "vitest";
import { solve } from "./kepler";
import { buildElements, type WireOrbitElements } from "./kepler-reckoning";
import { bodyRadiusOf, solveOrbit, solveSelfOrbit } from "./orbital-solve";

/**
 * The orbital solve, pinned as a pure function before anything is wired to it.
 *
 * The fixtures are chosen so every expected figure can be WRITTEN DOWN from the
 * elements rather than recomputed by the code under test: a circular orbit at a
 * round `sma`, and a body whose radius is a round fraction of it.
 */

const MU = 3.5316e12;
const SMA = 2_000_000;
const BODY_RADIUS = 600_000;

/**
 * A circular equatorial orbit with the craft at periapsis at UT 0.
 *
 * Typed as the solve's own input rather than cast into it: the input is
 * `WireOrbitElements`, whose members are all `Quantityish`, so a literal
 * satisfies it outright and an `as unknown as` would only have hidden a
 * mismatch if one existed.
 */
function circular(sma = SMA, ecc = 0): WireOrbitElements {
  return {
    sma: { magnitude: sma },
    ecc: { magnitude: ecc },
    inc: { magnitude: 0 },
    lan: { magnitude: 0 },
    argPe: { magnitude: 0 },
    meanAnomalyAtEpoch: { magnitude: 0 },
    epoch: { magnitude: 0 },
    mu: { magnitude: MU },
  };
}

const PERIOD = 2 * Math.PI * Math.sqrt(SMA ** 3 / MU);

describe("solveOrbit", () => {
  it("gives the period the elements imply", () => {
    expect(solveOrbit(circular(), 0, BODY_RADIUS).period).toBeCloseTo(
      PERIOD,
      6,
    );
  });

  it("puts both apsis radii at the semi-major axis for a circle", () => {
    const s = solveOrbit(circular(), 0, BODY_RADIUS);
    expect(s.apoapsisRadius).toBeCloseTo(SMA, 6);
    expect(s.periapsisRadius).toBeCloseTo(SMA, 6);
  });

  it("subtracts the reference body's radius to reach an altitude", () => {
    const s = solveOrbit(circular(), 0, BODY_RADIUS);
    expect(s.apoapsisAlt).toBeCloseTo(SMA - BODY_RADIUS, 6);
    expect(s.periapsisAlt).toBeCloseTo(SMA - BODY_RADIUS, 6);
  });

  /**
   * The three-way discipline the caller's channel owns, passed through rather
   * than flattened: a radius that cannot be resolved YET is not the same answer
   * as one whose channel is a confirmed tombstone, and both differ from a real
   * altitude. Only the two altitude fields see it.
   */
  it("passes the body-radius discipline through to the altitudes alone", () => {
    const pending = solveOrbit(circular(), 0, undefined);
    expect(pending.apoapsisAlt).toBeUndefined();
    expect(pending.periapsisAlt).toBeUndefined();
    expect(pending.apoapsisRadius).toBeCloseTo(SMA, 6);

    const tombstone = solveOrbit(circular(), 0, null);
    expect(tombstone.apoapsisAlt).toBeNull();
    expect(tombstone.periapsisAlt).toBeNull();
    expect(tombstone.periapsisRadius).toBeCloseTo(SMA, 6);
  });

  /**
   * `sma·(1+ecc)` is still FINITE when `sma < 0`, just meaningless, so a finite
   * guard cannot catch this one and it needs its own check. Periapsis stays a
   * real positive radius for both signs.
   */
  it("has no apoapsis on a hyperbolic orbit, and still has a periapsis", () => {
    const s = solveOrbit(circular(-SMA, 1.5), 0, BODY_RADIUS);
    expect(s.apoapsisRadius).toBeNull();
    expect(s.apoapsisAlt).toBeNull();
    expect(s.periapsisRadius).toBeCloseTo(-SMA * (1 - 1.5), 6);
  });

  /**
   * The anomaly solve is elliptical-only and throws on a hyperbola, so every
   * figure built on it reads null rather than a finite number from a formula
   * that does not apply.
   */
  it("reads null for the period, anomaly and apsis countdowns on a hyperbolic orbit, without throwing", () => {
    let s: ReturnType<typeof solveOrbit> | undefined;
    expect(() => {
      s = solveOrbit(circular(-SMA, 1.2), 500, BODY_RADIUS);
    }).not.toThrow();
    expect(s?.period).toBeNull();
    expect(s?.trueAnomaly).toBeNull();
    expect(s?.timeToAp).toBeNull();
    expect(s?.timeToPe).toBeNull();
    expect(s?.nextApsisType).toBeNull();
    expect(s?.timeToNextApsis).toBeNull();
    expect(s?.periapsisAlt).toBeCloseTo(-SMA * (1 - 1.2) - BODY_RADIUS, 6);
  });

  it("counts down to periapsis from just past it, and names that apsis next", () => {
    // A quarter period after periapsis: apoapsis is half a period away, and
    // periapsis three quarters, so apoapsis is next.
    const s = solveOrbit(circular(), PERIOD / 4, BODY_RADIUS);
    expect(s.timeToAp).toBeCloseTo(PERIOD / 4, 3);
    expect(s.timeToPe).toBeCloseTo((PERIOD * 3) / 4, 3);
    expect(s.nextApsisType).toBe(1);
    expect(s.timeToNextApsis).toBeCloseTo(PERIOD / 4, 3);
  });

  it("advances the true anomaly with the view time, wrapped into [0, 360)", () => {
    expect(solveOrbit(circular(), 0, BODY_RADIUS).trueAnomaly).toBeCloseTo(
      0,
      6,
    );
    const half = solveOrbit(circular(), PERIOD / 2, BODY_RADIUS).trueAnomaly;
    expect(half).toBeCloseTo(180, 3);
    // A full period later it is back where it started rather than at 360.
    const full = solveOrbit(circular(), PERIOD, BODY_RADIUS).trueAnomaly;
    expect(full).toBeGreaterThanOrEqual(0);
    expect(full).toBeLessThan(360);
  });

  /**
   * The whole reason this is a function rather than a hook: ONE implementation
   * has to serve the craft's orbit and its target's, which are the same
   * `VesselOrbit` shape solved at the same instant. Nothing in here can reach
   * for a topic, so an orbit is an orbit.
   */
  it("solves a second, unrelated orbit the same way", () => {
    const target = solveOrbit(circular(SMA * 2), 0, BODY_RADIUS);
    expect(target.period).toBeCloseTo(
      2 * Math.PI * Math.sqrt((SMA * 2) ** 3 / MU),
      6,
    );
    expect(target.periapsisAlt).toBeCloseTo(SMA * 2 - BODY_RADIUS, 6);
  });
});

describe("solveOrbit on an eccentric orbit", () => {
  const ECC = 0.1;

  it("puts the apsis radii at sma(1 +/- ecc), with no body radius needed", () => {
    const s = solveOrbit(circular(SMA, ECC), 0, undefined);
    expect(s.apoapsisRadius).toBeCloseTo(SMA * (1 + ECC), 6);
    expect(s.periapsisRadius).toBeCloseTo(SMA * (1 - ECC), 6);
  });

  it("measures the orbital radius off the solved position at the view time", () => {
    const viewUt = 1_234;
    const { position } = solve(buildElements(circular(SMA, ECC)), viewUt);
    expect(
      solveOrbit(circular(SMA, ECC), viewUt, BODY_RADIUS).orbitalRadius,
    ).toBeCloseTo(Math.hypot(...position), 3);
  });

  it("names periapsis next while the craft is at it", () => {
    const s = solveOrbit(circular(SMA, ECC), 0, BODY_RADIUS);
    expect(s.nextApsisType).toBe(-1);
    expect(s.timeToNextApsis).toBe(s.timeToPe);
    expect(s.timeToNextApsis).toBe(0);
  });

  it("names apoapsis next a moment after periapsis", () => {
    const s = solveOrbit(circular(SMA, ECC), PERIOD * 0.01, BODY_RADIUS);
    expect(s.nextApsisType).toBe(1);
    expect(s.timeToNextApsis).toBe(s.timeToAp);
  });
});

describe("solveOrbit on degenerate elements", () => {
  it("answers null for the period and countdowns of a zero mu, never NaN or Infinity", () => {
    const zeroMu = { ...circular(), mu: { magnitude: 0 } };
    const s = solveOrbit(zeroMu, 0, BODY_RADIUS);
    expect(s.period).toBeNull();
    expect(s.timeToAp).toBeNull();
    expect(s.timeToPe).toBeNull();
  });
});

describe("bodyRadiusOf", () => {
  const table = {
    bodies: [
      { index: 1, radius: BODY_RADIUS },
      { index: 4, radius: null },
    ],
  };

  it("finds a body by its STABLE index, not its array position", () => {
    expect(bodyRadiusOf(table, 1)).toBe(BODY_RADIUS);
  });

  /**
   * The three-way discipline, which is the whole reason this is not a plain
   * lookup: four different absences, and only one of them is a confirmed one.
   */
  it("tells a confirmed absence from every other kind", () => {
    // The channel itself is a tombstone: confirmed absent.
    expect(bodyRadiusOf(null, 1)).toBeNull();
    // Not arrived yet.
    expect(bodyRadiusOf(undefined, 1)).toBeUndefined();
    // Arrived, but this body is not in it yet.
    expect(bodyRadiusOf(table, 99)).toBeUndefined();
    // Arrived, body present, but it has not reported a radius.
    expect(bodyRadiusOf(table, 4)).toBeUndefined();
    // Nothing to resolve.
    expect(bodyRadiusOf(table, null)).toBeUndefined();
  });
});

/**
 * Which of the solve survives a reckoning that declines under physics.
 *
 * The elements are osculating, so a conic cannot be carried forward from them,
 * but nothing drawn needs that: the apsides and the period are algebra on them
 * as they stand, the craft's anomaly at their own epoch is where it was when
 * they were taken, and the countdowns are the game's own, run down by the view
 * time since the sample.
 */
describe("solveSelfOrbit under a declining reckoning", () => {
  const ELEMENTS = { ...circular(SMA, 0.2), referenceBodyIndex: 1 };
  const BODIES = { bodies: [{ index: 1, radius: { magnitude: BODY_RADIUS } }] };
  const UNDER_PHYSICS = {
    status: "declined" as const,
    declined: { reason: "under-physics" as const, input: "@vessel.orbit" },
  };
  /** At periapsis at UT 0, so KSP would say half a period to apoapsis and none to periapsis. */
  const WITH_KSP_COUNTDOWNS = {
    ...ELEMENTS,
    timeToAp: { magnitude: PERIOD / 2 },
    timeToPe: { magnitude: 0 },
  };

  it("answers the apsides, period and anomaly of a CURRENT reading under physics", () => {
    const s = solveSelfOrbit(ELEMENTS, UNDER_PHYSICS, BODIES, 500, 0);

    expect(s?.apoapsisRadius).toBeCloseTo(SMA * 1.2, 6);
    expect(s?.periapsisRadius).toBeCloseTo(SMA * 0.8, 6);
    expect(s?.apoapsisAlt).toBeCloseTo(SMA * 1.2 - BODY_RADIUS, 6);
    expect(s?.period).toBeCloseTo(PERIOD, 6);
    // At the elements' own epoch (UT 0, periapsis), not advanced to UT 500.
    expect(s?.trueAnomaly).toBeCloseTo(0, 6);
    expect(s?.orbitalRadius).toBeCloseTo(SMA * 0.8, 6);
  });

  it("answers the countdowns from the game's own, at the sample instant", () => {
    const s = solveSelfOrbit(WITH_KSP_COUNTDOWNS, UNDER_PHYSICS, BODIES, 0, 0);

    expect(s?.timeToAp).toBeCloseTo(PERIOD / 2, 6);
    expect(s?.timeToPe).toBe(0);
  });

  it("runs them down by the view time elapsed since the sample", () => {
    const s = solveSelfOrbit(
      WITH_KSP_COUNTDOWNS,
      UNDER_PHYSICS,
      BODIES,
      1500,
      1000,
    );

    // 500 s after the sample: the apoapsis is 500 s nearer.
    expect(s?.timeToAp).toBeCloseTo(PERIOD / 2 - 500, 6);
    // The periapsis was reached at the sample, so the next one is a period on.
    expect(s?.timeToPe).toBeCloseTo(PERIOD - 500, 6);
    expect(s?.nextApsisType).toBe(1);
    expect(s?.timeToNextApsis).toBeCloseTo(PERIOD / 2 - 500, 6);
  });

  it("counts to the NEXT apoapsis once the view time has passed this one", () => {
    const s = solveSelfOrbit(
      WITH_KSP_COUNTDOWNS,
      UNDER_PHYSICS,
      BODIES,
      PERIOD / 2 + 100,
      0,
    );

    expect(s?.timeToAp).toBeCloseTo(PERIOD - 100, 6);
    expect(s?.timeToPe).toBeCloseTo(PERIOD / 2 - 100, 6);
    expect(s?.nextApsisType).toBe(-1);
    expect(s?.timeToNextApsis).toBeCloseTo(PERIOD / 2 - 100, 6);
  });

  it("gives a hyperbolic orbit no apoapsis, and no periapsis once it has passed", () => {
    const flyby = {
      ...circular(-SMA, 1.5),
      referenceBodyIndex: 1,
      timeToAp: { magnitude: 1234 },
      timeToPe: { magnitude: 300 },
    };

    const before = solveSelfOrbit(flyby, UNDER_PHYSICS, BODIES, 100, 0);
    expect(before?.timeToAp).toBeNull();
    expect(before?.timeToPe).toBeCloseTo(200, 6);
    expect(before?.nextApsisType).toBe(-1);

    const after = solveSelfOrbit(flyby, UNDER_PHYSICS, BODIES, 400, 0);
    expect(after?.timeToAp).toBeNull();
    expect(after?.timeToPe).toBeNull();
    expect(after?.nextApsisType).toBeNull();
    expect(after?.timeToNextApsis).toBeNull();
  });

  it("answers no countdown for a sample that carries none", () => {
    const s = solveSelfOrbit(ELEMENTS, UNDER_PHYSICS, BODIES, 500, 0);

    expect(s?.timeToAp).toBeNull();
    expect(s?.timeToPe).toBeNull();
    expect(s?.nextApsisType).toBeNull();
    expect(s?.timeToNextApsis).toBeNull();
  });

  it("answers nothing for a STALE reading under physics: under thrust old elements describe no current orbit", () => {
    expect(
      solveSelfOrbit(WITH_KSP_COUNTDOWNS, UNDER_PHYSICS, BODIES, 500),
    ).toBeNull();
  });

  it("answers nothing for any other decline", () => {
    for (const reason of [
      "beyond-horizon",
      "model-inapplicable",
      "input-absent",
      "contested",
      "insufficient-history",
    ] as const) {
      expect(
        solveSelfOrbit(
          WITH_KSP_COUNTDOWNS,
          { status: "declined", declined: { reason } },
          BODIES,
          500,
          0,
        ),
      ).toBeNull();
    }
  });

  it("advances to the view time when the model is available", () => {
    // The control: the same elements, a live model, and the anomaly moves.
    const s = solveSelfOrbit(
      ELEMENTS,
      { status: "available" },
      BODIES,
      PERIOD / 4,
      0,
    );

    expect(s?.trueAnomaly).toBeGreaterThan(0);
    expect(s?.timeToAp).not.toBeNull();
  });
});
