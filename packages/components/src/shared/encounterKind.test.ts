import { TransitionType } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { encounterKindOf } from "./encounterKind";

describe("encounterKindOf", () => {
  it("marks entering another body's sphere and leaving this one", () => {
    expect(encounterKindOf({ transitionType: TransitionType.Encounter })).toBe(
      "encounter",
    );
    expect(encounterKindOf({ transitionType: TransitionType.Escape })).toBe(
      "escape",
    );
  });

  it("marks no other transition", () => {
    expect(
      encounterKindOf({ transitionType: TransitionType.Initial }),
    ).toBeNull();
    expect(
      encounterKindOf({ transitionType: TransitionType.Final }),
    ).toBeNull();
  });

  it("marks nothing when there is no encounter", () => {
    expect(encounterKindOf(null)).toBeNull();
    expect(encounterKindOf(undefined)).toBeNull();
  });
});
