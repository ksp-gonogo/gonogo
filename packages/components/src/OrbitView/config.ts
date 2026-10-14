import type { ActionDefinition } from "@ksp-gonogo/core";

/**
 * A frame Orbit View can read its figures in. The vessel's elements are about
 * its reference body, so a pin names no body of its own and means that one,
 * which keeps it meaning something across an SOI change.
 */
export interface OrbitViewFrameChoice {
  kind: "follow-control-frame" | "body-centred-inertial";
}

export interface OrbitViewConfig {
  /** Show Ap/Pe markers. Default: true. */
  showMarkers?: boolean;
  /** Show the orbit diagram when the tile has room for it. Default: true. */
  showDiagram?: boolean;
  /** The frame the figures are read in. Absent follows the Control Frame. */
  frame?: OrbitViewFrameChoice;
}

export const orbitViewActions = [
  {
    id: "toggle-markers",
    label: "Toggle Markers",
    accepts: ["button"],
    description: "Show or hide the Ap/Pe markers.",
  },
  {
    id: "toggle-diagram",
    label: "Toggle Diagram",
    accepts: ["button"],
    description: "Show or hide the orbit diagram, leaving the figures.",
  },
] as const satisfies readonly ActionDefinition[];

export type OrbitViewActions = typeof orbitViewActions;
