import type { ActionDefinition } from "@ksp-gonogo/sitrep-sdk";

export const rotorActions = [
  {
    id: "rpm-up",
    label: "RPM up",
    accepts: ["button"],
    description: "Raise the selected rotor's RPM cap.",
  },
  {
    id: "rpm-down",
    label: "RPM down",
    accepts: ["button"],
    description: "Lower the selected rotor's RPM cap.",
  },
  {
    id: "toggle-motor",
    label: "Toggle motor",
    accepts: ["button"],
    description: "Engage / disengage the selected rotor's motor.",
  },
  {
    id: "toggle-lock",
    label: "Toggle lock",
    accepts: ["button"],
    description: "Lock / unlock the selected rotor.",
  },
  {
    id: "reverse",
    label: "Reverse",
    accepts: ["button"],
    description: "Flip the selected rotor's spin direction.",
  },
] as const satisfies readonly ActionDefinition[];

export type RotorTachometerActions = typeof rotorActions;
