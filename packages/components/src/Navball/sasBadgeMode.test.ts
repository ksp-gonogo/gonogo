import { describe, expect, it } from "vitest";
import { badgeSasMode } from "./sasModes";

describe("badgeSasMode", () => {
  it("gives stability assist no token, so the toggle reads as the plain on-state", () => {
    expect(badgeSasMode("StabilityAssist")).toBe("");
  });

  it("keeps the three-letter token for every other mode", () => {
    expect(badgeSasMode("Prograde")).toBe("PRO");
    expect(badgeSasMode("Unknown")).toBe("Unknown");
  });
});
