import type { SystemViewVesselStatusEntry } from "./vesselStatusContribution";

/**
 * Props for `system-view.overlay`, a layer over the body diagram. The frame body sits at `center`, and `d` metres projects to `d * plotScale` user units in a `width` by `height` origin-centred viewBox.
 * It describes the auto-fit view only (zoom 1, no pan), like `orbit-view.overlay`.
 */
export interface SystemOverlayContext {
  /** Name of the parent body the diagram is centred on. */
  parentName: string;
  /** Diagram pixel width (origin-centred SVG frame). */
  width: number;
  /** Diagram pixel height. */
  height: number;
  /** Metres → SVG-user-unit plot scale at the diagram's auto-fit zoom. */
  plotScale: number;
  /** The parent body sits at the SVG origin. */
  center: { x: number; y: number };
}

// The `.actions` and `.overlay` slots are designed for one augment to drive both through its own context.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    // Rendered by Panel's universal actions segment; declared so a binder types against the propless contract.
    "system-view.actions": Record<string, never>;
    "system-view.overlay": SystemOverlayContext;
  }

  /** The plotted vessel's semantic status (never a colour: the host owns the palette), fed by the built-in comms contribution and open to any Uplink. */
  interface ContributionRegistry {
    "system-view.vessel-status": {
      entry: SystemViewVesselStatusEntry;
    };
  }
}
