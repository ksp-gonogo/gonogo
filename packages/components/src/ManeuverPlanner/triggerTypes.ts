import type { PresetId } from "./presets";

/** Comparison operator for an armed-trigger's threshold. Mirrors the
 *  alarms module's `ThresholdOp` so the operator set stays consistent
 *  across both surfaces. */
export type ThresholdOp = ">" | ">=" | "<" | "<=" | "==" | "!=";

export const THRESHOLD_OPS: ThresholdOp[] = [">", ">=", "<", "<=", "==", "!="];

export function compareThreshold(
  value: number,
  op: ThresholdOp,
  threshold: number,
): boolean {
  switch (op) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
    case "!=":
      return value !== threshold;
  }
}

/** User-input fields captured at arm time. Live orbit data is *not* frozen —
 *  the trigger fires "compute the burn against current orbit when the
 *  condition holds", which requires fresh `currentOrbit` / `mu` / etc. */
export interface FrozenPlanInputs {
  preset: PresetId;
  prograde: number;
  normal: number;
  radial: number;
  burnInSeconds: number;
  utMode: "relative" | "absolute";
  burnAtUT: number;
  targetInclination: number;
  targetAltitudeKm: number;
  standoffMeters: number;
}

export interface ArmedTrigger {
  id: string;
  /** Telemachus key whose value drives the comparison (e.g. `o.ApA`). */
  dataKey: string;
  op: ThresholdOp;
  value: number;
  inputs: FrozenPlanInputs;
  /** Vessel name at arm time. Triggers auto-clear when the active vessel
   *  changes — a circularize armed for vessel A shouldn't fire on vessel B. */
  vesselName: string | null;
  /** Wall-clock ms when armed. */
  createdAt: number;
  /** "main" or peer id of the screen that armed it. */
  createdBy: string;
}
