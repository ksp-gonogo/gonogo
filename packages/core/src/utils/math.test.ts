import { describe, expect, it } from "vitest";
import { clamp, clamp01, lerp } from "./math";

describe("clamp", () => {
  it("returns the value when in range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps below min", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("returns min at the lower edge", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("returns max at the upper edge", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("propagates NaN", () => {
    expect(clamp(Number.NaN, 0, 10)).toBeNaN();
  });
});

describe("clamp01", () => {
  it("returns value in [0, 1]", () => {
    expect(clamp01(0.5)).toBe(0.5);
  });

  it("clamps below 0", () => {
    expect(clamp01(-0.2)).toBe(0);
  });

  it("clamps above 1", () => {
    expect(clamp01(1.5)).toBe(1);
  });

  it("returns 0 at lower edge", () => {
    expect(clamp01(0)).toBe(0);
  });

  it("returns 1 at upper edge", () => {
    expect(clamp01(1)).toBe(1);
  });

  it("propagates NaN", () => {
    expect(clamp01(Number.NaN)).toBeNaN();
  });
});

describe("lerp", () => {
  it("returns a at t=0", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("returns midpoint at t=0.5", () => {
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it("returns b at t=1", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("does not clamp t below 0", () => {
    expect(lerp(10, 20, -1)).toBe(0);
  });

  it("does not clamp t above 1", () => {
    expect(lerp(10, 20, 2)).toBe(30);
  });
});
