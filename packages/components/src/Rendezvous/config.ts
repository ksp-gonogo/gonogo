export type DockingHudMode = "hud" | "hud-with-camera";

export interface RendezvousConfig {
  /** Auto-switch to the docking HUD when a vessel or port target closes under the approach threshold. Default true. */
  autoSwitch?: boolean;
  /** Which HUD variant auto-switch promotes to. Default "hud-with-camera". */
  hudMode?: DockingHudMode;
  /**
   * Camera id pinning the video backdrop, unset to let the filling augment
   * choose. Opaque here and passed straight through via `RendezvousHudContext`.
   */
  cameraFlightId?: number | null;
}

export type ViewMode = "tracking" | "approach" | "docking-hud";

// Distances in metres; hysteresis prevents strobing at the thresholds.
export const HUD_ENTER_M = 100;
export const HUD_EXIT_M = 150;
export const APPROACH_ENTER_M = 5_000;
export const APPROACH_EXIT_M = 5_500;
