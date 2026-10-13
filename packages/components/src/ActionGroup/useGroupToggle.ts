import type { ActionGroup } from "@ksp-gonogo/core";
import {
  buildToggleArgs,
  TOGGLE_INVALID,
  toggleCommandFor,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import type { ActionGroupActions } from "./config";
import {
  stateLabelOf,
  type UnavailableReason,
  unavailableReasonOf,
} from "./toggleAvailability";

export interface GroupToggleInput {
  group: ActionGroup | undefined;
  value: unknown;
  /** The state is the last one received while its reading is withheld: drawn held, and a press sends the explicit opposite of it. */
  valueHeld: boolean;
  /** A current payload named this group and could not say whether it is engaged. */
  stateUnreadable: boolean;
  /** The name the command is sent under and the button is labelled with. */
  label: string;
}

export interface GroupToggle {
  isOn: boolean;
  stateLabel: string;
  /** Whether a press does anything: `buildToggleArgs` would refuse it otherwise. */
  canToggle: boolean;
  unavailableReason: UnavailableReason | null;
  press: () => void;
}

/**
 * The group's delay-aware toggle command and its serial and keyboard binding,
 * shared by the full body and the tiny form so the button and its inputs behave
 * the same at every size.
 */
export function useGroupToggle({
  group,
  value,
  valueHeld,
  stateUnreadable,
  label,
}: GroupToggleInput): GroupToggle {
  // Paused and no-signal are claims about now, so neither is answered from a held reading.
  const warpReading = useTelemetry("time.warp");
  const isPaused =
    warpReading.state === "observed" ? warpReading.value.paused : undefined;
  const linkReading = useTelemetry("comms.link");
  const commConnected =
    linkReading.state === "observed" ? linkReading.value.connected : undefined;

  const toggleCommand = group ? toggleCommandFor(group) : null;
  const toggleCmd = useCommand(toggleCommand ?? "");

  // A held reading with no value for this group has nothing to send the opposite of.
  const unreadable = stateUnreadable || (valueHeld && value == null);

  const press = () => {
    if (!group?.toggle || !toggleCommand) return;
    const args = buildToggleArgs(group, value);
    if (args === TOGGLE_INVALID) return;
    void toggleCmd.send(args, { label: `Toggle ${label}` });
  };

  useActionInput<ActionGroupActions>({
    toggle: (payload) => {
      if (!group) return undefined;
      // Press edge only, so one tap is one toggle.
      if (payload.kind === "button" && payload.value !== true) return undefined;
      press();
      return { [group.name]: value !== true };
    },
  });

  return {
    // Some groups, Stage among them, report a number rather than a boolean.
    isOn: typeof value === "number" ? value > 0 : value === true,
    stateLabel: stateLabelOf(value),
    // A press that `buildToggleArgs` would refuse is not offered: with no state to invert, an enabled button would do nothing. A held state is one to invert: the command sets the explicit opposite.
    canToggle:
      Boolean(group?.toggle) &&
      !unreadable &&
      buildToggleArgs(group as ActionGroup, value) !== TOGGLE_INVALID,
    unavailableReason: group
      ? unavailableReasonOf({
          stateUnreadable: unreadable,
          isPaused,
          commConnected,
          provenance: group.provenance,
        })
      : null,
    press,
  };
}
