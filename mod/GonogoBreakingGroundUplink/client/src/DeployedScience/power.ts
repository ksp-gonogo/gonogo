import type { StatusTone } from "@ksp-gonogo/ui-kit";
import type { DeployedBase } from "./parseBases";

type PowerState = "powered" | "unpowered" | "unknown";

export function powerState(base: DeployedBase): PowerState {
  if (base.powered === null) return "unknown";
  return base.powered ? "powered" : "unpowered";
}

export const POWER_LABEL: Record<PowerState, string> = {
  powered: "Powered",
  unpowered: "Unpowered",
  unknown: "Power unknown",
};

export const POWER_TONE: Record<PowerState, StatusTone> = {
  powered: "go",
  unpowered: "nogo",
  // Neutral, not `nogo`: a red pill is a verdict, and there is none here.
  unknown: "neutral",
};

/** The produced-over-required power balance, or null unless both sides arrived. */
export function powerBalance(base: DeployedBase): string | null {
  const { powerAvailable, powerRequired } = base;
  if (powerAvailable === null || powerRequired === null) return null;
  return `Power ${Math.round(powerAvailable)}/${Math.round(powerRequired)}`;
}
