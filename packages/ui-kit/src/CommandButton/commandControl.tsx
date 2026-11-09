import {
  argsOf,
  type BoundCommand,
  type BoundCommandOptions,
  bindCommand,
  CommandErrorCode,
  type CommandStatus,
  classifyCommandRejection,
  runSet,
  type SendStatus,
  type UseCommandResult,
  type ValueCommand,
} from "@ksp-gonogo/sitrep-sdk";
import { useWireTimelineEpoch } from "@ksp-gonogo/sitrep-sdk/spine";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** How long a confirmed press keeps showing the state it asked for while the reading has not yet moved. */
const CONFIRMED_STATE_HOLD_MS = 5000;

import styled, { css, keyframes } from "styled-components";
import { Button__Body, type ButtonTone } from "../Button";
import type { CommandDelayHandle } from "../CommandDelay/CommandDelay";
import {
  type CommandFoundLike,
  commandFoundSentence,
} from "../CommandDelay/commandFoundSentence";
import { commandLossSentence } from "../CommandDelay/commandLossSentence";
import { commandOutcomes } from "../CommandDelay/commandOutcomes";
import {
  type CommandRefusalLike,
  commandAdviceSentence,
  commandGateSentence,
  commandRefusalSentence,
} from "../CommandDelay/commandRefusalSentence";
import { useRailAnnounces } from "../CommandDelay/railAnnouncer";
import { FitLabel } from "../FitLabelButton";
import { LiveRegion } from "../LiveRegion";
import { ReservedText } from "../ReservedText";
import type { ReckoningMarking } from "../readingCurrency";
import { describeSendStatus } from "../SendStatus/describeSendStatus";
import { predictedOutcomeOf } from "../SendStatus/predictedOutcome";
import { ToggleButton } from "../ToggleButton";
import { Tooltip } from "../Tooltip";
import {
  askedToggleValue,
  type CommandToggle,
  confirmationSentenceOf,
  pressOutstanding,
  shownToggleState,
  type ToggleState,
  toggleConfirmationOf,
  toggleMarking,
} from "./toggle";

/** The dispatch's args as text, for telling whether an armed control is still pointed at what was armed; `null` for args that cannot be written. */
function argsKey(args: unknown): string | null {
  try {
    return JSON.stringify(args) ?? "";
  } catch {
    return null;
  }
}

/**
 * The words a command control shows as its tip while the stream to the mod is
 * down: that nothing can be sent. Useful for telling the operator why a command
 * control is dimmed with a dotted edge, and for a control of your own that follows the same
 * state. Used by {@link Button} and by the Action Group widget's toggle.
 *
 * @category CommandButton
 */
export const STREAM_DOWN_TIP = "Not connected to the mod. Nothing can be sent";

/**
 * How long, in milliseconds, an armed {@link Button} waits for its
 * confirming press before it returns to rest. Used by {@link Button} and
 * {@link useCommandControl}.
 *
 * @category CommandButton
 */
export const ARM_TIMEOUT_MS = 4000;

/**
 * How long, in milliseconds, a refusal stays on a command control before the
 * control returns to rest. Used by {@link Button} and
 * {@link useCommandControl}.
 *
 * @category CommandButton
 */
export const REFUSAL_TIMEOUT_MS = 8000;

/**
 * The fewest milliseconds a {@link Button} reads "SENT" after a press,
 * so the press is seen to have gone however soon the mod answers it. Used by
 * {@link Button}, {@link useCommandControl} and the toggles of the
 * Navball and Action Group widgets.
 *
 * @category CommandButton
 */
export const SENT_FLASH_MS = 500;
export type {
  CommandToggle,
  ToggleState,
} from "./toggle";

/**
 * A command bound to arguments, as a control reads it: the handle it dispatches
 * on is the kit's structural handle.
 *
 * @category CommandButton
 */
// biome-ignore lint/suspicious/noExplicitAny: a command of any reply type
export type BoundControlCommand<Args = unknown, Result = any> = BoundCommand<
  Args,
  Result,
  CommandButtonHandle<Result, Args>
>;

/** The word a command control shows while the mod has not answered the press. */
export const SENT_WORD = "SENT";

/** The word a command control shows once the game has refused the press. */
export const REFUSED_WORD = "Refused";

/** The word a command control shows when no reply came to the press. */
export const LOST_WORD = "No reply";

/** The word a command control shows when a command it lost has since replied. */
export const FOUND_WORD = "Found";

