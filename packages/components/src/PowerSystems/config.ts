import type { ActionDefinition } from "@ksp-gonogo/core";

export interface PowerSystemsConfig {
  /** Resource to focus on, ElectricCharge by default. */
  defaultResource?: string;
}

export const powerSystemsActions = [
  {
    id: "cycleResource",
    label: "Next resource",
    accepts: ["button"],
    description: "Cycle through resources that have live flow contributions.",
  },
] as const satisfies readonly ActionDefinition[];
export type PowerSystemsActions = typeof powerSystemsActions;
