import type { OrbitOverlayContext } from "./slots";

// Mirrors `OrbitDiagram`'s `HYPERBOLIC_SCALE` so the overlay's `scale` matches the diagram's bounds on a hyperbolic orbit.
const HYPERBOLIC_OVERLAY_SCALE = 5;

/** The overlay slot is a DRAWING contract: an Uplink gets the same plot-space numbers the diagram itself works in. */
export function overlayContext(orbit: {
  sma: number;
  ecc: number;
  escaping: boolean;
  apoapsis: number | null | undefined;
  periapsis: number;
  argPe: number;
  trueAnomaly: number;
  bodyRadius: number | undefined;
}): OrbitOverlayContext {
  return {
    sma: orbit.sma,
    ecc: orbit.ecc,
    apoapsis: orbit.apoapsis ?? undefined,
    periapsis: orbit.periapsis,
    argPe: orbit.argPe,
    trueAnomaly: orbit.trueAnomaly,
    bodyRadius: orbit.bodyRadius,
    center: { x: 0, y: 0 },
    scale: orbit.escaping
      ? orbit.periapsis * HYPERBOLIC_OVERLAY_SCALE
      : (orbit.apoapsis ?? orbit.periapsis),
  };
}
