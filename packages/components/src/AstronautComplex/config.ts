import type { ActionDefinition } from "@ksp-gonogo/core";

export type AstronautComplexConfig = Record<string, never>;

/**
 * Firing from a bound input is "cycle then act": `highlightNextAvailable` walks
 * the highlight over every sackable crew member, and `fireHighlighted` arms on
 * its first press and fires on its second. Moving the highlight disarms.
 */
export const astronautComplexActions = [
  {
    id: "highlightNextAvailable",
    label: "Next available crew",
    accepts: ["button"],
    description:
      "Cycles the highlighted crew member, among those who can be fired: the target fireHighlighted acts on.",
  },
  {
    id: "fireHighlighted",
    label: "Fire highlighted crew",
    accepts: ["button"],
    description:
      "First press arms, second press fires the highlighted crew member back to the applicant pool.",
  },
] as const satisfies readonly ActionDefinition[];

export type AstronautComplexActions = typeof astronautComplexActions;
