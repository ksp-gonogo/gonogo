export type PresetId =
  | "circularize-apo"
  | "circularize-peri"
  | "custom-apo"
  | "custom-peri"
  | "custom-ut"
  | "hohmann-to-altitude"
  | "hohmann-rendezvous-target"
  | "match-inclination"
  | "match-target-inclination"
  | "match-target-plane";

export interface ManeuverPlannerConfig {
  defaultPreset?: PresetId;
  /** Default standoff distance (m) for hohmann-rendezvous-target. */
  defaultStandoffMeters?: number;
}

// Telemachus occasionally sends null / NaN for an orbit value that KSP
// hasn't computed yet (landed vessel, fresh scene load). Treat those as
// "not yet arrived" rather than propagating them into the math.
export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export const PRESETS: Array<{
  id: PresetId;
  label: string;
  description: string;
  needsCustomInput: boolean;
}> = [
  {
    id: "circularize-apo",
    label: "Circularise at Apoapsis",
    description: "Prograde burn at apo to flatten eccentricity.",
    needsCustomInput: false,
  },
  {
    id: "circularize-peri",
    label: "Circularise at Periapsis",
    description: "Brake at peri to flatten eccentricity.",
    needsCustomInput: false,
  },
  {
    id: "custom-apo",
    label: "Custom burn at Apoapsis",
    description: "Set your own prograde / normal / radial ΔV at next apo.",
    needsCustomInput: true,
  },
  {
    id: "custom-peri",
    label: "Custom burn at Periapsis",
    description: "Set your own prograde / normal / radial ΔV at next peri.",
    needsCustomInput: true,
  },
  {
    id: "custom-ut",
    label: "Custom burn at UT",
    description:
      "Schedule a ΔV at an arbitrary time from now. Projection reflects real flight-path angle at the burn point.",
    needsCustomInput: true,
  },
  {
    id: "hohmann-to-altitude",
    label: "Hohmann to altitude",
    description:
      "Two-burn transfer to a circular orbit at the given altitude. Burn 1 at the closer apsis, burn 2 half a transfer period later.",
    needsCustomInput: true,
  },
  {
    id: "hohmann-rendezvous-target",
    label: "Hohmann rendezvous (target)",
    description:
      "Two- or three-burn rendezvous with the selected target. Auto-prepends a plane match if mismatch > 0.5°. Rendezvous radius = target periapsis. Standoff offsets the meeting point along-track on the target's orbit.",
    needsCustomInput: true,
  },
  {
    id: "match-inclination",
    label: "Match inclination",
    description:
      "Rotate the orbital plane to a target inclination at the next AN / DN.",
    needsCustomInput: true,
  },
  {
    id: "match-target-inclination",
    label: "Match target inclination",
    description:
      "Rotate to match the current target's inclination. Needs a target selected in-game.",
    needsCustomInput: false,
  },
  {
    id: "match-target-plane",
    label: "Match target plane",
    description:
      "Full plane match — both inclination and LAN — at the relative-plane intersection. Needs a target.",
    needsCustomInput: false,
  },
];
