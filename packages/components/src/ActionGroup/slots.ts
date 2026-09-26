import type { ActionGroupId } from "@ksp-gonogo/core";

/** The context ActionGroup's augment slot passes: the one group this instance drives, and its readout. */
export interface ActionGroupSlotContext {
  /** The KSP action group this instance controls (e.g. "AG1", "SAS", "Gear"). */
  groupId: ActionGroupId;
  /** The display label: custom override or the official group name. */
  label: string;
  /** The group's current Value (boolean or numeric readout); `undefined` if unknown. */
  value: unknown;
  /** Rendered state readout: "ON" / "OFF" / a numeric string / NULL_DISPLAY. */
  stateLabel: string;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "action-group.subsystem": ActionGroupSlotContext;
  }
}
