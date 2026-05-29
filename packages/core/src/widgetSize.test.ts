import { describe, expect, it } from "vitest";
import { getSizeBucket, getWidgetShape } from "./widgetSize";

describe("getSizeBucket", () => {
  it("returns 'normal' when dimensions are missing", () => {
    expect(getSizeBucket(undefined, undefined)).toBe("normal");
    expect(getSizeBucket(3, undefined)).toBe("normal");
    expect(getSizeBucket(undefined, 3)).toBe("normal");
  });

  it("classifies tiny when either axis is below the tiny floor", () => {
    expect(getSizeBucket(3, 3)).toBe("tiny");
    expect(getSizeBucket(4, 6)).toBe("tiny"); // w<5
    expect(getSizeBucket(8, 3)).toBe("tiny"); // h<4
  });

  it("classifies small when below the small floor but above tiny", () => {
    expect(getSizeBucket(5, 4)).toBe("small");
    expect(getSizeBucket(7, 6)).toBe("small");
    expect(getSizeBucket(5, 10)).toBe("small"); // w<8 even if h is generous
  });

  it("classifies normal at or above the small cutoff", () => {
    expect(getSizeBucket(8, 7)).toBe("normal");
    expect(getSizeBucket(12, 18)).toBe("normal");
  });
});

describe("getWidgetShape", () => {
  it("returns 'square' with aspect 1 when dimensions are missing", () => {
    expect(getWidgetShape(undefined, undefined)).toEqual({
      shape: "square",
      aspect: 1,
    });
    expect(getWidgetShape(10, undefined)).toEqual({ shape: "square", aspect: 1 });
    expect(getWidgetShape(undefined, 10)).toEqual({ shape: "square", aspect: 1 });
  });

  it("treats a zero height as missing rather than dividing by zero", () => {
    expect(getWidgetShape(10, 0)).toEqual({ shape: "square", aspect: 1 });
  });

  it("classifies landscape when clearly wider than tall", () => {
    expect(getWidgetShape(18, 5).shape).toBe("landscape"); // aspect 3.6
    expect(getWidgetShape(20, 8).shape).toBe("landscape"); // aspect 2.5
  });

  it("classifies portrait when clearly taller than wide", () => {
    expect(getWidgetShape(5, 18).shape).toBe("portrait"); // aspect ≈ 0.28
    expect(getWidgetShape(5, 10).shape).toBe("portrait"); // aspect 0.5
  });

  it("classifies near-square boxes as square", () => {
    expect(getWidgetShape(8, 8).shape).toBe("square"); // aspect 1
    expect(getWidgetShape(5, 7).shape).toBe("square"); // aspect ≈ 0.71 (default-5x7)
    expect(getWidgetShape(9, 8).shape).toBe("square"); // aspect 1.125 (mobile-9x8)
  });

  it("maps the four harness-mode aspects to the expected shapes", () => {
    expect(getWidgetShape(5, 18).shape).toBe("portrait"); // portrait-5x18 → 0.28
    expect(getWidgetShape(5, 7).shape).toBe("square"); //    default-5x7  → 0.71
    expect(getWidgetShape(9, 8).shape).toBe("square"); //    mobile-9x8   → 1.125
    expect(getWidgetShape(18, 5).shape).toBe("landscape"); // landscape-18x5 → 3.6
  });

  it("commits to the reflow exactly on the inclusive cutoff", () => {
    // Landscape cutoff is 1.6 and is inclusive (>=).
    expect(getWidgetShape(16, 10).shape).toBe("landscape"); // aspect exactly 1.6
    expect(getWidgetShape(15, 10).shape).toBe("square"); //    aspect 1.5 < 1.6
    // Portrait cutoff is 1/1.6 = 0.625 and is inclusive (<=).
    expect(getWidgetShape(10, 16).shape).toBe("portrait"); // aspect exactly 0.625
    expect(getWidgetShape(10, 15).shape).toBe("square"); //    aspect ≈ 0.667 > 0.625
  });

  it("carries the raw w/h aspect ratio", () => {
    expect(getWidgetShape(18, 5).aspect).toBeCloseTo(3.6);
    expect(getWidgetShape(5, 18).aspect).toBeCloseTo(0.2778, 3);
    expect(getWidgetShape(8, 8).aspect).toBe(1);
  });
});
