import { SasMode } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { SAS_MODES, sasModeOrdinal } from "./index";

// The SAS grid sends the contract's ordinal: drift here means pressing Prograde and burning Retrograde.

/** Enum member names in ordinal order, off the generated enum's reverse map. */
function declaredModes(): string[] {
  return Object.entries(SasMode)
    .filter(([key]) => Number.isInteger(Number(key)))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, name]) => String(name));
}

describe("SAS mode dispatch", () => {
  it("can read the SasMode members at all", () => {
    // An extractor returning nothing would make every assertion below vacuous.
    expect(declaredModes()).toEqual([
      "StabilityAssist",
      "Prograde",
      "Retrograde",
      "Normal",
      "Antinormal",
      "RadialIn",
      "RadialOut",
      "Target",
      "AntiTarget",
      "Maneuver",
      "Unknown",
    ]);
  });

  it("sends the ordinal the contract declares, for every button", () => {
    for (const mode of SAS_MODES) {
      expect(sasModeOrdinal(mode)).toBe(SasMode[mode]);
    }
  });

  // `Unknown` is a fallback, never commanded, so it alone has no button.
  it("offers a button for every commandable member", () => {
    expect([...SAS_MODES].sort()).toEqual(
      declaredModes()
        .filter((name) => name !== "Unknown")
        .sort(),
    );
  });
});
