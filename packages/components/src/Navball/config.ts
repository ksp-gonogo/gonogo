import type { ActionDefinition } from "@ksp-gonogo/core";

export interface NavballConfig {
  /** When true, read the CoM-referenced attitude frame (`heading`/`pitch`/`roll`); by default the root-part frame (`*RootFrame`). */
  useCoMFrame?: boolean;
  /** When true, render the control surface; otherwise show display-only. */
  controlMode?: boolean;
}

/** One action per axis and mode so each maps to its own input; ordered like the visible button rows. */
export const navballActions = [
  {
    id: "take-control",
    label: "Toggle control mode",
    accepts: ["button"],
    description:
      "Switches the widget between showing the controls and display only.",
  },
  {
    id: "arm-fbw",
    label: "Arm fly-by-wire (FBW)",
    accepts: ["button"],
    description:
      "Hands the vessel's pitch, yaw and roll to the widget's fly-by-wire override.",
  },
  {
    id: "disarm-fbw",
    label: "Disarm fly-by-wire (FBW)",
    accepts: ["button"],
    description:
      "Returns the vessel's pitch, yaw and roll to the game's own control.",
  },
  {
    id: "toggle-sas",
    label: "Toggle SAS",
    accepts: ["button"],
    description: "Turns SAS (the stability assist system) on or off.",
  },
  {
    id: "toggle-rcs",
    label: "Toggle RCS",
    accepts: ["button"],
    description: "Turns RCS (the reaction control thrusters) on or off.",
  },
  {
    id: "toggle-precision",
    label: "Toggle precision",
    accepts: ["button"],
    description:
      "Reserved for precision control; it does nothing, as the game has no command to set it.",
  },
  {
    id: "kill-rotation",
    label: "Kill rotation (SAS)",
    accepts: ["button"],
    description:
      "Turns SAS on and selects stability assist, which holds the vessel's current rotation still.",
  },
  {
    id: "sas-stability",
    label: "SAS: Stability",
    accepts: ["button"],
    description:
      "Selects the SAS stability assist mode, which holds the current attitude.",
  },
  {
    id: "sas-prograde",
    label: "SAS: Prograde",
    accepts: ["button"],
    description:
      "Selects the SAS mode that points along the direction of travel.",
  },
  {
    id: "sas-retrograde",
    label: "SAS: Retrograde",
    accepts: ["button"],
    description:
      "Selects the SAS mode that points against the direction of travel.",
  },
  {
    id: "sas-normal",
    label: "SAS: Normal",
    accepts: ["button"],
    description:
      "Selects the SAS mode that points perpendicular to the orbit plane, along its north side.",
  },
  {
    id: "sas-antinormal",
    label: "SAS: Anti-normal",
    accepts: ["button"],
    description:
      "Selects the SAS mode that points perpendicular to the orbit plane, along its south side.",
  },
  {
    id: "sas-radial-in",
    label: "SAS: Radial in",
    accepts: ["button"],
    description:
      "Selects the SAS mode that points toward the body being orbited.",
  },
  {
    id: "sas-radial-out",
    label: "SAS: Radial out",
    accepts: ["button"],
    description:
      "Selects the SAS mode that points away from the body being orbited.",
  },
  {
    id: "sas-target",
    label: "SAS: Target",
    accepts: ["button"],
    description: "Selects the SAS mode that points at the current target.",
  },
  {
    id: "sas-anti-target",
    label: "SAS: Anti-target",
    accepts: ["button"],
    description:
      "Selects the SAS mode that points away from the current target.",
  },
  {
    id: "sas-maneuver",
    label: "SAS: Maneuver",
    accepts: ["button"],
    description:
      "Selects the SAS mode that points along the next maneuver node's burn.",
  },
  {
    id: "set-throttle",
    label: "Set throttle",
    accepts: ["analog"],
    description: "Sets the throttle from an analog input, from none to full.",
  },
  {
    id: "throttle-up",
    label: "Throttle up 10%",
    accepts: ["button"],
    description: "Raises the throttle by 10%.",
  },
  {
    id: "throttle-down",
    label: "Throttle down 10%",
    accepts: ["button"],
    description: "Lowers the throttle by 10%.",
  },
  {
    id: "throttle-zero",
    label: "Throttle zero",
    accepts: ["button"],
    description: "Sets the throttle to none.",
  },
  {
    id: "throttle-full",
    label: "Throttle full",
    accepts: ["button"],
    description: "Sets the throttle to full.",
  },
  {
    id: "set-pitch",
    label: "Pitch axis",
    accepts: ["analog"],
    description: "Sets the pitch command from an analog input.",
  },
  {
    id: "set-yaw",
    label: "Yaw axis",
    accepts: ["analog"],
    description: "Sets the yaw command from an analog input.",
  },
  {
    id: "set-roll",
    label: "Roll axis",
    accepts: ["analog"],
    description: "Sets the roll command from an analog input.",
  },
  {
    id: "translate-x",
    label: "RCS X",
    accepts: ["analog"],
    description:
      "Sets RCS translation along the vessel's X axis from an analog input.",
  },
  {
    id: "translate-y",
    label: "RCS Y",
    accepts: ["analog"],
    description:
      "Sets RCS translation along the vessel's Y axis from an analog input.",
  },
  {
    id: "translate-z",
    label: "RCS Z",
    accepts: ["analog"],
    description:
      "Sets RCS translation along the vessel's Z axis from an analog input.",
  },
  {
    id: "set-pitch-trim",
    label: "Pitch trim",
    accepts: ["analog"],
    description: "Sets the pitch trim from an analog input.",
  },
  {
    id: "set-yaw-trim",
    label: "Yaw trim",
    accepts: ["analog"],
    description: "Sets the yaw trim from an analog input.",
  },
  {
    id: "set-roll-trim",
    label: "Roll trim",
    accepts: ["analog"],
    description: "Sets the roll trim from an analog input.",
  },
] as const satisfies readonly ActionDefinition[];

export type NavballActions = typeof navballActions;
