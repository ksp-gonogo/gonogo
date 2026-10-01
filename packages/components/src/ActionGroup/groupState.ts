import type { ActionGroup } from "@ksp-gonogo/core";
import { resolveGroupValue } from "@ksp-gonogo/core";

type ControlReading = {
  state: string;
  value?: Parameters<typeof resolveGroupValue>[1];
};

/** The two facts about a group's state that the toggle's availability turns on. */
export interface GroupState {
  value: unknown;
  /** The state was withheld because its reading is held, not because it never came. */
  valueHeld: boolean;
  /** A current payload named this group and could not say whether it is engaged. */
  stateUnreadable: boolean;
}

/**
 * Whether a group is ON is never held: the toggle inverts it to build its args,
 * so a held value would command the wrong way. `controlReading` is `vessel.control`.
 */
export function groupStateOf(
  group: ActionGroup | undefined,
  controlReading: ControlReading,
): GroupState {
  const valueHeld = controlReading.state === "held";
  const observed =
    controlReading.state === "observed" ? controlReading.value : undefined;
  const value = resolveGroupValue(group, observed);
  // An `assumed` group (never reported by the backend) is excluded: it has its own reason line.
  const stateUnreadable =
    observed !== undefined &&
    group !== undefined &&
    group.provenance !== "assumed" &&
    value == null;
  return { value, valueHeld, stateUnreadable };
}
