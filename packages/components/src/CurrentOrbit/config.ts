import type { ActionDefinition } from "@ksp-gonogo/core";

/**
 * A frame Current Orbit can read in. The vessel's elements are about its
 * reference body, so a pin names no body of its own and means that one, which
 * keeps it meaning something across an SOI change.
 */
export interface CurrentOrbitFrameChoice {
  kind: "follow-control-frame" | "body-centred-inertial";
}

export interface CurrentOrbitConfig {
  /** Show the mini SVG orbit diagram. Default: true. */
  showDiagram?: boolean;
  /** The frame the readouts are read in. Absent follows the Control Frame. */
  frame?: CurrentOrbitFrameChoice;
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
