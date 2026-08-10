import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { formatAge, formatAgeLong, formatCompactNumber } from "./format";

describe("formatAge", () => {
  it("returns <1s for sub-second values", () => {
    expect(formatAge(0)).toBe("<1s");
    expect(formatAge(500)).toBe("<1s");
    expect(formatAge(999)).toBe("<1s");
  });

  it("formats seconds", () => {
    expect(formatAge(1000)).toBe("1s");
    expect(formatAge(45_000)).toBe("45s");
  });

  it("formats minutes", () => {
    expect(formatAge(60_000)).toBe("1min");
    expect(formatAge(120_000)).toBe("2min");
  });

  it("formats hours for large values", () => {
    expect(formatAge(3_600_000)).toBe("1h");
    expect(formatAge(7_200_000)).toBe("2h");
  });

  it("climbs to REAL days, not Kerbin ones", () => {
    // The whole reason this goes through `irl:s` rather than the game-time
    // ladder beside it. A KSP day is 6 hours, so `formatDuration` reads two
    // real days as "8d"; this is a staleness badge, and the operator means
    // the calendar on the wall.
    expect(formatAge(24 * 3_600_000)).toBe("1d");
    expect(formatAge(48 * 3_600_000)).toBe("2d");
  });

  it("shows the second tier when it is non-zero", () => {
    expect(formatAge(90_000)).toBe("1min 30s");
    expect(formatAge(5_400_000)).toBe("1h 30min");
  });
});

describe("formatAgeLong", () => {
  it("returns <1s for sub-second values", () => {
    expect(formatAgeLong(0)).toBe("<1s");
    expect(formatAgeLong(999)).toBe("<1s");
  });

  it("formats seconds", () => {
    expect(formatAgeLong(1000)).toBe("1s");
    expect(formatAgeLong(45_000)).toBe("45s");
  });

  // The "long" form used to spell its suffixes out ("2 min", "1 d") and stop
  // at hours. It is the same ladder as `formatAge` now, so what is worth
  // asserting is that the two agree rather than that one of them still has a
  // second spelling.
  it("is the same reading as formatAge", () => {
    for (const ms of [1000, 90_000, 3_600_000, 24 * 3_600_000]) {
      expect(formatAgeLong(ms)).toBe(formatAge(ms));
    }
  });
});

describe("formatCompactNumber", () => {
  it("returns small numbers as-is", () => {
    expect(formatCompactNumber(0)).toBe("0");
    expect(formatCompactNumber(42)).toBe("42");
    expect(formatCompactNumber(999)).toBe("999");
  });

  it("formats k-range with default decimals", () => {
    expect(formatCompactNumber(1500)).toBe("1.5k");
    expect(formatCompactNumber(12_345)).toBe("12.3k");
  });

  it("formats M-range with default decimals", () => {
    expect(formatCompactNumber(1_500_000)).toBe("1.5M");
    expect(formatCompactNumber(12_345_678)).toBe("12.3M");
  });

  it("strips trailing .0 in k-range", () => {
    expect(formatCompactNumber(2000)).toBe("2k");
    expect(formatCompactNumber(5000)).toBe("5k");
  });

  it("strips trailing .0 in M-range", () => {
    expect(formatCompactNumber(2_000_000)).toBe("2M");
  });

  it("respects custom decimals", () => {
    expect(formatCompactNumber(1234, 2)).toBe("1.23k");
    expect(formatCompactNumber(1_234_567, 0)).toBe("1M");
  });

  it("strips trailing .00 with decimals=2", () => {
    expect(formatCompactNumber(2000, 2)).toBe("2k");
  });

  it("handles negative numbers", () => {
    expect(formatCompactNumber(-1500)).toBe("-1.5k");
    expect(formatCompactNumber(-2_000_000)).toBe("-2M");
  });

  it("returns em-dash for non-finite values", () => {
    expect(formatCompactNumber(Number.NaN)).toBe(NULL_DISPLAY);
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe(NULL_DISPLAY);
    expect(formatCompactNumber(Number.NEGATIVE_INFINITY)).toBe(NULL_DISPLAY);
  });
});
