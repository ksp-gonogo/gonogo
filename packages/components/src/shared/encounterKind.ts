import { TransitionType } from "@ksp-gonogo/sitrep-sdk";

/** The two SOI transitions a widget marks: entering another body's sphere, or leaving this one. */
export type EncounterKind = "encounter" | "escape";

/** The next SOI transition, or `null`; a maneuver, collision or final patch is neither kind. */
export function encounterKindOf(
  encounter: { transitionType: number } | null | undefined,
): EncounterKind | null {
  if (encounter?.transitionType === TransitionType.Encounter) {
    return "encounter";
  }
  if (encounter?.transitionType === TransitionType.Escape) return "escape";
  return null;
}