/**
 * What the mod says about a command before it is pressed: whether the game would
 * refuse it. Useful for darkening a control the operator cannot usefully press
 * and saying why. Declared structurally; `useCommand`'s `gate` satisfies it.
 * Read by {@link Button} through {@link CommandButtonHandle}.
 *
 * @category CommandButton
 */
export interface CommandGateLike extends CommandRefusalLike {
  /** The game evaluated this and said no. */
  blocked: boolean;
  /**
   * The mod could not evaluate this command's gates (the checks it runs
   * before a command is pressed) at all, as in a sandbox save, which has no
   * career to check against. The control is drawn as ordinary, not darkened, and carries
   * `data-gate` to say so.
   */
  undetermined?: boolean;
}

/**
 * What a command reply is known to be before you know which command produced
 * it: the result envelope, carrying the command's own value on `payload`. The
 * default {@link CommandButtonHandle} reply, so a reader cannot treat the
 * envelope as the payload; `payload` stays `unknown` until narrowed. Useful for
 * reading the game's answer to a command the operator sent. Taken by
 * {@link CommandButtonHandle}.
 *
 * @category CommandButton
 */
export interface CommandReplyLike {
  /** Whether the command ran. False pairs with the refusal the handle surfaces. */
  success: boolean;
  /** The command's own value, when it has one. `unknown` until the reader knows which command this is. */
  payload?: unknown;
}

/**
 * The command handle a {@link Button} dispatches on: the delay-rail handle plus a
 * way to send. Useful for connecting a control to a command so it can show the
 * operator what became of a press. Declared structurally; {@link useCommand}'s
 * return value satisfies it. Taken by {@link Button} and
 * {@link useCommandControl}.
 *
 * @category CommandButton
 */
export interface CommandButtonHandle<Result = CommandReplyLike, Args = unknown>
  extends CommandDelayHandle {
  // A method rather than a function-valued property, so strictFunctionTypes does not check typed args contravariantly and reject every typed handle.
  /**
   * Sends this command with no kit input drawing it, so nothing on screen shows
   * the operator that it was sent except the panel's delay rail. Useful for a
   * send that no kit input starts, such as a price query, a background sync or
   * typed text in a script terminal. Used by a script terminal and by the
   * maneuver planner when it removes a completed node.
   *
   * A control the operator presses takes the command through its `command` prop
   * instead: pass `with` or `toArgs` to a {@link Button}, a
   * {@link Slider} or another kit input, which then draws sent, refused and the
   * rest. A key or serial binding presses a {@link useCommandControl}.
   *
   * Resolves with the reply once the command has run. Rejects when the game
   * refuses it, and when no reply arrives by the expected time. A refusal or loss
   * from a call whose promise nobody awaits is still recorded in `refusals` or
   * `losses`.
   *
   * `opts.label` is a description of this dispatch to show the operator.
   * `opts.topic` addresses the command to one part or route on the craft, such
   * as one script terminal.
   *
   * `Result` carries the reply's real type to the `onConfirmed` option of
   * `with`; a handle from `useCommand("...")` supplies it from the generated
   * command map.
   */
  dangerouslySendWithoutInput(
    args?: Args,
    opts?: { label?: string; topic?: string },
  ): Promise<Result>;
  /** This command with its arguments set, for an input's `command` prop. See `useCommand`. */
  with(
    args?: Args | (() => Args),
    options?: BoundCommandOptions<Args, Result>,
  ): BoundControlCommand<Args, Result>;
  /** This command with a way to turn an input's value into its arguments. See `useCommand`. */
  toArgs<Value>(
    toArgs: (value: Value) => Args | undefined,
    options?: BoundCommandOptions<Args, Result>,
  ): ValueCommand<Value, Args, Result, CommandButtonHandle<Result, Args>>;
  /**
   * Where the handle's latest dispatch stands, as `useCommand` reports it. The
   * control reads "SENT" until the mod answers the press (`accepted`, or the
   * reply for a command with no delay). Absent for a handle that cannot say,
   * which then shows "SENT" for {@link SENT_FLASH_MS} only.
   */
  status?: CommandStatus;
  /**
   * The standing gate verdict, when the mod publishes one for this command.
   * Absent means nothing is known in advance.
   */
  gate?: CommandGateLike;
  /**
   * The standing verdict for a call with these arguments, when the command's
   * gate depends on which item they name. `useCommand` supplies it; a control
   * that sends arguments reads it in preference to {@link gate}.
   */
  gateFor?(args: Args): CommandGateLike | undefined;
  /**
   * What an order sent now would do, from `useCommand`'s `sendStatus`. The
   * control writes it in its tooltip and, for a held order or one expected to be
   * lost, outlines its own edge (see {@link PredictedOutcome}). It never
   * blocks the press and never changes the control's size.
   */
  sendStatus?: SendStatus | undefined;
  /**
   * Whether the panel's command rail holds this handle and so speaks its
   * outcomes, as `useCommand` reports. Absent or `false`, the control says its
   * own outcomes itself, even beside a rail.
   */
  railed?: boolean;
  /**
   * The stream to the mod is down, so a press cannot be sent. The control is
   * drawn dimmed with a dotted edge and a press does nothing until the stream
   * returns; a command already in flight is not affected. `useCommand`
   * supplies it.
   */
  streamDown?: boolean;
  /**
   * Whether a blocked gate stops the press, as `useCommand` reports: true for
   * a command that takes no signal delay and for one whose verdict is held only
   * a few seconds. When this is false or absent the gate is advice: the control
   * says the command is likely to be refused and a press sends it, for the game
   * to decide on arrival.
   */
  gateStopsPress?: boolean;
}

