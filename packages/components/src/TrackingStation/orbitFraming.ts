import { MAX_ZOOM } from "./usePanZoom";

/** How much further than the craft's apoapsis the framed view reaches, as a ratio of the apoapsis. */
const ORBIT_MARGIN = 1.25;

/**
 * The zoom at which the craft's whole orbit about the frame body fits the picture with a margin, or null when the craft has no closed orbit about it.
 * Centred on the frame body, the orbit reaches its apoapsis from the centre. Centred on the craft (`centredOnCraft`, its true anomaly in degrees), the far side of the orbit can be as far as the craft's own distance from the frame body plus the apoapsis.
 * Never below the whole frame: an orbit already as wide as the frame is shown by the whole frame.
 */
export function orbitFramingZoom({
  orbit,
  frameName,
  plotScale,
  halfPicturePlotUnits,
  centredOnCraft,
}: {
  orbit: { parentName: string; sma: number; ecc: number } | null;
  frameName: string | null;
  /** Metres to plot units at zoom 1. */
  plotScale: number | null;
  /** Half of the picture's shorter side, in plot units. */
  halfPicturePlotUnits: number | null;
  /** The craft's true anomaly in degrees, when the view is centred on the craft rather than the frame body. */
  centredOnCraft?: number | null;
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
  const apoapsis = orbit.sma * (1 + orbit.ecc);
  const craftRadius =
    centredOnCraft === undefined || centredOnCraft === null
      ? 0
      : (orbit.sma * (1 - orbit.ecc ** 2)) /
        (1 + orbit.ecc * Math.cos((centredOnCraft * Math.PI) / 180));
  if (!Number.isFinite(craftRadius)) return null;
  const reach = (apoapsis + craftRadius) * plotScale * ORBIT_MARGIN;
  return Math.min(MAX_ZOOM, Math.max(1, halfPicturePlotUnits / reach));
}
