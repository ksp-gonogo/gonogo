import { describe, expect, it } from "vitest";
import { lengthLabel, niceLength } from "./scaleBar";

describe("niceLength", () => {
  it("picks the longest 1, 2 or 5 times a power of ten that fits", () => {
    expect(niceLength(1, 140)).toBe(100);
    expect(niceLength(1, 250)).toBe(200);
    expect(niceLength(1, 60)).toBe(50);
    expect(niceLength(0.001, 140)).toBe(100_000);
  });

  it("works at the small scales of a docking picture", () => {
    expect(niceLength(300, 140)).toBe(0.2);
  });

  it("answers null where nothing is known", () => {
    expect(niceLength(0, 140)).toBeNull();
    expect(niceLength(Number.NaN, 140)).toBeNull();
    expect(niceLength(1, 0)).toBeNull();
  });
});

describe("lengthLabel", () => {
  it("writes centimetres, metres and kilometres", () => {
    expect(lengthLabel(0.2)).toBe("20 cm");
    expect(lengthLabel(50)).toBe("50 m");
    expect(lengthLabel(500)).toBe("500 m");
    expect(lengthLabel(2_000)).toBe("2 km");
  });
});
