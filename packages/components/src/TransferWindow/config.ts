import type { ActionDefinition } from "@ksp-gonogo/core";

export interface TransferWindowConfig {
  /** Show the porkchop plot. Default: true. */
  showPorkchop?: boolean;
  /** Alarm lead time in hours (warp steps down this far before the window). Default: 6. */
  leadHours?: number;
  /** Δv held back from the reach verdicts (m/s), e.g. a lander's descent budget. Default 0. */
  reserveDeltaV?: number;
}

/** Local mirror of the app's TimeTrigger shape (components can't import app). */
export interface TimeTrigger {
  kind: "time";
  ut: number;
  leadSeconds: number;
}

export const transferWindowActions = [
  {
    id: "cycleDestination",
    label: "Next Destination",
    accepts: ["button"],
    description: "Cycle the transfer destination to the next sibling body.",
  },
] as const satisfies readonly ActionDefinition[];

export type TransferWindowActions = typeof transferWindowActions;
