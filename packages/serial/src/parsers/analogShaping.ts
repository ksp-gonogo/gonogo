import type { AnalogCurve, DeviceInput } from "../types";

/**
 * Apply deadzone + response curve to a normalised analog value.
 *
 * `polarity` (default `bipolar`) selects the input's range: `bipolar` spans
 * -1..1 and rests at centre (sticks); `unipolar` spans 0..1 and rests at
 * zero (triggers). Without this distinction, a *released* unipolar input
 * fed through the bipolar deadzone math would read as fully negative
 * instead of resting at zero — bind a trigger to a throttle and the rest
 * position would read full reverse.
 *
 * Deadzone snaps values near rest to the rest value and rescales the
 * remaining travel so the curve still saturates at the input's max
 * (otherwise a deadzone of 0.1 would cap usable travel short of full
 * scale, which feels broken):
 *   bipolar:  |v| < dz snaps to 0, remaining travel rescales to reach ±1.
 *   unipolar: v < dz snaps to 0, remaining travel rescales to reach 1.
 *
 * Curves are sign-preserving (a no-op for unipolar's non-negative range):
 *   linear:  v
 *   squared: sign(v) · v² — finer control near centre
 *   cubic:   v³           — even finer near centre, hard pull at the ends
 */
export function applyAnalogShaping(
  input: Pick<DeviceInput, "deadzone" | "curve" | "polarity">,
  normalised: number,
): number {
  const dz = input.deadzone ?? 0;
  const curve = input.curve ?? "linear";

  if (input.polarity === "unipolar") {
    let v = normalised;
    if (dz > 0 && dz < 1) {
      if (v <= dz) return 0;
      v = (v - dz) / (1 - dz);
    }
    // Curves are defined sign-preserving for the bipolar (-1..1) range;
    // a unipolar value is already non-negative, so applying them directly
    // gives the intended "finer control near rest" shape without needing a
    // separate curve implementation.
    return applyCurve(v, curve);
  }

  let v = normalised;
  if (dz > 0 && dz < 1) {
    const mag = Math.abs(v);
    if (mag <= dz) return 0;
    v = Math.sign(v) * ((mag - dz) / (1 - dz));
  }
  return applyCurve(v, curve);
}

function applyCurve(v: number, curve: AnalogCurve): number {
  switch (curve) {
    case "squared":
      return v * Math.abs(v);
    case "cubic":
      return v * v * v;
    default:
      return v;
  }
}