/**
 * The standing verdict a control sending `args` draws itself from: the per-item
 * one when the handle can say, else the command's own. Used by
 * {@link useCommandControl}.
 *
 * @category CommandButton
 */
export function standingGate<Args>(
  handle: Pick<CommandButtonHandle<unknown, Args>, "gate" | "gateFor">,
  args: Args | undefined,
): CommandGateLike | undefined {
  return handle.gateFor ? handle.gateFor(args as Args) : handle.gate;
}

/**
 * Where a {@link Button} is in the command lifecycle. Useful for telling
 * the operator whether a command is waiting, on its way, refused, lost or
 * found. Returned by {@link useCommandControl} as `phase`.
 *
 * - `idle`: at rest
 * - `armed`: the operator has asked, and is being asked to mean it. Only
 *   reachable when the caller supplied a `confirmLabel`
 * - `sent`: pressed and not yet answered by the mod, for at least
 *   {@link SENT_FLASH_MS}. The command's journey to the vessel and back is the
 *   delay rail's to show, so the control is live again once the mod answers
 * - `refused`: the game evaluated it and said no. A retry changes nothing until
 *   the situation does
 * - `lost`: nothing came back. Not `idle`, which would look like a confirmed
 *   command, and not `refused`, because the game decided nothing and the
 *   command may have executed
 * - `found`: this control lost a command, and that command has since replied.
 *   Not a confirmation: the operator may already have re-sent it
 * - `blocked`: the control cannot be pressed and says why, either because the
 *   game will refuse this and said so before anyone pressed, or because the
 *   caller gave an `unavailable` reason. The control is dimmed but not
 *   `disabled`: it carries `aria-disabled`, stays focusable, and a press sends
 *   nothing. Only the game's own refusal is drawn with a dashed warning edge;
 *   the caller's reason keeps a solid edge. A gate verdict is advice, sampled
 *   and possibly a beat behind, and the game evaluates the dispatch again
 *
 * The stream to the mod being down is not a phase: it is `isOffline`, drawn
 * dimmed with a dotted edge whichever phase the control is in
 *
 * @category CommandButton
 */
export type CommandButtonPhase =
  | "idle"
  | "armed"
  | "sent"
  | "refused"
  | "lost"
  | "found"
  | "blocked";

/**
 * The tones a {@link Button} can draw in: `neutral`, `go`, `warn` and
 * `nogo`, the same set as a plain {@link Button}. Set with the `tone` prop of
 * {@link Button}.
 * Useful for colouring a command button by how serious the command is for the
 * operator.
 *
 * @category CommandButton
 */
export type CommandButtonTone = ButtonTone;

/**
 * The two sizes of {@link Button}: `sm` for a dense row and `md`, the
 * default. Set with its `size` prop.
 * Useful for fitting a command button into a dense row or a roomier form.
 *
 * @category CommandButton
 */
export type CommandButtonSize = "sm" | "md";

/**
 * Options for {@link useCommandControl}: the command the control sends when
 * pressed, and the toggle state it shows.
 * Useful for building a command control with the same dispatch and confirm
 * behaviour as {@link Button}. Used by {@link Button}.
 *
 * @category CommandButton
 */
