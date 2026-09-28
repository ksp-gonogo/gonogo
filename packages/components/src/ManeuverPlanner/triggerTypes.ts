import type { CommandRefusalEntry } from "@ksp-gonogo/ui-kit";
import type { PresetId } from "./presets";

/** An armed trigger's comparison, the same set the alarms module's `ThresholdOp` offers. */
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

/** Form inputs frozen at arm time; the burn is computed against the live orbit when the trigger fires. */
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
  /** The key whose value drives the comparison (e.g. `o.ApA`). */
  dataKey: string;
  op: ThresholdOp;
  value: number;
  inputs: FrozenPlanInputs;
  /** Vessel name at arm time; the trigger clears when the active vessel changes. */
  vesselName: string | null;
  /** Wall-clock ms when armed. */
  createdAt: number;
  /** "main" or peer id of the screen that armed it. */
  createdBy: string;
  /**
   * The burns the command refused when this trigger fired. Present only on a
   * fired trigger whose command said no; such a trigger never fires again and
   * stays listed until the operator dismisses it.
   */
  refusals?: readonly CommandRefusalEntry[];
}
