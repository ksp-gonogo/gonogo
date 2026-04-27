import { describe, expect, it } from "vitest";
import { compareVersions, parseSemver } from "./compare";

describe("parseSemver", () => {
  it("parses M.m.p", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it("parses with leading/trailing whitespace", () => {
    expect(parseSemver("  0.0.1  ")).toEqual({ major: 0, minor: 0, patch: 1 });
  });

  it("ignores pre-release suffix but accepts the version", () => {
    expect(parseSemver("1.2.3-rc.1")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    });
  });

  it("rejects non-semver strings", () => {
    expect(parseSemver("1.2")).toBeNull();
    expect(parseSemver("v1.2.3")).toBeNull();
    expect(parseSemver("garbage")).toBeNull();
    expect(parseSemver("")).toBeNull();
  });

  it("rejects nullish input", () => {
    expect(parseSemver(undefined)).toBeNull();
    expect(parseSemver(null)).toBeNull();
  });
});

describe("compareVersions", () => {
  it("returns 'same' for identical versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe("same");
  });

  it("returns 'patch' when only the patch differs", () => {
    expect(compareVersions("1.2.3", "1.2.4")).toBe("patch");
    expect(compareVersions("1.2.4", "1.2.3")).toBe("patch");
  });

  it("returns 'minor' when only the minor differs", () => {
    expect(compareVersions("1.2.3", "1.3.0")).toBe("minor");
  });

  it("returns 'minor' even when the patch also differs", () => {
    expect(compareVersions("1.2.3", "1.3.7")).toBe("minor");
  });

  it("returns 'major' when the major differs (regardless of others)", () => {
    expect(compareVersions("1.2.3", "2.0.0")).toBe("major");
    expect(compareVersions("1.2.3", "2.5.7")).toBe("major");
  });

  it("returns 'unknown' when remote is missing or malformed", () => {
    expect(compareVersions("1.2.3", undefined)).toBe("unknown");
    expect(compareVersions("1.2.3", null)).toBe("unknown");
    expect(compareVersions("1.2.3", "")).toBe("unknown");
    expect(compareVersions("1.2.3", "garbage")).toBe("unknown");
  });

  it("returns 'unknown' when local is malformed", () => {
    expect(compareVersions("garbage", "1.2.3")).toBe("unknown");
  });

  it("ignores pre-release suffixes when comparing", () => {
    expect(compareVersions("1.2.3-rc.1", "1.2.3")).toBe("same");
    expect(compareVersions("1.2.3-rc.1", "1.2.4")).toBe("patch");
  });
});
