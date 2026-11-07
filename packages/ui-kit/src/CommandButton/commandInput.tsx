import {
  type AnyBoundCommand,
  bindCommand,
  type ValueCommand,
} from "@ksp-gonogo/sitrep-sdk";
import { useRailAnnounces } from "../CommandDelay/railAnnouncer";
import { describeSendStatus } from "../SendStatus/describeSendStatus";
import { predictedOutcomeOf } from "../SendStatus/predictedOutcome";
import {
  type BoundControlCommand,
  type CommandControlState,
  FOUND_WORD,
  LOST_WORD,
  REFUSED_WORD,
  SENT_WORD,
  STREAM_DOWN_TIP,
  useCommandControl,
} from "./commandControl";

/** The data attributes a command input wears so its edge shows what became of the command. */
export interface CommandEdgeAttributes {
  "data-command-edge"?: "warn" | "blocked";
  "data-command-phase": string;
  "data-stream"?: "down";
  "data-predicted"?: string;
  "aria-disabled"?: true;
}

/** What {@link useCommandInput} returns: the control, the word and tip to draw, and the attributes that carry the edge. */
export interface CommandInputState<Value> {
  /** The control underneath, for a face that needs a phase this state does not name. */
  control: CommandControlState;
  /** Sends the command with this value, unless the input is inert. */
  send: (value: Value) => void;
  /** The word the input draws in place of its figure while the press is unanswered or lost: "SENT", "Refused", "No reply" or "Found". Null at rest. */
  word: string | null;
  /** What the input says on hover and keyboard focus: the outcome or the reason it cannot be used, else the send status. Undefined when there is nothing to say. */
  tip: string | undefined;
  /** A press sends nothing now: the game will refuse it, the caller said it cannot be used, or the stream is down. */
  inert: boolean;
  /** The attributes that draw the edge. */
  edge: CommandEdgeAttributes;
  /** The outcome sentence for a live region, when this input's own region should speak it. */
  announce: string | null;
}

/**
 * The shared state of every command input other than a button: the phase of the
 * command it sends, the word for it, the tip and the edge. Used by the inputs of
 * the kit that take a `command` prop.
 */
export function useCommandInput<Value>({
  command,
  unavailable,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: a value command of any argument and reply types
  command: ValueCommand<Value, any, any>;
  unavailable?: string | null;
}): CommandInputState<Value> {
  const control = useCommandControl({
    command: {
      kind: "bound",
      handle: command.handle,
      args: undefined,
      options: command.options,
    },
    unavailable,
  });
  const railSpeaks = useRailSpeaks(control);
  const inert =
    control.isBlocked ||
    control.isUnavailable ||
    control.isOffline ||
    unavailable != null;
  return inputState(
    control,
    inert,
    railSpeaks,
    (value) => {
      if (inert) return;
      const args = command.toArgs(value);
      if (args === undefined) return;
      control.pressWith(
        bindCommand(
          command.handle,
          args,
          command.options,
        ) as BoundControlCommand,
      );
    },
    unavailable ?? null,
  );
}

/**
 * The same state for an input that sends a command it already has the arguments
 * of, such as a row or a menu item.
 */
export function useBoundCommandInput({
  command,
  unavailable,
}: {
  command: AnyBoundCommand;
  unavailable?: string | null;
}): CommandInputState<void> {
  const control = useCommandControl({ command, unavailable });
  const railSpeaks = useRailSpeaks(control);
  const inert =
    control.isBlocked ||
    control.isUnavailable ||
    control.isOffline ||
    unavailable != null;
  return inputState(
    control,
    inert,
    railSpeaks,
    () => {
      if (inert) return;
      control.press(false);
    },
    unavailable ?? null,
  );
}

function inputState<Value>(
  control: CommandControlState,
  inert: boolean,
  railSpeaks: boolean,
  send: (value: Value) => void,
  unavailable: string | null,
): CommandInputState<Value> {
  const handle = control.command.handle;
  const gated = control.isBlocked && !control.isUnavailable;
  const word = control.isSent
    ? SENT_WORD
    : control.isRefused
      ? REFUSED_WORD
      : control.isLost
        ? LOST_WORD
        : control.isFound
          ? FOUND_WORD
          : null;
  const sendStatus = handle.sendStatus;
  const restTip =
    sendStatus === undefined ? undefined : describeSendStatus(sendStatus);
  const outcome =
    control.foundText ??
    control.refusalText ??
    (control.isLost ? control.lossText : null);
  const tip =
    outcome ??
    (control.isSent
      ? "Sent, not yet received"
      : control.isOffline
        ? STREAM_DOWN_TIP
        : (unavailable ?? restTip));
  return {
    control,
    send,
    word,
    tip: tip ?? undefined,
    inert,
    edge: {
      "data-command-edge": gated
        ? "blocked"
        : control.isLost ||
            control.isRefused ||
            control.hasUnconfirmed ||
            control.hasFailure
          ? "warn"
          : undefined,
      "data-command-phase": control.phase,
      "data-stream": control.isOffline ? "down" : undefined,
      "data-predicted": gated ? undefined : predictedOutcomeOf(sendStatus),
      "aria-disabled": inert ? true : undefined,
    },
    // A mounted rail that carries this command already speaks what became of it.
    announce: railSpeaks
      ? null
      : (outcome ?? (control.isSent ? "Sent, not yet received" : null)),
  };
}

/** Whether a rail on screen already speaks this input's outcomes, so the input's own region stays quiet. */
export function useRailSpeaks(control: CommandControlState): boolean {
  const mounted = useRailAnnounces();
  return mounted && control.command.handle.railed === true;
}
