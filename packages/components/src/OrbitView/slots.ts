/**
 * Props for the `orbit-view.overlay` slot, in the diagram's body-centric SVG units: the body at `center`, +x along the apsis line before `argPe` rotation, +y up in the orbital frame.
 * `scale` is the visible half-extent, apoapsis-driven except on a hyperbolic orbit, where it follows periapsis as `OrbitDiagram` does.
 */
export interface OrbitOverlayContext {
  /** Semi-major axis, distance units (metres from body centre). */
  sma: number;
  /** Eccentricity. */
  ecc: number;
  /**
   * Apoapsis radius from body centre, same units. `undefined` on a
   * hyperbolic orbit (`ecc >= 1`): there is no apoapsis to report.
   */
  apoapsis?: number;
  /** Periapsis radius from body centre, same units. */
  periapsis: number;
  /** Argument of periapsis, degrees (rotates the ellipse in-plane). */
  argPe: number;
  /** Current vessel true anomaly, degrees. */
  trueAnomaly: number;
  /** Parent body physical radius, same units, when known. */
  bodyRadius?: number;
  /** The body's position in the diagram's SVG frame (its origin). */
  center: { x: number; y: number };
  /** Visible half-extent of the frame, distance units (apoapsis-driven). */
  scale: number;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "orbit-view.overlay": OrbitOverlayContext;
  }
}
