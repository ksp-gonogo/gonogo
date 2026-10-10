import { type Value, value } from "@ksp-gonogo/sitrep-sdk";

export interface BurnEffectInputs {
  /** What the engines are pushing with now. */
  thrust: Value<"kN"> | null;
  /** The vessel's whole mass. */
  vesselMass: Value<"t"> | null;
  /** How far the nose is above the horizon, -90 to 90 degrees. */
  pitch: Value<"°"> | null;
  /** Compass heading of the nose, degrees clockwise from north. */
  heading: Value<"°"> | null;
  /** Compass bearing of the line the cross-section is cut along, degrees clockwise from north. */
  trackBearingDeg: number | null;
}

/**
 * The acceleration the burn lit now gives the vessel, m/s squared, as how much of it is up and how much along the cross-section's track: thrust over mass, in the way the nose points.
 * Null when the thrust, the mass or the attitude is missing or the engines are off, so no burn is drawn rather than a zero-length one.
 */
export function burnEffect(
  inputs: Readonly<BurnEffectInputs>,
): { up: number; along: number } | null {
  const { thrust, vesselMass, pitch, heading, trackBearingDeg } = inputs;
  if (
    thrust == null ||
    vesselMass == null ||
    pitch == null ||
    heading == null ||
    trackBearingDeg == null ||
    !Number.isFinite(trackBearingDeg) ||
    !thrust.isFinite() ||
    !vesselMass.isFinite() ||
    !pitch.isFinite() ||
    !heading.isFinite() ||
    !thrust.isPositive() ||
    !vesselMass.isPositive()
  ) {
    return null;
  }
  const accel = thrust.per(vesselMass).in("m/s²");
  // Plain numbers only at this edge: the angles go into trigonometry and the results into plot coordinates.
  const pitchRad = pitch.in("rad").valueOf();
  const off = heading.minus(value("°", trackBearingDeg)).in("rad").valueOf();
  return {
    up: accel.scaled(Math.sin(pitchRad)).valueOf(),
    along: accel.scaled(Math.cos(pitchRad) * Math.cos(off)).valueOf(),
  };
}

/**
 * Whether the engines are lit: a reading of now with thrust above zero. A held reading is the last thing seen and an absent one nothing, and neither is a burn.
 */
export function isBurning(propulsion: {
  readonly state: string;
  readonly value?: { readonly currentThrust: Value<"kN"> };
}): boolean {
  return (
    propulsion.state === "observed" &&
    propulsion.value != null &&
    propulsion.value.currentThrust.isPositive()
  );
}
