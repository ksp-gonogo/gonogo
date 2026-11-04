import type { ActionGroup } from "@ksp-gonogo/core";
import {
  buildToggleArgs,
  TOGGLE_INVALID,
  toggleCommandFor,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useCommand } from "@ksp-gonogo/sitrep-client";
import {
  type CapabilityWarning,
  useCommandCapabilityWarning,
} from "../shared/commandCapability";
import {
  ALL_CONFIRMATION_WORDS,
  confirmationSentenceOf,
  confirmationWordOf,
  pressOutstanding,
  shownToggleState,
  showsToggle,
  type ToggleConfirmation,
  useToggleConfirmation,
} from "../shared/toggleConfirmation";
import { useAskedToggle } from "../shared/useAskedToggle";
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
  /** What the craft lacks that this group's command needs, from its last control reading; the press still sends. */
  capabilityWarning: CapabilityWarning | null;
  /** The stream to the mod is down, so the press sends nothing. */
  streamDown: boolean;
  press: () => void;
  /**
   * `sent` while the mod has not yet answered the latest press from here,
   * `held` while a command for this group from anyone at the command centre
   * waits at a relay, `modelled` while one is predicted to have reached the
   * craft and its reply is on its way back, else null.
   */
  confirmation: ToggleConfirmation | null;
  /** The word the button shows: `SENT` until the mod answers the press, else the state. */
  buttonWord: string;
  /** Every word the button can show, which it is sized to hold so it keeps its size as the word changes. */
  buttonWords: readonly string[];
  /** What the press is waiting on, as a sentence for the tooltip and for a screen reader; null when nothing is outstanding. */
  confirmationSentence: string | null;
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
    linkReading.state === "observed"
      ? (linkReading.value.connected ?? undefined)
      : undefined;

  const toggleCommand = group ? toggleCommandFor(group) : null;
  // A held reading is the state from before the blackout, so it confirms nothing.
  const toggleCmd = useCommand(toggleCommand ?? "", {
    confirmedBy: (args) => !valueHeld && showsToggle(args, value),
  });
  const capabilityWarning = useCommandCapabilityWarning(toggleCommand);

  // A held reading with no value for this group has nothing to send the opposite of.
  const unreadable = stateUnreadable || (valueHeld && value == null);

  const sendLabel = `Toggle ${label}`;
  // Every action group shares one command, so a row is this group's by the label it was sent under.
  const confirmation = useToggleConfirmation(toggleCmd, (row) =>
    toggleCommand === "vessel.control.setActionGroup"
      ? row.label === sendLabel
      : true,
  );
  // The state the button shows: a predicted one while the command is modelled to have arrived.
  const shown = shownToggleState(value, confirmation);
  const ask = useAskedToggle(pressOutstanding(toggleCmd), shown);

  const press = () => {
    if (!group?.toggle || !toggleCommand || toggleCmd.streamDown) return;
    const args = buildToggleArgs(group, ask.base);
    if (args === TOGGLE_INVALID) return;
    ask.asked(args);
    void toggleCmd.send(args, { label: sendLabel });
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

  const stateLabel = stateLabelOf(shown);
  const buttonWord = confirmationWordOf(confirmation) ?? stateLabel;
  const confirmationSentence = confirmationSentenceOf(label, confirmation);

  return {
    // Some groups, Stage among them, report a number rather than a boolean.
    isOn: typeof shown === "number" ? shown > 0 : shown === true,
    stateLabel,
    buttonWord,
    buttonWords: ["ON", "OFF", ...ALL_CONFIRMATION_WORDS, stateLabel],
    confirmationSentence,
    // A press that `buildToggleArgs` would refuse is not offered: with no state to invert, an enabled button would do nothing. A held state is one to invert: the command sets the explicit opposite.
    canToggle:
      Boolean(group?.toggle) &&
      !toggleCmd.streamDown &&
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
    capabilityWarning,
    streamDown: toggleCmd.streamDown,
    press,
    confirmation,
  };
}
