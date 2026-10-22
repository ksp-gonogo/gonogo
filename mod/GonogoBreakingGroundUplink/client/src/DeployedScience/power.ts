import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { DeployedStation } from "./parseStation";

type PowerState = "powered" | "unpowered" | "unknown";

export function powerState(station: DeployedStation): PowerState {
  if (station.powered === null) return "unknown";
  return station.powered ? "powered" : "unpowered";
}

export const POWER_LABEL: Record<PowerState, string> = {
  powered: "Powered",
  unpowered: "Unpowered",
  unknown: "Power unknown",
};

export const POWER_TONE: Record<PowerState, Tone> = {
  powered: "go",
  unpowered: "nogo",
  // Neutral, not `nogo`: a red pill is a verdict, and there is none here.
  unknown: "neutral",
};

/** The produced-over-required power balance, or null unless both sides arrived. */
export function powerBalance(station: DeployedStation): string | null {
  const { powerAvailable, powerRequired } = station;
  if (powerAvailable === null || powerRequired === null) return null;
  return `Power ${Math.round(powerAvailable)}/${Math.round(powerRequired)}`;
}
