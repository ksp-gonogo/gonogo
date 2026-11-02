import type { ActionDefinition } from "@ksp-gonogo/core";

export type DockingHudMode = "hud" | "hud-with-camera";

export interface RendezvousConfig {
  /** Step through the levels on its own as the target's range and kind change. Default true. */
  autoSwitch?: boolean;
  /** Which docking view the Docking level shows: the reticle alone, or over a camera picture. Default "hud-with-camera". */
  hudMode?: DockingHudMode;
  /**
   * Camera id pinning the video backdrop, unset to let the filling augment
   * choose. Opaque here and passed straight through via `RendezvousHudContext`.
   */
  cameraFlightId?: number | null;
}

export const rendezvousActions = [
  {
    id: "level-in",
    label: "Level in",
    accepts: ["button"],
    description: "Step the view in one level, toward the target.",
  },
  {
    id: "level-out",
    label: "Level out",
    accepts: ["button"],
    description: "Step the view out one level, away from the target.",
  },
] as const satisfies readonly ActionDefinition[];

export type RendezvousActions = typeof rendezvousActions;
