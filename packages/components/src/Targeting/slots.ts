/*
 * Two docking-HUD overlay slots receive the HUD's reticle frame:
 * `targeting.camera` (a camera Uplink's video backdrop; this widget decides
 * WHETHER one shows, the augment WHICH camera, and there is deliberately no
 * built-in) and `targeting.overlay` (alignment markers over the reticle,
 * composable by priority).
 */

/** The HUD's reticle-space context, passed to both the camera and overlay slots. */
export interface TargetingHudContext {
  /** Half-range in degrees the reticle box maps to; the reticle clamps at the edge. */
  maxDeg: number;
  /** Reticle-centre offset from HUD centre, each component in -1..1; `y` is flipped so positive is downward. */
  reticleOffset: { x: number; y: number };
  /** Percent of the half-box the reticle travels per unit of `reticleOffset`: a marker at `50 + offset·reticleTravelPct` % sits in the same space. */
  reticleTravelPct: number;
  /** True while the two ports are within docking-alignment tolerance. */
  aligned: boolean;
  /** Raw docking alignment angles in degrees; undefined outside a docking scenario. */
  ax: number | undefined;
  ay: number | undefined;
  /** Range to the target in metres; undefined until the stream reports position. */
  distance: number | undefined;
  /** Camera id the operator pinned, or unset to let the augment choose. */
  cameraFlightId: number | null | undefined;
}

// Declaration-merge the slot ids onto their props types in core's `SlotRegistry`.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "targeting.camera": TargetingHudContext;
    "targeting.overlay": TargetingHudContext;
  }
}
