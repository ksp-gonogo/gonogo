import type { Value as Quantity } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";

type Quantityish<U extends string> = Quantity<U> | number | null | undefined;

/** The four stage fields the rocket-equation solve needs, structural so tests can pass a literal; `NaN` for a field the wire did not carry. */
interface StageLike {
  deltaVActual: number;
  deltaVVac: number;
  startMass: number;
  endMass: number;
}

/**
 * Active-engine burn parameters for the suicide-burn solve: effective exhaust velocity `ve` (Isp * g0) and burnout mass.
 *
 * Prefers the ACTIVE stage's `DELTA_V_BUDGET` row, since those engines fly the burn; the whole-vessel total averages engines of different Isp. Falls back to `dv.summary` plus `propulsion.dryMass` only without per-stage data (exact for a single-stage lander), and returns `{}` when nothing usable is on the wire.
 */
export function deriveActiveBurnParams(
  active: StageLike | null | undefined,
  propulsion:
    | { totalMass?: Quantityish<"t">; dryMass?: Quantityish<"t"> }
    | undefined,
  totalDvActual: number | undefined,
  totalDvVac: number | undefined,
): { exhaustVelocity?: number; burnoutMass?: number } {
  if (active) {
    const dv = Number.isFinite(active.deltaVActual)
      ? active.deltaVActual
      : active.deltaVVac;
    const { startMass, endMass } = active;
    if (
      Number.isFinite(dv) &&
      dv > 0 &&
      Number.isFinite(startMass) &&
      Number.isFinite(endMass) &&
      startMass > endMass &&
      endMass > 0
    ) {
      return {
        exhaustVelocity: dv / Math.log(startMass / endMass),
        burnoutMass: endMass,
      };
    }
  }
  const dv = totalDvActual ?? totalDvVac;
  const totalMass = magnitudeOf(propulsion?.totalMass);
  const dryMass = magnitudeOf(propulsion?.dryMass);
  if (
    dv != null &&
    Number.isFinite(dv) &&
    dv > 0 &&
    totalMass != null &&
    dryMass != null &&
    totalMass > dryMass &&
    dryMass > 0
  ) {
    return {
      exhaustVelocity: dv / Math.log(totalMass / dryMass),
      burnoutMass: dryMass,
    };
  }
  return {};
}
