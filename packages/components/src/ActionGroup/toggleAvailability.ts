import type { ActionGroup } from "@ksp-gonogo/core";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

export type UnavailableReason =
  | "State not current"
  | "State unreadable"
  | "Paused"
  | "No signal"
  | "Not reported";

export const UNAVAILABLE_TITLES: Record<UnavailableReason, string> = {
  "State not current":
    "The last known state is too old to invert, so the toggle is held",
  "State unreadable":
    "The backend reported this group but could not read whether it is engaged, so the toggle is held",
  Paused: "The action group can't fire right now",
  "No signal": "The action group can't fire right now",
  "Not reported":
    "Configured, but no backend has reported this group, so its state is unknown",
};

/** In precedence order; "Not reported" is last because it alone does not stop the press. */
export function unavailableReasonOf({
  valueNotCurrent,
  stateUnreadable,
  isPaused,
  commConnected,
  provenance,
}: {
  valueNotCurrent: boolean;
  stateUnreadable: boolean;
  isPaused: boolean | undefined;
  commConnected: boolean | undefined;
  provenance: ActionGroup["provenance"];
}): UnavailableReason | null {
  if (valueNotCurrent) return "State not current";
  if (stateUnreadable) return "State unreadable";
  if (isPaused === true) return "Paused";
  if (commConnected === false) return "No signal";
  if (provenance === "assumed") return "Not reported";
  return null;
}

export function stateLabelOf(value: unknown): string {
  // `null` (reported, unreadable) and `undefined` (never arrived) are both unknown, never OFF.
  if (value == null) return NULL_DISPLAY;
  if (typeof value === "number") return String(value);
  return value === true ? "ON" : "OFF";
}
