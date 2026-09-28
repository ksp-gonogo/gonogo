import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";

export interface OrbitPill {
  label: string;
  tone: Tone;
}

/** The orbit's regime as a status pill; at 3x3 the multi-word labels wrap, so `compact` uses the mission-control abbreviations. */
export function orbitPill(
  hasOrbit: boolean,
  escaping: boolean,
  isOrbiting: boolean,
  compact: boolean,
): OrbitPill {
  if (!hasOrbit) return { label: NULL_DISPLAY, tone: "neutral" };
  if (escaping) return { label: compact ? "ESC" : "Escape", tone: "warn" };
  if (isOrbiting)
    return { label: compact ? "ORBIT" : "Stable orbit", tone: "go" };
  return { label: compact ? "SUB-O" : "Sub-orbital", tone: "nogo" };
}
