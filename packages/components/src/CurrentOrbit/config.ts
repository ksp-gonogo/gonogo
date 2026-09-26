import type { ActionDefinition } from "@ksp-gonogo/core";

export interface CurrentOrbitConfig {
  /** Show the mini SVG orbit diagram. Default: true. */
  showDiagram?: boolean;
}

export const currentOrbitActions = [
  {
    id: "toggleDiagram",
    label: "Toggle Diagram",
    accepts: ["button"],
    description: "Show or hide the mini orbit diagram.",
  },
] as const satisfies readonly ActionDefinition[];

export type CurrentOrbitActions = typeof currentOrbitActions;
