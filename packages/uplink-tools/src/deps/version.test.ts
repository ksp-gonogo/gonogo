import { describe, expect, it } from "vitest";
import {
  compareCkan,
  compareVersions,
  isPrerelease,
  normalisedVersion,
  plainVersion,
} from "./version";

describe("plainVersion", () => {
  it("drops the epoch and the leading v", () => {
    expect(plainVersion("1:v15.16.1.0")).toBe("15.16.1.0");
    expect(plainVersion("v4.8.0.0")).toBe("4.8.0.0");
    expect(plainVersion("3.43")).toBe("3.43");
  });
});

describe("normalisedVersion", () => {
  it("reads 15.15.0 and 15.15.0.0 as one version", () => {
    expect(normalisedVersion("15.15.0")).toBe(normalisedVersion("15.15.0.0"));
  });
});

describe("isPrerelease", () => {
  it.each([
    "1.11.0-rc.10",
    "1.0.0-beta",
    "2.16.0.0-dev",
    "v1.0.0-alpha.2",
  ])("%s is one", (version) => expect(isPrerelease(version)).toBe(true));
  it.each([
    "1.11.0",
    "v0.16.1.2",
    "2026081218-Levi-Civita",
    "3.43",
  ])("%s is not", (version) => expect(isPrerelease(version)).toBe(false));
});

describe("compareVersions", () => {
  it("orders dotted numbers numerically with a missing component as zero", () => {
    expect(compareVersions("2.15.3.1", "2.15.3.0")).toBeGreaterThan(0);
    expect(compareVersions("3.9", "3.43")).toBeLessThan(0);
    expect(compareVersions("15.15.0", "15.15.0.0")).toBe(0);
  });
  it("puts a prerelease below the release it is for", () => {
    expect(compareVersions("1.11.0-rc.10", "1.11.0")).toBeLessThan(0);
    expect(compareVersions("1.11.0-rc.10", "1.11.0-rc.9")).toBeGreaterThan(0);
  });
});

describe("compareCkan", () => {
  it("orders the epoch first", () => {
    expect(compareCkan("1:3.0", "9.9")).toBeGreaterThan(0);
  });
  it("sorts a leading v above no prefix, so min_version 4.7.0.0 is met by every v4 release", () => {
    expect(compareCkan("v4.8.0.0", "4.7.0.0")).toBeGreaterThan(0);
    expect(compareCkan("v4.7.0.0", "v4.8.0.0")).toBeLessThan(0);
  });
  it("sorts a release candidate above the release it is for", () => {
    expect(compareCkan("1.11.0-rc.10", "1.11.0")).toBeGreaterThan(0);
  });
  it("orders numbers as numbers", () => {
    expect(compareCkan("3.43", "3.9")).toBeGreaterThan(0);
    expect(compareCkan("1:v15.16.1.0", "1:v15.15.0")).toBeGreaterThan(0);
    expect(compareCkan("2.4.1.4", "2.4.1.4")).toBe(0);
  });
});
