import { TransitionType } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { type EncounterKind, soiEventKind } from "./predictedTrajectory";

/**
 * Which patch transitions are SOI crossings, and which way.
 *
 * `patchStartTransition` reaches the diagram as the enum NAME, uppercased, so
 * the decision has to be made on a string. It used to be made by a two-entry
 * `Set` with an `=== "ESCAPE"` ternary behind it, which meant a member appended
 * to `TransitionType` was silently not an SOI event: no marker on the diagram,
 * no row in the almanac, and no way to tell that from a trajectory that
 * genuinely stays in one SOI.
 *
 * This table is the rule on each member. A member added to the C# enum lands
 * here as a missing row, and in `soiEventKind` as a compile error.
 */
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
  // A transition this contract does not recognize is not a crossing we can
  // draw. Marking one would put a body's name on a diagram off a value we
  // cannot read.
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
      expect(soiEventKind(transition.toUpperCase())).toBe(kind);
    });
  }

  it("says nothing for a name that is not a transition at all", () => {
    expect(soiEventKind("SOI_CHANGE")).toBeNull();
    expect(soiEventKind("")).toBeNull();
  });
});
