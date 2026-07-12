import { describe, expect, it } from "vitest";
import { compareVersions, satisfiesKernel, satisfiesModRange } from "./version";

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("returns >0 when a is greater", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
  });

  it("handles missing components by treating them as 0", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.2", "1.3.0")).toBeLessThan(0);
  });
});

describe("satisfiesKernel", () => {
  it("is satisfied when kernel version is above the minimum", () => {
    expect(satisfiesKernel("1.5.0", "1.2.0")).toBe(true);
  });

  it("is not satisfied when kernel version is below the minimum", () => {
    expect(satisfiesKernel("1.0.0", "1.2.0")).toBe(false);
  });

  it("is satisfied when kernel version equals the minimum (inclusive)", () => {
    expect(satisfiesKernel("1.2.0", "1.2.0")).toBe(true);
  });

  it("is satisfied when there is no minimum constraint", () => {
    expect(satisfiesKernel("1.2.0", undefined)).toBe(true);
  });
});

describe("satisfiesModRange", () => {
  it("is satisfied within the range", () => {
    expect(satisfiesModRange("1.5.0", { min: "1.0.0", max: "2.0.0" })).toBe(
      true,
    );
  });

  it("treats min as inclusive", () => {
    expect(satisfiesModRange("1.0.0", { min: "1.0.0", max: "2.0.0" })).toBe(
      true,
    );
  });

  it("treats max as exclusive", () => {
    expect(satisfiesModRange("2.0.0", { min: "1.0.0", max: "2.0.0" })).toBe(
      false,
    );
  });

  it("is satisfied by any version >= min when max is open", () => {
    expect(satisfiesModRange("999.0.0", { min: "1.0.0" })).toBe(true);
    expect(satisfiesModRange("1.0.0", { min: "1.0.0" })).toBe(true);
  });

  it("is not satisfied below min", () => {
    expect(satisfiesModRange("0.9.0", { min: "1.0.0", max: "2.0.0" })).toBe(
      false,
    );
  });

  it("is satisfied when there is no range constraint", () => {
    expect(satisfiesModRange("1.5.0", undefined)).toBe(true);
  });

  it("is not satisfied when mod version is undefined but a range is defined", () => {
    expect(satisfiesModRange(undefined, { min: "1.0.0" })).toBe(false);
  });
});
