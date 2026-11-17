type Plain = { magnitude: number } | null | undefined;

/** The quantities of a `vessel.flight` payload the ground track draws and keeps. */
export interface FlightQuantities {
  latitude?: Plain;
  longitude?: Plain;
  altitudeAsl?: Plain;
  dynamicPressureKPa?: Plain;
  mach?: Plain;
  surfaceSpeed?: Plain;
  verticalSpeed?: Plain;
}

/** The flight quantities as plain numbers, each absent when the payload lacks it or holds a non-finite one. */
export interface FlightNumbers {
  lat?: number;
  lon?: number;
  alt?: number;
  q?: number;
  mach?: number;
  speed?: number;
  vSpeed?: number;
}

const finite = (n: number | undefined): number | undefined =>
  n !== undefined && Number.isFinite(n) ? n : undefined;

/**
 * The one place a flight payload becomes the plain numbers the map's
 * trajectory trail and readouts hold. The live reading and the positions the
 * stream stored both pass through it, so the two cannot disagree on a unit or
 * on what counts as absent.
 */
export function flightNumbers(
  flight: FlightQuantities | undefined,
): FlightNumbers {
  return {
    lat: finite(flight?.latitude?.magnitude),
    lon: finite(flight?.longitude?.magnitude),
    alt: finite(flight?.altitudeAsl?.magnitude),
    q: finite(flight?.dynamicPressureKPa?.magnitude),
    mach: finite(flight?.mach?.magnitude),
    speed: finite(flight?.surfaceSpeed?.magnitude),
    vSpeed: finite(flight?.verticalSpeed?.magnitude),
  };
}
