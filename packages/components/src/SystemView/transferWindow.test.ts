import { describe, expect, it } from "vitest";
import {
  angleDelta,
  hohmannPhaseAngle,
  transferStatus,
} from "./transferWindow";

describe("hohmannPhaseAngle", () => {
  it("matches the Earth → Mars textbook value of +44°", () => {
    // Real solar-system AU, exact ratios don't matter — the formula is
    // dimensionless in (rA + rB)/rB.
    const θ = hohmannPhaseAngle(1.0, 1.524);
    expect(θ).toBeCloseTo(44.4, 1);
  });

  it("matches the Earth → Venus textbook value of −54°", () => {
    const θ = hohmannPhaseAngle(1.0, 0.723);
    expect(θ).toBeCloseTo(-54.1, 0);
  });

  it("returns 0 when source and target share an orbit", () => {
    const θ = hohmannPhaseAngle(1.0, 1.0);
    expect(θ).toBeCloseTo(0, 5);
  });

  it("returns NaN for degenerate inputs", () => {
    expect(Number.isNaN(hohmannPhaseAngle(0, 1))).toBe(true);
    expect(Number.isNaN(hohmannPhaseAngle(1, -1))).toBe(true);
    expect(Number.isNaN(hohmannPhaseAngle(Number.NaN, 1))).toBe(true);
  });
});

describe("angleDelta", () => {
  it("returns the signed shortest path", () => {
    expect(angleDelta(10, 30)).toBe(-20);
    expect(angleDelta(30, 10)).toBe(20);
  });

  it("wraps the seam at ±180°", () => {
    // 350 → 10 should be a 20° step the short way, not 340.
    expect(angleDelta(350, 10)).toBe(-20);
    expect(angleDelta(10, 350)).toBe(20);
  });

  it("normalises to (−180, 180]", () => {
    expect(angleDelta(0, 180)).toBe(180);
    expect(angleDelta(180, 0)).toBe(180);
  });
});

describe("transferStatus", () => {
  it("'go' for tight windows, 'soon' for arming, 'off' otherwise", () => {
    expect(transferStatus(0)).toBe("go");
    expect(transferStatus(1.5)).toBe("go");
    expect(transferStatus(-1.5)).toBe("go");
    expect(transferStatus(5)).toBe("soon");
    expect(transferStatus(-9.9)).toBe("soon");
    expect(transferStatus(15)).toBe("off");
    expect(transferStatus(-180)).toBe("off");
  });
});
