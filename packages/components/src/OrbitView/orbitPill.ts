import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

/** The tooltip of a verdict that waits on the parent body's data. */
export const WAITING_FOR_BODY = "Waiting for body data";

export interface OrbitPill {
  label: string;
  tone: Tone;
  /** What the pill is waiting for, on its tooltip. */
  title?: string;
}

/** The orbit's regime as a status pill; at 3x3 the multi-word labels wrap, so `compact` uses the mission-control abbreviations. */
export function orbitPill(
  hasOrbit: boolean,
  escaping: boolean,
  isOrbiting: boolean | null,
  compact: boolean,
): OrbitPill {
  if (!hasOrbit) return { label: NULL_DISPLAY, tone: "neutral" };
  if (escaping) return { label: compact ? "ESC" : "Escape", tone: "warn" };
  // Orbiting or sub-orbital turns on the atmosphere's height, which has yet to arrive.
  if (isOrbiting === null) {
    return { label: NULL_DISPLAY, tone: "neutral", title: WAITING_FOR_BODY };
  }
  if (isOrbiting)
    return { label: compact ? "ORBIT" : "Stable orbit", tone: "go" };
  return { label: compact ? "SUB-O" : "Sub-orbital", tone: "nogo" };
}
