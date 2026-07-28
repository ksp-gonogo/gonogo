import { describe, expect, it } from "vitest";
import type { Vec3Tuple } from "./lambert";
import { buildPorkchop, type StateLike } from "./porkchop";

// A circular coplanar orbit propagator (analytic): enough to drive the grid
// builder end-to-end without the streaming Kepler propagator.
function circularBody(radius: number, mu: number, theta0: number) {
  const n = Math.sqrt(mu / radius ** 3); // rad/s
  const v = Math.sqrt(mu / radius);
  return (ut: number): StateLike => {
    const th = theta0 + n * ut;
    const position: Vec3Tuple = [
      radius * Math.cos(th),
      radius * Math.sin(th),
      0,
    ];
    const velocity: Vec3Tuple = [-v * Math.sin(th), v * Math.cos(th), 0];
    return { position, velocity };
  };
}

const MU_SUN = 1.32712440018e20;
const R1 = 1.495978707e11; // Earth
const R2 = 2.279392e11; // Mars

describe("buildPorkchop", () => {
  // Departure grid around t=0; arrival grid bracketing the ~259-day Hohmann
  // transfer time (avoids the exactly-180° degenerate cell by sampling around it).
  const day = 86400;
  const departureUts = Array.from({ length: 12 }, (_, i) => i * 20 * day);
  const arrivalUts = Array.from({ length: 12 }, (_, i) => (200 + i * 12) * day);

  const grid = buildPorkchop({
    muParent: MU_SUN,
    propagateOrigin: circularBody(R1, MU_SUN, 0),
    propagateDest: circularBody(R2, MU_SUN, Math.PI * 0.6),
    departureUts,
    arrivalUts,
  });

  it("produces a cell per (departure × arrival) pair", () => {
    expect(grid.cells).toHaveLength(departureUts.length);
    expect(grid.cells[0]).toHaveLength(arrivalUts.length);
  });

  it("skips cells where arrival ≤ departure (deltaV null)", () => {
    // arrival grid starts at 200 d, departure spans 0..220 d, the late
    // departures / early arrivals with arr ≤ dep must be null.
    const someNull = grid.cells
      .flat()
      .some((c) => c.arrUt <= c.depUt && c.deltaV === null);
    expect(someNull).toBe(true);
  });

  it("finds a finite best cell = the grid minimum, in a plausible Δv range", () => {
    expect(grid.best).not.toBeNull();
    if (!grid.best) return;
    expect(Number.isFinite(grid.best.deltaV)).toBe(true);
    expect(grid.best.deltaV).toBeGreaterThan(0);
    // Earth→Mars characteristic Δv (v∞_dep + v∞_arr) is a few km/s; loose bound.
    expect(grid.best.deltaV).toBeLessThan(20000);
    const finite = grid.cells
      .flat()
      .map((c) => c.deltaV)
      .filter((d): d is number => d !== null);
    expect(grid.best.deltaV).toBeCloseTo(Math.min(...finite), 6);
  });

  it("reports the Δv range over the finite cells", () => {
    expect(grid.minDeltaV).not.toBeNull();
    expect(grid.maxDeltaV).not.toBeNull();
    if (grid.minDeltaV === null || grid.maxDeltaV === null) return;
    expect(grid.maxDeltaV).toBeGreaterThanOrEqual(grid.minDeltaV);
    expect(grid.best?.deltaV).toBeCloseTo(grid.minDeltaV, 6);
  });
});
