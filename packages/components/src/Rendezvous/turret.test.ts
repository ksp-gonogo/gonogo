import { describe, expect, it } from "vitest";
import { arcPose, ease, type Places, pivotFor, stepPoses } from "./turret";

const box = { w: 926, h: 772 };
const places: Places = {
  large: { x: 604, y: 375 },
  small: { x: 135, y: 585 },
  out: { x: -135, y: 585 },
  incoming: { x: 1224, y: 375 },
  smallScale: 0.4,
};

describe("ease", () => {
  it("holds at the ends and passes the middle at half", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(ease(0.5)).toBe(0.5);
  });
});

describe("arcPose", () => {
  const pivot = pivotFor(box);

  it("starts and ends exactly on its two places", () => {
    const start = arcPose(pivot, places.large, places.small, 0);
    const end = arcPose(pivot, places.large, places.small, 1);
    expect(start.x).toBeCloseTo(places.large.x, 6);
    expect(start.y).toBeCloseTo(places.large.y, 6);
    expect(end.x).toBeCloseTo(places.small.x, 6);
    expect(end.y).toBeCloseTo(places.small.y, 6);
  });

  it("ends upright and is tilted on the way", () => {
    expect(arcPose(pivot, places.large, places.small, 1).tilt).toBeCloseTo(
      0,
      9,
    );
    expect(
      Math.abs(arcPose(pivot, places.large, places.small, 0.5).tilt),
    ).toBeGreaterThan(0.01);
  });

  it("bows off the straight line between its places, which is what makes it an arc", () => {
    const mid = arcPose(pivot, places.large, places.small, 0.5);
    const chordMid = {
      x: (places.large.x + places.small.x) / 2,
      y: (places.large.y + places.small.y) / 2,
    };
    expect(Math.hypot(mid.x - chordMid.x, mid.y - chordMid.y)).toBeGreaterThan(
      20,
    );
  });

  it("scales between the two scales", () => {
    expect(
      arcPose(pivot, places.large, places.small, 0.5, 1, 0.4).scale,
    ).toBeCloseTo(0.7, 9);
  });
});

describe("stepPoses", () => {
  const pivot = pivotFor(box);

  it("has the circles on their starting places before the step", () => {
    const p = stepPoses(pivot, places, 0);
    expect(p.leaving.x).toBeCloseTo(places.large.x, 6);
    expect(p.old.x).toBeCloseTo(places.small.x, 6);
    expect(p.arriving.x).toBeCloseTo(places.incoming.x, 6);
  });

  it("has the large circle in the small place, the old one out and the new one in the large place after it", () => {
    const p = stepPoses(pivot, places, 1);
    expect(p.leaving.x).toBeCloseTo(places.small.x, 6);
    expect(p.leaving.scale).toBeCloseTo(places.smallScale, 9);
    expect(p.old.x).toBeCloseTo(places.out.x, 6);
    expect(p.arriving.x).toBeCloseTo(places.large.x, 6);
    expect(p.arriving.tilt).toBeCloseTo(0, 9);
  });

  it("moves every circle at once, on one progress", () => {
    for (const u of [0.1, 0.3, 0.5, 0.8]) {
      const p = stepPoses(pivot, places, u);
      expect(p.leaving.x).toBeLessThan(places.large.x);
      expect(p.old.x).toBeLessThan(places.small.x);
      expect(p.arriving.x).toBeLessThan(places.incoming.x);
    }
  });

  it("covers the same share of every circle's way at each instant", () => {
    const share = (from: number, to: number, at: number) =>
      (from - at) / (from - to);
    const p = stepPoses(pivot, places, 0.3);
    const e = ease(0.3);
    expect(p.arriving.scale).toBe(1);
    // Scale rides the same easing as position.
    expect(p.leaving.scale).toBeCloseTo(1 + (places.smallScale - 1) * e, 9);
    expect(share(1, places.smallScale, p.leaving.scale)).toBeCloseTo(e, 9);
  });

  it("leans every circle by the same angle, falling to upright together", () => {
    const p = stepPoses(pivot, places, 0.4);
    expect(p.leaving.tilt).toBeCloseTo(p.old.tilt, 9);
    expect(p.old.tilt).toBeCloseTo(p.arriving.tilt, 9);
    expect(Math.abs(p.leaving.tilt)).toBeGreaterThan(0.01);
    const end = stepPoses(pivot, places, 1);
    expect(end.leaving.tilt).toBeCloseTo(0, 9);
    expect(end.arriving.tilt).toBeCloseTo(0, 9);
  });

  it("turns every circle the same way about the pivot", () => {
    const angle = (p: { x: number; y: number }) =>
      Math.atan2(p.y - pivot.y, p.x - pivot.x);
    const at = (u: number) => stepPoses(pivot, places, u);
    expect(angle(at(0.4).leaving)).toBeLessThan(angle(at(0).leaving));
    expect(angle(at(0.5).old)).toBeLessThan(angle(at(0).old));
    expect(angle(at(0.9).arriving)).toBeLessThan(angle(at(0.5).arriving));
  });
});
