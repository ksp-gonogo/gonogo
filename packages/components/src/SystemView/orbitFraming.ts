import { MAX_ZOOM } from "./usePanZoom";

/** How much further than the craft's apoapsis the framed view reaches, as a ratio of the apoapsis. */
const ORBIT_MARGIN = 1.25;

/**
 * The zoom at which the craft's whole orbit about the frame body fits the picture with a margin, centred on the frame body, or null when the craft has no closed orbit about it.
 * Never below the whole frame: an orbit already as wide as the frame is shown by the whole frame.
 */
export function orbitFramingZoom({
  orbit,
  frameName,
  plotScale,
  halfPicturePlotUnits,
}: {
  orbit: { parentName: string; sma: number; ecc: number } | null;
  frameName: string | null;
  /** Metres to plot units at zoom 1. */
  plotScale: number | null;
  /** Half of the picture's shorter side, in plot units. */
  halfPicturePlotUnits: number | null;
}): number | null {
  if (orbit === null || frameName === null || orbit.parentName !== frameName) {
    return null;
  }
  if (plotScale === null || halfPicturePlotUnits === null) return null;
  const closed =
    Number.isFinite(orbit.sma) &&
    Number.isFinite(orbit.ecc) &&
    orbit.sma > 0 &&
    orbit.ecc >= 0 &&
    orbit.ecc < 1;
  if (!closed || !(plotScale > 0) || !(halfPicturePlotUnits > 0)) return null;
  const reach = orbit.sma * (1 + orbit.ecc) * plotScale * ORBIT_MARGIN;
  return Math.min(MAX_ZOOM, Math.max(1, halfPicturePlotUnits / reach));
}
