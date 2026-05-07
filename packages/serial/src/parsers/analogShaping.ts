import type { AnalogCurve, DeviceInput } from "../types";

/**
 * Apply deadzone + response curve to a normalised (-1..1) analog value.
 *
 * Deadzone snaps |v| < dz to 0 and rescales the outside so that the curve
 * still saturates at ±1 (otherwise a deadzone of 0.1 would cap usable
 * travel at 0.9, which feels broken).
 *
 * Curves are sign-preserving:
 *   linear:  v
 *   squared: sign(v) · v² — finer control near centre
 *   cubic:   v³           — even finer near centre, hard pull at the ends
 */
export function applyAnalogShaping(
  input: Pick<DeviceInput, "deadzone" | "curve">,
  normalised: number,
): number {
  const dz = input.deadzone ?? 0;
  let v = normalised;
  if (dz > 0 && dz < 1) {
    const mag = Math.abs(v);
    if (mag <= dz) return 0;
    v = Math.sign(v) * ((mag - dz) / (1 - dz));
  }
  return applyCurve(v, input.curve ?? "linear");
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
