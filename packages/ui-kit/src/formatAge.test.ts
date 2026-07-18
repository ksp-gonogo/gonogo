import { describe, expect, it } from "vitest";
import { formatAge, formatAgeLong } from "./formatAge";

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
