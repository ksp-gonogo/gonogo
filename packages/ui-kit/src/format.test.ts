import { describe, expect, it } from "vitest";
import { formatNumber } from "./format";

describe("formatNumber", () => {
  it("returns an em dash for undefined", () => {
    expect(formatNumber(undefined)).toBe("—");
  });

  it("returns an em dash for NaN", () => {
    expect(formatNumber(Number.NaN)).toBe("—");
  });

  it("returns an em dash for Infinity", () => {
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatNumber(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("fixes to the requested decimal count", () => {
    expect(formatNumber(3.14, { decimals: 1 })).toBe("3.1");
    expect(formatNumber(42, { decimals: 0 })).toBe("42");
  });

  it("stringifies as-is when no decimals option is given", () => {
    expect(formatNumber(7)).toBe("7");
  });

  it("rounds, not truncates, when fixing decimals", () => {
    expect(formatNumber(2.36, { decimals: 1 })).toBe("2.4");
  });
});
