import { describe, expect, it } from "vitest";
import { computeTargetFraming } from "./framingGeometry";

const bounds = {
  yawMin: -90,
  yawMax: 90,
  pitchMin: -45,
  pitchMax: 45,
  fovMin: 10,
  fovMax: 90,
};
const frame = { width: 200, height: 120 };

describe("computeTargetFraming", () => {
  it("centres the target when yaw/pitch are zero and fov is mid-range", () => {
    const { centroid } = computeTargetFraming(
      { yaw: 0, pitch: 0, fov: 50 },
      bounds,
      frame,
    );
    expect(centroid[0]).toBeCloseTo(100, 1);
    expect(centroid[1]).toBeCloseTo(60, 1);
  });

  it("offsets the centroid right for positive yaw", () => {
    const { centroid } = computeTargetFraming(
      { yaw: 45, pitch: 0, fov: 50 },
      bounds,
      frame,
    );
    expect(centroid[0]).toBeGreaterThan(100);
    expect(centroid[1]).toBeCloseTo(60, 1);
  });

  it("shrinks the target span as fov decreases (zoom in)", () => {
    const wide = computeTargetFraming(
      { yaw: 0, pitch: 0, fov: 80 },
      bounds,
      frame,
    );
    const tight = computeTargetFraming(
      { yaw: 0, pitch: 0, fov: 20 },
      bounds,
      frame,
    );
    const span = (f: typeof wide) => f.corners.tr[0] - f.corners.tl[0];
    expect(span(tight)).toBeLessThan(span(wide));
  });
});
