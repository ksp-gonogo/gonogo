import { describe, expect, it } from "vitest";
import { lambertDeltaV, solveLambert, type Vec3Tuple } from "./lambert";

// Curtis, "Orbital Mechanics for Engineering Students", Example 5.2, the
// canonical Lambert test case. Units: km, s, km/s; μ_earth = 398600 km³/s².
const MU_EARTH_KM = 398600;

describe("solveLambert: Curtis Example 5.2 (prograde, single-rev)", () => {
  const r1: Vec3Tuple = [5000, 10000, 2100];
  const r2: Vec3Tuple = [-14600, 2500, 7000];
  const tof = 3600;

  it("recovers the published v1 and v2 (km/s)", () => {
    const sol = solveLambert(r1, r2, tof, MU_EARTH_KM, true);
    expect(sol).not.toBeNull();
    if (!sol) return;
    // Published: v1 = (-5.9925, 1.9254, 3.2456), v2 = (-3.3125, -4.1966, -0.38529)
    expect(sol.v1[0]).toBeCloseTo(-5.9925, 2);
    expect(sol.v1[1]).toBeCloseTo(1.9254, 2);
    expect(sol.v1[2]).toBeCloseTo(3.2456, 2);
    expect(sol.v2[0]).toBeCloseTo(-3.3125, 2);
    expect(sol.v2[1]).toBeCloseTo(-4.1966, 2);
    expect(sol.v2[2]).toBeCloseTo(-0.38529, 2);
  });
});

describe("solveLambert: coplanar sanity", () => {
  // A near-quarter-turn coplanar transfer converges and returns finite vectors.
  it("returns finite velocity vectors for a well-conditioned coplanar case", () => {
    const sol = solveLambert([7000, 0, 0], [0, 9000, 0], 3000, MU_EARTH_KM);
    expect(sol).not.toBeNull();
    if (!sol) return;
    for (const c of [...sol.v1, ...sol.v2])
      expect(Number.isFinite(c)).toBe(true);
  });

  it("prograde and retrograde give different solutions", () => {
    const pro = solveLambert(
      [7000, 0, 0],
      [0, 9000, 0],
      3000,
      MU_EARTH_KM,
      true,
    );
    const retro = solveLambert(
      [7000, 0, 0],
      [0, 9000, 0],
      3000,
      MU_EARTH_KM,
      false,
    );
    expect(pro).not.toBeNull();
    expect(retro).not.toBeNull();
    if (!pro || !retro) return;
    // z-component of the two transfer planes flips sign between the branches
    expect(Math.sign(pro.v1[1])).not.toBe(Math.sign(retro.v1[1]));
  });
});

describe("lambertDeltaV: porkchop cell cost", () => {
  it("sums |v1 − vDep| + |v2 − vArr| (the two hyperbolic-excess magnitudes)", () => {
    // Straight-line-ish: pick departure/arrival body velocities and confirm the
    // helper returns the two excess magnitudes summed.
    const sol = solveLambert([7000, 0, 0], [0, 9000, 0], 3000, MU_EARTH_KM);
    expect(sol).not.toBeNull();
    if (!sol) return;
    const vDep: Vec3Tuple = [0, 7.5, 0];
    const vArr: Vec3Tuple = [-6.6, 0, 0];
    const total = lambertDeltaV(sol, vDep, vArr);
    const mag = (a: Vec3Tuple, b: Vec3Tuple) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(total).toBeCloseTo(mag(sol.v1, vDep) + mag(sol.v2, vArr), 6);
  });
});
