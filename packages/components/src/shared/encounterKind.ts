import { TransitionType } from "@ksp-gonogo/sitrep-sdk";

/** The two SOI transitions a widget marks: entering another body's sphere, or leaving this one. */
export type EncounterKind = "encounter" | "escape";

/**
 * What `vessel.orbit.encounter` says the next SOI transition is, or `null` when
 * there is none to mark. A transition of any other type (a maneuver, a
 * collision, the final patch) is not an encounter either way.
 */
export function encounterKindOf(
  encounter: { transitionType: number } | null | undefined,
): EncounterKind | null {
  if (encounter?.transitionType === TransitionType.Encounter) {
    return "encounter";
  }
  if (encounter?.transitionType === TransitionType.Escape) return "escape";
  return null;
}
