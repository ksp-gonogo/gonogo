import type { ActionGroupId } from "@ksp-gonogo/core";

/**
 * The context ActionGroup's augment slot passes to its augments.
 *
 * ActionGroup is a single-group control, so the slot carries the identity and
 * live readout of the ONE group this instance drives. An augment reads
 * `groupId` to describe what that group toggles ("AG3 is the radiators"), and
 * may reflect `value` / `stateLabel` if it wants to.
 */
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

/**
 * Co-located with the widget rather than in a central file, so parallel slot
 * work on other widgets cannot collide in one shared declaration.
 */
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "action-group.subsystem": ActionGroupSlotContext;
  }
}
