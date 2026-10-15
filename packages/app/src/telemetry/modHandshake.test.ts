import { describe, expect, it } from "vitest";
import {
  assessModHandshake,
  describeBreakingHandshake,
  describeMinorDifference,
  isBreakingHandshake,
} from "./modHandshake";

const app = { contractMajor: 44, contractMinor: 2 };

describe("assessModHandshake", () => {
  it("matches when both numbers agree", () => {
    expect(
      assessModHandshake({ contractMajor: 44, contractMinor: 2 }, app).kind,
    ).toBe("match");
  });

  it("reads a hello with no contract numbers as a mod too old to say, and breaking", () => {
    const handshake = assessModHandshake({ modVersion: "v1.0.0" }, app);
    expect(handshake.kind).toBe("too-old");
    expect(isBreakingHandshake(handshake)).toBe(true);
  });

  it("names which side is behind on a different major", () => {
    const older = assessModHandshake(
      { contractMajor: 43, contractMinor: 9 },
      app,
    );
    const newer = assessModHandshake(
      { contractMajor: 45, contractMinor: 0 },
      app,
    );
    expect(older.kind).toBe("mod-major-older");
    expect(newer.kind).toBe("mod-major-newer");
    expect(isBreakingHandshake(older)).toBe(true);
    expect(isBreakingHandshake(newer)).toBe(true);
  });

  it("treats a minor difference on either side as not breaking", () => {
    const modAhead = assessModHandshake(
      { contractMajor: 44, contractMinor: 3 },
      app,
    );
    const appAhead = assessModHandshake(
      { contractMajor: 44, contractMinor: 1 },
      app,
    );
    expect(modAhead.kind).toBe("mod-minor-newer");
    expect(appAhead.kind).toBe("app-minor-newer");
    expect(isBreakingHandshake(modAhead)).toBe(false);
    expect(isBreakingHandshake(appAhead)).toBe(false);
    expect(describeMinorDifference(modAhead)).toMatch(/Update this app/);
    expect(describeMinorDifference(appAhead)).toMatch(/Update the mod/);
  });
});

describe("describeBreakingHandshake", () => {
  it("names both versions and the side to update", () => {
    const text = describeBreakingHandshake(
      assessModHandshake({ contractMajor: 43, contractMinor: 0 }, app),
      "v1.3.0",
      "1.4.0",
    );
    expect(text).toContain("mod 1.3.0");
    expect(text).toContain("1.4.0");
    expect(text).toContain("contract 43");
    expect(text).toContain("contract 44");
    expect(text).toMatch(/Update the mod/);
  });

  it("says to update the app when the mod is ahead", () => {
    const text = describeBreakingHandshake(
      assessModHandshake({ contractMajor: 45, contractMinor: 0 }, app),
      null,
      "1.4.0",
    );
    expect(text).toMatch(/Update this app/);
  });

  it("is null when the stream is readable", () => {
    expect(
      describeBreakingHandshake({ kind: "match" }, "v1.4.0", "1.4.0"),
    ).toBeNull();
  });
});
