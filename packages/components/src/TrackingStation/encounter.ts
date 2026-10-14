/** `Sitrep.Contract.TransitionType` ordinals the encounter chip surfaces. */
const TRANSITION_TYPE_ENCOUNTER = 2;
const TRANSITION_TYPE_ESCAPE = 3;

export type EncounterDirection = "encounter" | "escape";

/** Which way the vessel's next SOI transition goes, or `null` when it is neither an encounter nor an escape. */
export function encounterDirectionOf(
  transitionType: number | undefined,
): EncounterDirection | null {
  if (transitionType === TRANSITION_TYPE_ENCOUNTER) return "encounter";
  if (transitionType === TRANSITION_TYPE_ESCAPE) return "escape";
  return null;
}
