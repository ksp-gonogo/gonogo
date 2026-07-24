import { describe, expect, it } from "vitest";
import { greatCircle } from "./geo";

const R = 600_000; // Kerbin-ish radius, metres

describe("greatCircle", () => {
  it("is zero distance for the same point", () => {
    expect(greatCircle(10, 20, 10, 20, R).distanceMeters).toBeCloseTo(0, 3);
  });

  it("bears due north when the target is at a higher latitude, same longitude", () => {
    const gc = greatCircle(0, 0, 1, 0, R);
    expect(gc.bearingDeg).toBeCloseTo(0, 3);
    // 1° of latitude ≈ R * (π/180) metres.
    expect(gc.distanceMeters).toBeCloseTo(R * (Math.PI / 180), 0);
  });

  it("bears due east when the target is at a higher longitude on the equator", () => {
    const gc = greatCircle(0, 0, 0, 1, R);
    expect(gc.bearingDeg).toBeCloseTo(90, 3);
  });

  it("bears due south when the target is at a lower latitude", () => {
    expect(greatCircle(5, 0, 0, 0, R).bearingDeg).toBeCloseTo(180, 3);
  });
});
