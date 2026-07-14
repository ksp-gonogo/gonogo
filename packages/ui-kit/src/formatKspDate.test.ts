import { describe, expect, it } from "vitest";
import { formatKspDate } from "./formatKspDate";

describe("formatKspDate", () => {
  it("formats UT 0 as Year 1, Day 1, midnight", () => {
    expect(formatKspDate(0)).toBe("Y1 D1 00:00:00");
  });

  it("rolls over to day 2 at the KSP day boundary (21600s = 6h)", () => {
    expect(formatKspDate(21600)).toBe("Y1 D2 00:00:00");
  });

  it("rolls over to year 2 at the KSP year boundary (9,201,600s = 426d)", () => {
    expect(formatKspDate(9_201_600)).toBe("Y2 D1 00:00:00");
  });

  it("formats a mid-day time with non-zero H:M:S", () => {
    // Day 5 (dayIndex 4, dayStart 86400) + 03:22:37 (12157s) = UT 98557.
    expect(formatKspDate(98_557)).toBe("Y1 D5 03:22:37");
  });

  it("formats a large multi-year UT", () => {
    // Year 3 (yearIndex 2, yearStart 18,403,200) + day 100 (dayIndex 99,
    // dayStart 2,138,400) + 05:15:20 (18920s) = UT 20,560,520.
    expect(formatKspDate(20_560_520)).toBe("Y3 D100 05:15:20");
  });

  it("returns an em dash for non-finite input", () => {
    expect(formatKspDate(Number.NaN)).toBe("—");
    expect(formatKspDate(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatKspDate(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("clamps negative UT to the epoch rather than going negative", () => {
    // KSP UT is never negative in normal play; clamp to the epoch instead
    // of surfacing a nonsensical Y0/negative-day reading.
    expect(formatKspDate(-1)).toBe("Y1 D1 00:00:00");
    expect(formatKspDate(-9_201_600)).toBe("Y1 D1 00:00:00");
  });
});
