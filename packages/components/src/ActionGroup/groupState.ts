import type { ActionGroup } from "@ksp-gonogo/core";
import { resolveGroupValue } from "@ksp-gonogo/core";

type ControlReading = {
  state: string;
  grade?: string;
  value?: Parameters<typeof resolveGroupValue>[1];
};

/** The two facts about a group's state that the toggle's availability turns on. */
export interface GroupState {
  value: unknown;
  /** The state was withheld because its reading is held, not because it never came. */
  valueHeld: boolean;
  /** The value shown is the last one received, its updates running late while the link stays up. */
  valueLate: boolean;
  /** A current payload named this group and could not say whether it is engaged. */
  stateUnreadable: boolean;
}

/**
 * A reading whose own updates are late, with the link and the game both up, keeps
 * its last value so the toggle survives the gap between two readings; the
 * value is marked late. Every other held grade (disconnected, loading, no game,
 * blackout, recorded) withholds it, since nothing says it still holds and the
 * toggle inverts it to build its args. `controlReading` is `vessel.control`.
 */
export function groupStateOf(
  group: ActionGroup | undefined,
  controlReading: ControlReading,
): GroupState {
  const held = controlReading.state === "held";
  const valueLate = held && controlReading.grade === "held";
  const valueHeld = held && !valueLate;
  const observed =
    controlReading.state === "observed" || valueLate
      ? controlReading.value
      : undefined;
  const value = resolveGroupValue(group, observed);
  // An `assumed` group (never reported by the backend) is excluded: it has its own reason line.
  const stateUnreadable =
    observed !== undefined &&
    group !== undefined &&
    group.provenance !== "assumed" &&
    value == null;
  return { value, valueHeld, valueLate, stateUnreadable };
}