export interface UseCommandControlOptions<
  Result = CommandReplyLike,
  Args = unknown,
> {
  /**
   * The command to send, made with `with` on a `useCommand` handle or with
   * `commandSet`. Its handle is the one the control draws its state from.
   */
  command: BoundControlCommand<Args, Result>;
  /** Makes the control a state toggle. */
  toggle?: CommandToggle<Args>;
  /**
   * Why the control cannot be pressed now, for what the command's own
   * declaration cannot know. It is drawn dimmed with this as its tip and a
   * press sends nothing. Null or absent when it can be pressed.
   */
  unavailable?: string | null;
  /**
   * Why the game is likely to refuse this command, from what the caller can
   * see and the command's own declaration cannot know. The control stays
   * pressable and the press is sent: the reason is shown as advice in its tip
   * and on its edge, and the game decides on arrival. Null or absent when
   * nothing says it will be refused.
   */
  advise?: string | null;
}

/**
 * What {@link useCommandControl} returns: the current phase, a flag per phase,
 * the composed sentences to show, and `press`. Useful for drawing a command
 * control that looks different from {@link Button}.
 *
 * @category CommandButton
 */
export interface CommandControlState<Args = unknown> {
  /** The current phase. `blocked` whenever the gate refuses or the caller gave a reason and no outcome or dispatch is standing. */
  phase: CommandButtonPhase;
  /** Pressed, and the mod has not yet answered the press. */
  isSent: boolean;
  /** Asking the operator to mean it. */
  isArmed: boolean;
  /** The game said no, and `refusalText` says what it said. */
  isRefused: boolean;
  /** Nothing came back. Not a verdict, and not the same as at rest. */
  isLost: boolean;
  /** A command this control lost has since replied. `foundText` says what the reply was. */
  isFound: boolean;
  /**
   * The game will refuse this command if it is pressed, and said so in advance,
   * from a verdict fresh enough to stop the press. A verdict held longer is
   * advice: see `isAdvised`.
   * `refusalText` carries the reason here too, so a caller renders one string
   * whichever side of the press it is on.
   */
  isBlocked: boolean;
  /**
   * The caller said the control cannot be pressed (`unavailable`, or a toggle's
   * own reason), as opposed to the game having said it will refuse the command.
   * It is true together with `isBlocked`, and `refusalText` carries the caller's
   * reason. A control draws the two differently: dimmed with a solid edge for the
   * caller's reason, and dimmed with a dashed warning edge for the game's.
   */
  isUnavailable: boolean;
  /**
   * The game is likely to refuse this command, by its gate or the caller's
   * `advise`, and a press sends it anyway. `adviceText` carries the reason. Never
   * true together with `isBlocked`.
   */
  isAdvised: boolean;
  /** The advice, composed ("... likely to be refused: ..."), or `null` when nothing says the game will refuse it. */
  adviceText: string | null;
  /** The command this control sends, with its handle: what a face reads the command's standing state from. */
  command: BoundControlCommand<Args>;
  /**
   * The composed sentence, or `null` when there is nothing to say: a refusal
   * once one has happened, else the standing gate reason.
   */
  refusalText: string | null;
  /**
   * What the recovered command turned out to have done, composed, or `null`
   * outside the `found` phase. Kept apart from `refusalText`, which is true at a
   * different moment.
   */
  foundText: string | null;
  /**
   * What is known about a command that got no reply, composed, or `null`
   * outside the `lost` phase: the sentence a `Button` given a command speaks for it.
   */
  lossText: string | null;
  /**
   * The stream to the mod is down and nothing is in flight, so a press sends
   * nothing. The control is drawn dimmed with a dotted edge and its tip says it
   * is not connected to the mod, whichever phase it is in.
   */
  isOffline: boolean;
  /**
   * What a state toggle shows: the state (the predicted opposite while the
   * command is modelled), the word to draw, the held or modelled mark, and the
   * sentence for what it is waiting on. Null for a control with no `toggle`.
   */
  toggleView: {
    shown: boolean | number | null | undefined;
    on: boolean;
    word: string;
    /** Every word the control can show, which it is sized to hold. */
    reserve: readonly string[];
    /** Why the control cannot be pressed now, or null when it can. */
    unavailable: string | null;
    /** What the press is waiting on: `sent`, `held`, `modelled`, or null once nothing is outstanding. */
    confirmation: "sent" | "held" | "modelled" | null;
    marking: ReckoningMarking | null;
    sentence: string | null;
  } | null;
  /**
   * Sends `command` as this control's own press: for a toggle that a bound
   * input drives to a state, such as "SAS on", which a later press then
   * inverts. Does nothing while the stream to the mod is down.
   */
  // A method rather than a function-valued property, so a control typed for one command's args still takes another's state.
  pressWith(command: BoundControlCommand<Args>): void;
  /** This handle has a dispatch with no reply (overdue or lost), for the `data-unconfirmed` tint. */
  hasUnconfirmed: boolean;
  /** This handle has a dispatch that never left, for the `data-failed` tint. */
  hasFailure: boolean;
  /**
   * The control was pressed. Advances the machine: arm, then dispatch; a press
   * is always sent, however many are outstanding; a press while refused, lost or found clears that
   * outcome; a press while blocked (a command the game will refuse by a fresh verdict, or
   * the caller's `unavailable`) dispatches nothing and shows the reason
   * instead. `armable` says whether there is a confirm step, which only the
   * caller knows.
   */
  press: (armable: boolean) => void;
}

