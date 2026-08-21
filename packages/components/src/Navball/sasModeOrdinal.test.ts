import { SasMode } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { SAS_MODES, sasModeOrdinal } from "./index";

/**
 * The SAS grid sends an ORDINAL, and reads a NAME back.
 *
 * `vessel.control.setSasMode` takes `Sitrep.Contract.SasMode`'s integer, and
 * the button list used to supply it with `SAS_MODES.indexOf(mode)`: a
 * hand-ordered local array standing in for the C# declaration order, with
 * nothing checking the two still agree. TargetPicker's label tables have a
 * drift guard for exactly this; this array had none, and it is a control
 * surface, so drift here means pressing Prograde and burning Retrograde.
 */

/** Enum member names in ordinal order, off the generated enum's reverse map. */
function declaredModes(): string[] {
  return Object.entries(SasMode)
    .filter(([key]) => Number.isInteger(Number(key)))
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, name]) => String(name));
}

describe("SAS mode dispatch", () => {
  it("can read the SasMode members at all", () => {
    // Guards the guard: an extractor returning nothing would make every
    // assertion below vacuous and report success.
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

  /**
   * `Unknown` is the contract's graceful fallback for a mode this build does
   * not recognize, never something an operator asks for, so it is the one
   * member with no button. Every other member must have one: a mode the grid
   * cannot show is a SAS state the operator cannot read off the navball.
   */
  it("offers a button for every commandable member", () => {
    expect([...SAS_MODES].sort()).toEqual(
      declaredModes()
        .filter((name) => name !== "Unknown")
        .sort(),
    );
  });
});
