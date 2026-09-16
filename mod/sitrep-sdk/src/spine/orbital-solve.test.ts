import { describe, expect, it } from "vitest";
import type { WireOrbitElements } from "./kepler-reckoning";
import { bodyRadiusOf, solveOrbit } from "./orbital-solve";

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
