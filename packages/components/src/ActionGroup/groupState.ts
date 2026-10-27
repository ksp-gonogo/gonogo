import type { ActionGroup } from "@ksp-gonogo/core";
import { resolveGroupValue } from "@ksp-gonogo/core";

type ControlReading = {
  state: string;
  grade?: string;
  value?: Parameters<typeof resolveGroupValue>[1];
};

/** The facts about a group's state that the toggle's availability and drawing turn on. */
export interface GroupState {
  /** The group's last known state, current or held; undefined when nothing has arrived. */
  value: unknown;
  /** The value is the last one received while its reading is withheld (stream down, game loading, blackout, recording), so it is drawn held and not pressable. */
  valueHeld: boolean;
  /** The value shown is the last one received, its updates running late while the link stays up. */
  valueLate: boolean;
  /** A current payload named this group and could not say whether it is engaged. */
  stateUnreadable: boolean;
}

/**
 * A held reading keeps its last value drawn, so a stream restore or a loading
 * game never blanks the control. When the reading's own updates are late with
 * the link and the game both up, the toggle stays operable (`valueLate`);
 * every other held grade (disconnected, loading, no game, blackout, recorded)
 * keeps the value for display only (`valueHeld`), since nothing says it still
 * holds and the toggle inverts it to build its args. `controlReading` is
 * `vessel.control`.
 */
export function groupStateOf(
  group: ActionGroup | undefined,
  controlReading: ControlReading,
): GroupState {
  const held = controlReading.state === "held";
  const valueLate = held && controlReading.grade === "held";
  const valueHeld = held && !valueLate;
  const carried =
    controlReading.state === "observed" || held
      ? controlReading.value
      : undefined;
  const value = resolveGroupValue(group, carried);
  // An `assumed` group (never reported by the backend) is excluded: it has its own reason line.
  const stateUnreadable =
    !valueHeld &&
    carried !== undefined &&
    group !== undefined &&
    group.provenance !== "assumed" &&
    value == null;
  return { value, valueHeld, valueLate, stateUnreadable };
}
