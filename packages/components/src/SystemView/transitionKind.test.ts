import { TransitionType } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { type EncounterKind, soiEventKind } from "./predictedTrajectory";

/** Which patch transitions are SOI crossings, and which way: one row per `TransitionType` member, so a member added to the C# enum is a missing row here and a compile error in `soiEventKind`. */
const CASES: ReadonlyArray<{
  transition: keyof typeof TransitionType;
  kind: EncounterKind | null;
}> = [
  { transition: "Initial", kind: null },
  { transition: "Final", kind: null },
  { transition: "Encounter", kind: "encounter" },
  { transition: "Escape", kind: "escape" },
  // A burn, not a crossing: the vessel is in the same SOI on both sides.
  { transition: "Maneuver", kind: null },
  // An impact ends the trajectory rather than moving it to another body.
  { transition: "Collision", kind: null },
  // An unrecognised transition is not a crossing that can be drawn.
  { transition: "Unknown", kind: null },
];

describe("SOI event kinds", () => {
  it("rules on every member of TransitionType", () => {
    const ruled = CASES.map((c) => c.transition).sort();
    const declared = Object.keys(TransitionType)
      .filter((k) => !Number.isInteger(Number(k)))
      .sort();
    expect(ruled).toEqual(declared);
  });

  for (const { transition, kind } of CASES) {
    it(`reads ${transition} as ${kind ?? "not an SOI crossing"}`, () => {
      expect(soiEventKind(TransitionType[transition])).toBe(kind);
    });
  }

  it("says nothing for an ordinal that is not a transition at all", () => {
    expect(soiEventKind(99 as TransitionType)).toBeNull();
  });
});
