import { describe, expect, it } from "vitest";
import { closingSpeed, deriveDockAngles, NEAR_AXIS_M } from "./dockAngles";

describe("closingSpeed", () => {
  it("is positive while the range shrinks", () => {
    expect(
      closingSpeed({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: -1.8 }),
    ).toBeCloseTo(1.8);
  });

  it("is negative while the range opens", () => {
    expect(
      closingSpeed({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 1 }),
    ).toBeCloseTo(-1);
  });

  it("is plain zero, not minus zero, when the range holds", () => {
    const rate = closingSpeed({ x: 0, y: 0, z: 10 }, { x: 1, y: 0, z: 0 });
    expect(Object.is(rate, 0)).toBe(true);
  });

  it("has no value at zero separation", () => {
    expect(
      closingSpeed({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    ).toBeUndefined();
  });
});

describe("deriveDockAngles", () => {
  it("is the line-of-sight angle off the approach axis", () => {
    const { ax, ay } = deriveDockAngles({ x: 4, y: -2, z: 40 });
    expect(ax).toBeCloseTo((Math.atan2(4, 40) * 180) / Math.PI);
    expect(ay).toBeCloseTo((Math.atan2(-2, 40) * 180) / Math.PI);
  });

  it("holds a centimetre offset small as the ports touch", () => {
    const at = (z: number) => deriveDockAngles({ x: 0.05, y: 0, z }).ax;
    expect(at(0.5)).toBeLessThan(1.5);
    expect(at(0.02)).toBeLessThan(1.5);
    expect(at(0.5)).toBe(at(0.02));
    expect(at(NEAR_AXIS_M)).toBe(at(0.5));
  });

  it("continues unbroken where the near rule starts", () => {
    const at = (z: number) => deriveDockAngles({ x: 0.3, y: 0, z }).ax;
    expect(at(NEAR_AXIS_M + 0.001)).toBeCloseTo(at(NEAR_AXIS_M - 0.001), 2);
  });
});
