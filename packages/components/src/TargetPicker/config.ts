import type { ActionDefinition } from "@ksp-gonogo/core";

// Config is empty: everything comes off the one `target.available` list.
export type TargetPickerConfig = Record<string, never>;

export const targetPickerActions = [
  {
    id: "clear-target",
    label: "Clear target",
    accepts: ["button"],
    description: "Clears the current KSP target.",
  },
] as const satisfies readonly ActionDefinition[];
export type TargetPickerActions = typeof targetPickerActions;