/**
 * The {@link Button} lifecycle with no rendering attached, for a control
 * that looks different. The hook keeps the phase, the arm timeout and the
 * reply handling; the caller draws each phase and wires its own click to
 * `press`. A `Button` given a `command` is this hook plus the default rendering. Useful for
 * a control that must look different but still show the operator what became
 * of the command. Returns a {@link CommandControlState}.
 *
 * @example
 * ```tsx
 * import { useCommand } from "@ksp-gonogo/sitrep-sdk";
 * import { Button, useCommandControl } from "@ksp-gonogo/ui-kit";
 *
 * function RecoverButton() {
 *   const recover = useCommand("ksp.recover");
 *   const control = useCommandControl({
 *     command: recover.with(undefined, { label: "Recover" }),
 *   });
 *   // A bound key presses the same control with control.press(true).
 *   return (
 *     <Button command={control} confirmLabel="Confirm recover">
 *       Recover
 *     </Button>
 *   );
 * }
 * ```
 *
 * @category CommandButton
 */
export function useCommandControl<Result = CommandReplyLike, Args = unknown>({
  command,
  toggle,
  unavailable,
  advise,
}: UseCommandControlOptions<Result, Args>): CommandControlState<Args> {
  const handle = command.handle;
  const args = command.members ? undefined : argsOf(command);
  const commandLabel = command.options.label;
  const [phase, setPhase] = useState<CommandButtonPhase>("idle");
  const [refusal, setRefusal] = useState<CommandRefusalLike | null>(null);
  const [found, setFound] = useState<CommandFoundLike | null>(null);
  // Each dispatch restarts the flash; `awaiting` holds from the press until the control's own dispatch settles.
  const [flashing, setFlashing] = useState(false);
  const [flashSeq, setFlashSeq] = useState(0);
  const [awaiting, setAwaiting] = useState(false);
  // The send this control's own dispatch became, so another control's press on a shared handle is not read as this one's.
  const ownRequestRef = useRef<string | null>(null);

  const streamDown = handle.streamDown === true;
  const gate = standingGate(handle, args);
  // An undetermined gate is NOT a refusal and must not darken anything.
  /*
   * A prediction stops the press only when it is fresh enough to stand for the
   * game's answer: the command takes no signal delay, or its delay is a few
   * seconds. Past that the control advises and the press is sent.
   */
  const stopsOnGate = handle.gateStopsPress === true;
  const toggleBlocked =
    toggle?.unavailable ??
    unavailable ??
    (stopsOnGate && advise
      ? commandGateSentence({
          errorCode: CommandErrorCode.ModeUnavailable,
          detail: advise,
          label: commandLabel,
          args,
        })
      : null) ??
    null;
  const gateBlocks =
    (gate?.blocked === true && stopsOnGate) || toggleBlocked !== null;
  const gateAdvises =
    gate?.blocked === true && !stopsOnGate && toggleBlocked === null;

  // A late reply must not set state after unmount or overwrite a newer dispatch's outcome.
  const mountedRef = useRef(true);
  const dispatchSeqRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
   * A command THIS control lost, turning up answered. One handle often serves
   * many rows, so the phase is gated on `awaitingFoundRef` (set when this
   * control's own dispatch settled lost, and holding what that dispatch
   * carried so a found for another row's command is not taken as this one's).
   * Cleared when the outcome is cleared or times out and when a new dispatch
   * starts. Watched off the handle, because the dispatch promise already
   * rejected as lost and never settles again.
   */
  const founds = handle.founds;
  const awaitingFoundRef = useRef<{ args: unknown; label?: string } | null>(
    null,
  );
  const foundsSeenRef = useRef(founds?.length ?? 0);
  useEffect(() => {
    const count = founds?.length ?? 0;
    const grew = count > foundsSeenRef.current;
    foundsSeenRef.current = count;
    const latest = founds?.[count - 1];
    const awaiting = awaitingFoundRef.current;
    if (!grew || !latest || awaiting === null) return;
    const otherLabel =
      latest.label !== undefined &&
      latest.label !== "" &&
      awaiting.label !== undefined &&
      latest.label !== awaiting.label;
    const otherArgs =
      latest.args !== undefined &&
      awaiting.args !== undefined &&
      JSON.stringify(latest.args) !== JSON.stringify(awaiting.args);
    if (otherLabel || otherArgs) return;
    awaitingFoundRef.current = null;
    setFound(latest);
    setRefusal(null);
    setPhase("found");
  }, [founds]);

  // Auto-disarm, so a forgotten arm does not sit live indefinitely.
  useEffect(() => {
    if (phase !== "armed") return;
    const id = setTimeout(() => setPhase("idle"), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // Let a refusal, a silence or a found be read, then return to rest.
  useEffect(() => {
    if (phase !== "refused" && phase !== "lost" && phase !== "found") return;
    const id = setTimeout(() => {
      setPhase("idle");
      setRefusal(null);
      awaitingFoundRef.current = null;
      // The rail holds a found until dismissed; this is only the echo on the control.
      setFound(null);
    }, REFUSAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // The press stays visible as SENT for at least the flash, however soon the mod answers.
  useEffect(() => {
    if (flashSeq === 0) return;
    const id = setTimeout(() => setFlashing(false), SENT_FLASH_MS);
    return () => clearTimeout(id);
  }, [flashSeq]);

  const dispatch = useCallback(
    (target: BoundControlCommand<Args, Result> = command) => {
      const sendArgs = target.members ? undefined : argsOf(target);
      const label = target.options.label;
      const seq = dispatchSeqRef.current + 1;
      dispatchSeqRef.current = seq;
      awaitingFoundRef.current = null;
      ownRequestRef.current = null;
      setPhase("idle");
      setRefusal(null);
      setFlashing(true);
      setFlashSeq((n) => n + 1);
      setAwaiting(true);
      const settle = (
        next: CommandButtonPhase,
        reason: CommandRefusalLike | null,
      ) => {
        if (!mountedRef.current || dispatchSeqRef.current !== seq) return;
        setRefusal(reason);
        setPhase(next);
        setAwaiting(false);
        // An outcome is shown at once, not after the flash.
        if (next !== "idle") setFlashing(false);
      };
      const refusalOf = (
        rejection: Extract<
          ReturnType<typeof classifyCommandRejection>,
          { kind: "refused" }
        >,
      ): CommandRefusalLike => ({
        errorCode: rejection.errorCode,
        reason: rejection.reason,
        command: rejection.command,
        args: rejection.args,
        label: rejection.label ?? label,
        breach: rejection.breach,
        // The game's own words, which `commandRefusalSentence` prefers over its general clause.
        detail: rejection.detail,
      });
      const options = target.options;
      let sent: Promise<Result>;
      if (target.members) {
        // A member's refusal is told in the same sentence the control shows for its own.
        const members = target.members.map((m) => ({
          ...m,
          options: {
            ...m.options,
            onRejected: (error: unknown) => {
              m.options.onRejected?.(error);
              const rejection = classifyCommandRejection(error);
              if (rejection.kind === "refused") {
                m.options.onRefused?.(
                  commandRefusalSentence({
                    ...refusalOf(rejection),
                    label: rejection.label ?? m.options.label,
                  }),
                );
              }
            },
          },
        }));
        sent = runSet(members, target.set ?? {}).then((result) =>
          result.failed > 0
            ? Promise.reject(result.firstError)
            : (undefined as Result),
        );
      } else {
        options.before?.(sendArgs);
        sent = target.handle.dangerouslySendWithoutInput(
          sendArgs,
          label || options.topic ? { label, topic: options.topic } : undefined,
        ) as Promise<Result>;
      }
      sent.then(
        (result: Result) => {
          settle("idle", null);
          options.onConfirmed?.(result);
        },
        (err: unknown) => {
          const rejection = classifyCommandRejection(err);
          if (!target.members) {
            options.onRejected?.(err);
            if (rejection.kind === "refused") {
              options.onRefused?.(commandRefusalSentence(refusalOf(rejection)));
            }
          }
          if (rejection.kind === "lost") {
            // From here on, a found landing on the handle is this control's.
            awaitingFoundRef.current = { args: sendArgs, label };
            settle("lost", null);
            return;
          }
          if (rejection.kind !== "refused") {
            // A machinery failure is the rail's to report, not this control's.
            settle("idle", null);
            return;
          }
          settle("refused", refusalOf(rejection));
        },
      );
    },
    [command],
  );

  // The rail is the primary outcome surface; these tints only say WHICH control issued the command.
  const { hasUnconfirmed, hasFailure } = commandOutcomes(handle);

  /*
   * The mod answers a press with an acceptance (or its reply, for a command
   * with no delay). A handle with no status can only say it was just pressed.
   */
  const status: CommandStatus | undefined = handle.status;
  const unanswered =
    awaiting &&
    status?.phase === "in-flight" &&
    status.accepted !== true &&
    (ownRequestRef.current === null ||
      ownRequestRef.current === status.requestId);
  const sent = flashing || unanswered;
  useEffect(() => {
    if (
      awaiting &&
      ownRequestRef.current === null &&
      status?.phase === "in-flight"
    ) {
      ownRequestRef.current = status.requestId;
    }
  }, [awaiting, status]);

  const toggleRows = toggle
    ? handle.inFlight.filter(toggle.rows ?? (() => true))
    : [];
  const confirmation = toggle
    ? toggleConfirmationOf(
        sent,
        status,
        toggleRows,
        toggle.state,
        toggle.modelled,
      )
    : null;
  const modelledShown = toggle
    ? shownToggleState(
        toggle.state,
        confirmation,
        status,
        toggleRows,
        toggle.modelled,
      )
    : undefined;
  const wireEpoch = useWireTimelineEpoch();
  // While the latest press is outstanding the shown reading is still the old state, so the next press inverts the state that press asked for.
  const askedRef = useRef<boolean | undefined>(undefined);
  // The reading a press was made against: while a confirmed press has not moved it, the press still stands as the state asked for.
  const askedFromRef = useRef<ToggleState>(undefined);
  /*
   * The reply reaches the app before the frame that carries the new state, so a
   * confirmed press keeps showing the state it asked for until the reading
   * moves or this long has passed, instead of flashing the old state back.
   */
  const [heldPast, setHeldPast] = useState<string | null>(null);
  const heldRequestId = status?.phase === "confirmed" ? status.requestId : null;
  useEffect(() => {
    if (heldRequestId === null) return;
    const timer = setTimeout(
      () => setHeldPast(heldRequestId),
      CONFIRMED_STATE_HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [heldRequestId]);
  // The press whose asked state this control was already drawing as a prediction: only that one is held past its reply.
  const predictedForRef = useRef<string | null>(null);
  if (
    toggle !== undefined &&
    confirmation === "modelled" &&
    status !== undefined &&
    status.phase !== "idle" &&
    askedRef.current !== undefined &&
    modelledShown === askedRef.current
  ) {
    predictedForRef.current = status.requestId;
  }
  const holdsAsked =
    toggle !== undefined &&
    heldRequestId !== null &&
    predictedForRef.current === heldRequestId &&
    confirmation !== "modelled" &&
    heldRequestId !== null &&
    heldRequestId !== heldPast &&
    askedRef.current !== undefined &&
    toggle.state === askedFromRef.current;
  const shown = holdsAsked ? askedRef.current : modelledShown;
  const outstanding =
    pressOutstanding(status, handle.inFlight) ||
    (status?.phase === "confirmed" &&
      askedRef.current !== undefined &&
      toggle?.state === askedFromRef.current);
  const toggleBase =
    outstanding && askedRef.current !== undefined ? askedRef.current : shown;

  // Read at press time, so a second press before the next render inverts the state the first one asked for.
  const toggleBaseRef = useRef(toggleBase);
  toggleBaseRef.current = toggleBase;

  const press = useCallback(
    (armable: boolean) => {
      if (streamDown) return;
      // The game already said it will refuse this, so the press sends nothing; the reason is the control's tip.
      if (gateBlocks) return;
      // A state toggle sends the opposite of the state it shows, however many presses are outstanding and whatever became of an earlier one.
      if (toggle) {
        const sendArgs = toggle.args(toggleBaseRef.current);
        if (sendArgs === undefined) return;
        askedRef.current = askedToggleValue(sendArgs);
        askedFromRef.current = toggle.state;
        if (askedRef.current !== undefined) {
          toggleBaseRef.current = askedRef.current;
        }
        dispatch({ ...command, args: sendArgs });
        return;
      }
      // A press on an outcome clears it and starts the handshake over, rather than dispatching straight back.
      if (phase === "refused" || phase === "lost" || phase === "found") {
        setRefusal(null);
        setFound(null);
        awaitingFoundRef.current = null;
        setPhase("idle");
        return;
      }
      if (armable) {
        // The confirm already went, so a press now would arm a second spend behind a face that reads SENT.
        if (sent) return;
        if (phase !== "armed") {
          armedForRef.current = argsKey(args);
          armedOnEpochRef.current = wireEpoch;
          setPhase("armed");
          return;
        }
      }
      dispatch();
    },
    [
      phase,
      sent,
      streamDown,
      gateBlocks,
      dispatch,
      args,
      toggle,
      command,
      wireEpoch,
    ],
  );

  // One handle serves many rows, and a row keyed by position can be handed another item while armed; the confirming press must not send to it. A game load drops the confirm too, because what was armed against is gone.
  const armedForRef = useRef<string | null>(null);
  const armedOnEpochRef = useRef(wireEpoch);
  useEffect(() => {
    if (
      phase === "armed" &&
      (argsKey(args) !== armedForRef.current ||
        wireEpoch !== armedOnEpochRef.current)
    ) {
      setPhase("idle");
    }
  }, [phase, args, wireEpoch]);

  // A real outcome outranks a standing gate, and a command already travelling is not stopped by a gate that shut behind it.
  const effectivePhase: CommandButtonPhase =
    phase === "refused" || phase === "lost" || phase === "found"
      ? phase
      : sent
        ? "sent"
        : gateBlocks
          ? "blocked"
          : phase;

  const adviceText =
    effectivePhase === "blocked" || toggleBlocked !== null
      ? null
      : gateAdvises && gate
        ? commandAdviceSentence({
            ...gate,
            label: gate.label ?? commandLabel,
            args: gate.args ?? args,
          })
        : advise
          ? commandAdviceSentence({
              errorCode: CommandErrorCode.ModeUnavailable,
              detail: advise,
              label: commandLabel,
              args,
            })
          : null;

  return {
    phase: effectivePhase,
    isSent: effectivePhase === "sent",
    isArmed: effectivePhase === "armed",
    isRefused: effectivePhase === "refused",
    isLost: effectivePhase === "lost",
    isFound: effectivePhase === "found",
    isBlocked: effectivePhase === "blocked",
    isOffline: streamDown && effectivePhase !== "sent",
    isUnavailable: toggleBlocked !== null,
    isAdvised: adviceText !== null,
    adviceText,
    command,
    refusalText: refusal
      ? commandRefusalSentence(refusal)
      : toggleBlocked !== null
        ? toggleBlocked
        : effectivePhase === "blocked" && gate
          ? // The mod's gate is per command, so the caller's label says which row went dark.
            commandGateSentence({
              ...gate,
              label: gate.label ?? commandLabel,
              args: gate.args ?? args,
            })
          : null,
    foundText: found ? commandFoundSentence(found) : null,
    lossText:
      effectivePhase === "lost"
        ? commandLossSentence({ args, label: commandLabel })
        : null,
    pressWith: (bound) => {
      if (streamDown) return;
      askedRef.current = askedToggleValue(argsOf(bound));
      askedFromRef.current = toggle?.state;
      dispatch(bound);
    },
    toggleView: toggle
      ? {
          shown,
          on: typeof shown === "number" ? shown > 0 : shown === true,
          word:
            confirmation === "sent"
              ? (toggle.sentWord ?? SENT_WORD)
              : toggle.word(shown),
          reserve: [...toggle.words, toggle.sentWord ?? SENT_WORD],
          confirmation,
          unavailable: toggleBlocked,
          marking: toggleMarking(
            toggle.name,
            confirmation,
            toggle.marking ?? null,
          ),
          sentence: confirmationSentenceOf(toggle.name, confirmation),
        }
      : null,
    hasUnconfirmed,
    hasFailure,
    press,
  };
}
