import { describe, expect, it } from "vitest";
import { projectOrbitPosition } from "./projection";

/**
 * `projectOrbitPosition` must produce the SAME parent-centric SVG-space point
 * `SystemDiagram.tsx`'s private `bodyPosition` computes (periapsis on the
 * local +x axis, rotated by `lan + argPe`, parent at the origin/focus) — this
 * augment draws into the exact coordinate space the diagram itself uses, per
 * `SystemOverlayContext`'s doc comment. `SystemDiagram.tsx` is left untouched
 * (host stays unchanged); these tests pin the formula independently by
 * checking the same closed-form geometric identities `bodyPosition` relies on.
 */
describe("projectOrbitPosition", () => {
  it("places periapsis on the local +x axis for an unrotated circular orbit", () => {
    const pos = projectOrbitPosition(
      { sma: 100, ecc: 0, lan: 0, argPe: 0, trueAnomalyDeg: 0 },
      1,
    );
    expect(pos.x).toBeCloseTo(100);
    expect(pos.y).toBeCloseTo(0);
  });

  it("moves a quarter-orbit (90° true anomaly) to +y for an unrotated circular orbit", () => {
    const pos = projectOrbitPosition(
      { sma: 100, ecc: 0, lan: 0, argPe: 0, trueAnomalyDeg: 90 },
      1,
    );
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(100);
  });

  it("shrinks the periapsis radius for an eccentric orbit: r_pe = sma*(1-ecc)", () => {
    const pos = projectOrbitPosition(
      { sma: 100, ecc: 0.5, lan: 0, argPe: 0, trueAnomalyDeg: 0 },
      1,
    );
    expect(pos.x).toBeCloseTo(50);
    expect(pos.y).toBeCloseTo(0);
  });

  it("rotates the whole orbit by lan + argPe", () => {
    const pos = projectOrbitPosition(
      { sma: 100, ecc: 0, lan: 90, argPe: 0, trueAnomalyDeg: 0 },
      1,
    );
    expect(pos.x).toBeCloseTo(0);
    expect(pos.y).toBeCloseTo(100);

    const posCombined = projectOrbitPosition(
      { sma: 100, ecc: 0, lan: 45, argPe: 45, trueAnomalyDeg: 0 },
      1,
    );
    expect(posCombined.x).toBeCloseTo(0, 5);
    expect(posCombined.y).toBeCloseTo(100, 5);
  });

  it("applies the metres -> SVG-user-unit plot scale", () => {
    const pos = projectOrbitPosition(
      { sma: 100, ecc: 0, lan: 0, argPe: 0, trueAnomalyDeg: 0 },
      0.5,
    );
    expect(pos.x).toBeCloseTo(50);
    expect(pos.y).toBeCloseTo(0);
  });

  it("clamps a >=1 eccentricity input the same way bodyPosition does (never negative/undefined radius)", () => {
    const pos = projectOrbitPosition(
      { sma: 100, ecc: 1.2, lan: 0, argPe: 0, trueAnomalyDeg: 0 },
      1,
    );
    expect(Number.isFinite(pos.x)).toBe(true);
    expect(Number.isFinite(pos.y)).toBe(true);
  });
});
