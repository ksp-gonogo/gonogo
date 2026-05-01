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
    expect(formatAge(60_000)).toBe("1m");
    expect(formatAge(120_000)).toBe("2m");
  });

  it("formats hours for large values", () => {
    expect(formatAge(3_600_000)).toBe("1h");
    expect(formatAge(7_200_000)).toBe("2h");
    expect(formatAge(48 * 3_600_000)).toBe("48h");
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

  it("formats minutes with ' min' suffix", () => {
    expect(formatAgeLong(60_000)).toBe("1 min");
    expect(formatAgeLong(120_000)).toBe("2 min");
  });

  it("formats hours with ' h' suffix", () => {
    expect(formatAgeLong(3_600_000)).toBe("1 h");
    expect(formatAgeLong(7_200_000)).toBe("2 h");
  });

  it("formats days with ' d' suffix", () => {
    expect(formatAgeLong(86_400_000)).toBe("1 d");
    expect(formatAgeLong(2 * 86_400_000)).toBe("2 d");
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
    expect(formatCompactNumber(Number.NaN)).toBe("—");
    expect(formatCompactNumber(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatCompactNumber(Number.NEGATIVE_INFINITY)).toBe("—");
  });
});
