import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { crewChipDetail, parseCrew } from "./crew";
import { parseSavedShips, shipBlockedReason } from "./ships";

describe("launch figures that the wire did not carry", () => {
  it("keeps a ship's parts, mass and price as null, and does not call it unaffordable", () => {
    const [ship] = parseSavedShips([{ name: "Bare" }]) ?? [];
    expect(ship).toMatchObject({
      partCount: null,
      totalMass: null,
      requiresFunds: null,
    });
    expect(shipBlockedReason(ship, 0)).toBeNull();
  });

  it("keeps a kerbal's level as null and writes the no-data token for it", () => {
    const [kerbal] = parseCrew([{ name: "Jeb", trait: "Pilot" }]) ?? [];
    expect(kerbal.experienceLevel).toBeNull();
    expect(crewChipDetail(kerbal, "available")).toBe(`Pilot ${NULL_DISPLAY}`);
  });

  it("keeps a real zero as zero", () => {
    const [kerbal] = parseCrew([{ name: "Bob", experienceLevel: 0 }]) ?? [];
    expect(kerbal.experienceLevel).toBe(0);
  });
});
