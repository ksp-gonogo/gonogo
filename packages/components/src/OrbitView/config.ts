import type { ActionDefinition } from "@ksp-gonogo/core";

export interface OrbitViewConfig {
  /** Show Ap/Pe markers. Default: true. */
  showMarkers?: boolean;
}

export const orbitViewActions = [
  {
    id: "toggleMarkers",
    label: "Toggle Markers",
    accepts: ["button"],
    description: "Show or hide the Ap/Pe markers.",
  },
] as const satisfies readonly ActionDefinition[];

export type OrbitViewActions = typeof orbitViewActions;
