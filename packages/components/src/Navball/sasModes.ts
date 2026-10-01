import type { SasModeName } from "@ksp-gonogo/sitrep-client";
import { SasMode as SasModeEnum } from "@ksp-gonogo/sitrep-sdk";
import type { MARKER_ICONS } from "@ksp-gonogo/ui-kit";

/**
 * The SAS modes the grid offers a button for: every `SasMode` member except the
 * `Unknown` fallback. The order is the grid's layout only, never the wire
 * ordinal.
 */
export const SAS_MODES: readonly Exclude<SasModeName, "Unknown">[] = [
  "StabilityAssist",
  "Prograde",
  "Retrograde",
  "Normal",
  "Antinormal",
  "RadialIn",
  "RadialOut",
  "Target",
  "AntiTarget",
  "Maneuver",
];
export type SasMode = (typeof SAS_MODES)[number];

/** The navball glyph for each SAS mode that names a direction; StabilityAssist holds the current attitude and has none. */
export const SAS_MODE_MARKERS: Partial<
  Record<SasMode, keyof typeof MARKER_ICONS>
> = {
  Prograde: "prograde",
  Retrograde: "retrograde",
  Normal: "normal",
  Antinormal: "antiNormal",
  RadialIn: "radialIn",
  RadialOut: "radialOut",
  Target: "target",
  AntiTarget: "antiTarget",
  Maneuver: "maneuver",
};

/** The wire ordinal for one SAS mode, from the generated enum rather than the layout order of {@link SAS_MODES}. */
export function sasModeOrdinal(mode: SasMode): number {
  return SasModeEnum[mode];
}

export function modeShort(mode: SasMode): string {
  switch (mode) {
    case "StabilityAssist":
      return "SAS";
    case "Prograde":
      return "PRO";
    case "Retrograde":
      return "RET";
    case "Normal":
      return "NOR";
    case "Antinormal":
      return "ANT";
    case "RadialIn":
      return "RIN";
    case "RadialOut":
      return "ROU";
    case "Target":
      return "TGT";
    case "AntiTarget":
      return "ATG";
    case "Maneuver":
      return "MNV";
  }
}

/**
 * The SAS toggle's mode token, the same three letters as the mode grid. Stability
 * assist is the plain on-state, so it has no token and the toggle reads "SAS ON".
 * `Unknown` keeps its name, since a "?" would look like a rendering fault.
 */
export function badgeSasMode(mode: SasModeName): string {
  if (mode === "StabilityAssist") return "";
  return mode === "Unknown" ? mode : modeShort(mode);
}
