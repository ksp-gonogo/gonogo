import {
  type CommandStatus,
  classifyCommandRejection,
  type SendStatus,
} from "@ksp-gonogo/sitrep-sdk";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
 * control is greyed out, and for a control of your own that follows the same
 * state. Used by {@link CommandButton} and by the Action Group widget's toggle.
 *
 * @category CommandButton
 */
export const STREAM_DOWN_TIP = "Not connected to the mod. Nothing can be sent";

/**
 * How long, in milliseconds, an armed {@link CommandButton} waits for its
 * confirming press before it returns to rest. Used by {@link CommandButton} and
 * {@link useCommandButton}.
 *
 * @category CommandButton
 */
export const ARM_TIMEOUT_MS = 4000;

/**
 * How long, in milliseconds, a refusal stays on a command control before the
 * control returns to rest. Used by {@link CommandButton} and
 * {@link useCommandButton}.
 *
 * @category CommandButton
 */
export const REFUSAL_TIMEOUT_MS = 8000;

/**
 * The fewest milliseconds a {@link CommandButton} reads "SENT" after a press,
 * so the press is seen to have gone however soon the mod answers it. Used by
 * {@link CommandButton}, {@link useCommandButton} and the toggles of the
 * Navball and Action Group widgets.
 *
 * @category CommandButton
 */
export const SENT_FLASH_MS = 500;
export type {
  CommandToggle,
  ToggleState,
} from "./toggle";

/** The word a command control shows while the mod has not answered the press. */
const SENT_WORD = "SENT";

/**
 * What the mod says about a command before it is pressed: whether the game would
 * refuse it. Useful for darkening a control the operator cannot usefully press
 * and saying why. Declared structurally; `useCommand`'s `gate` satisfies it.
 * Read by {@link CommandButton} through {@link CommandButtonHandle}.
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
 * The command handle a {@link CommandButton} dispatches on: the delay-rail handle plus a
 * way to send. Useful for connecting a control to a command so it can show the
 * operator what became of a press. Declared structurally; {@link useCommand}'s
 * return value satisfies it. Taken by {@link CommandButton} and
 * {@link useCommandButton}.
 *
 * @category CommandButton
 */
export interface CommandButtonHandle<Result = CommandReplyLike, Args = unknown>
  extends CommandDelayHandle {
  // A method rather than a function-valued property, so strictFunctionTypes does not check typed args contravariantly and reject every typed handle.
  /**
   * Dispatch. The promise resolves when the command is confirmed and rejects
   * when it is refused, lost, or the machinery failed, so the control clears its
   * own state with no per-command telemetry predicate. A refusal
   * rejects with an error carrying its `CommandErrorCode`: read it with
   * `classifyCommandRejection` from `@ksp-gonogo/sitrep-sdk`.
   *
   * `Result` carries the reply's real type to
   * {@link CommandButtonProps.onConfirmed}; a handle from `useCommand("...")`
   * supplies it from the generated command map.
   */
  send(args?: Args, opts?: { label?: string; topic?: string }): Promise<Result>;
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
   * drawn unavailable and a press does nothing until the stream returns; a
   * command already in flight is not affected. `useCommand` supplies it.
   */
  streamDown?: boolean;
}

/**
 * The standing verdict a control sending `args` draws itself from: the per-item
 * one when the handle can say, else the command's own. Used by
 * {@link useCommandButton}.
 *
 * @category CommandButton
 */
function standingGate<Args>(
  handle: Pick<CommandButtonHandle<unknown, Args>, "gate" | "gateFor">,
  args: Args | undefined,
): CommandGateLike | undefined {
  return handle.gateFor ? handle.gateFor(args as Args) : handle.gate;
}

/**
 * Where a {@link CommandButton} is in the command lifecycle. Useful for telling
 * the operator whether a command is waiting, on its way, refused, lost or
 * found. Returned by {@link useCommandButton} as `phase`.
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
 * - `blocked`: the game will refuse this, and said so before anyone pressed.
 *   The control is dark but not `disabled`: it carries `aria-disabled`, stays
 *   focusable, and responds to a press by showing why. A gate verdict is
 *   advice, sampled and possibly a beat behind, and the dispatch is evaluated
 *   again by the game anyway
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
 * The tones a {@link CommandButton} can draw in: `neutral`, `go`, `warn` and
 * `nogo`, the same set as a plain {@link Button}. Set with the `tone` prop of
 * {@link CommandButton}.
 * Useful for colouring a command button by how serious the command is for the
 * operator.
 *
 * @category CommandButton
 */
export type CommandButtonTone = ButtonTone;

/**
 * The two sizes of {@link CommandButton}: `sm` for a dense row and `md`, the
 * default. Set with its `size` prop.
 * Useful for fitting a command button into a dense row or a roomier form.
 *
 * @category CommandButton
 */
export type CommandButtonSize = "sm" | "md";

/**
 * Options for {@link useCommandButton}: the command handle to dispatch on and
 * the wording of the confirm step.
 * Useful for building a command control of your own with the same dispatch and
 * confirm behaviour as {@link CommandButton}. Used by {@link CommandButton}.
 *
 * @category CommandButton
 */
export interface UseCommandButtonOptions<
  Result = CommandReplyLike,
  Args = unknown,
> {
  /** The command the control dispatches, usually the return of `useCommand`. */
  handle: CommandButtonHandle<Result, Args>;
  /** Args for the dispatch. See {@link CommandButtonProps.args}. */
  args?: NoInfer<Args>;
  /** The dispatch's operator-facing description, which a refusal or loss sentence is named after. */
  commandLabel?: string;
  /** Receives the dispatch's resolved result. See {@link CommandButtonProps.onConfirmed}. */
  onConfirmed?: (result: Result) => void;
  /** Makes the control a state toggle. See {@link CommandButtonProps.toggle}. */
  toggle?: CommandToggle<Args>;
}

/**
 * What {@link useCommandButton} returns: the current phase, a flag per phase,
 * the composed sentences to show, and `press`. Useful for drawing a command
 * control that looks different from {@link CommandButton}.
 *
 * @category CommandButton
 */
export interface CommandButtonState<Args = unknown> {
  /** The current phase. `blocked` whenever the gate refuses and no outcome or dispatch is standing. */
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
   * The game will refuse this if it is pressed, and said so in advance.
   * `refusalText` carries the reason here too, so a caller renders one string
   * whichever side of the press it is on.
   */
  isBlocked: boolean;
  /**
   * The operator pressed a blocked control and is being told why: the reason
   * made visible on demand, for the sighted keyboard user a `title` never
   * reaches.
   */
  isShowingReason: boolean;
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
   * outside the `lost` phase: the sentence `CommandButton` speaks for it.
   */
  lossText: string | null;
  /**
   * The stream to the mod is down and nothing is in flight, so a press sends
   * nothing. The control is drawn unavailable, whichever phase it is in.
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
   * Sends `args` as this control's own press, under `label` when given: for a
   * toggle that a bound input drives to a state, such as "SAS on", which a
   * later press then inverts. Does nothing while the stream to the mod is down.
   */
  // A method rather than a function-valued property, so a control typed for one command's args still takes another's state.
  sendAs(args: Args, label?: string): void;
  /** This handle has a dispatch with no reply (overdue or lost), for the `data-unconfirmed` tint. */
  hasUnconfirmed: boolean;
  /** This handle has a dispatch that never left, for the `data-failed` tint. */
  hasFailure: boolean;
  /**
   * The control was pressed. Advances the machine: arm, then dispatch; a press
   * is always sent, however many are outstanding; a press while refused, lost or found clears that
   * outcome; a press while blocked dispatches nothing and shows the reason
   * instead. `armable` says whether there is a confirm step, which only the
   * caller knows.
   */
  press: (armable: boolean) => void;
}

/**
 * The {@link CommandButton} lifecycle with no rendering attached, for a control
 * that looks different. The hook keeps the phase, the arm timeout and the
 * reply handling; the caller draws each phase and wires its own click to
 * `press`. `CommandButton` is this hook plus the default rendering. Useful for
 * a control that must look different but still show the operator what became
 * of the command. Returns a {@link CommandButtonState}.
 *
 * @example
 * ```tsx
 * import { useCommand } from "@ksp-gonogo/sitrep-sdk";
 * import { useCommandButton } from "@ksp-gonogo/ui-kit";
 *
 * function RecoverButton() {
 *   const recover = useCommand("ksp.recover");
 *   const { isArmed, isSent, isRefused, refusalText, press } =
 *     useCommandButton({ handle: recover, commandLabel: "Recover" });
 *   const word = isSent
 *     ? "SENT"
 *     : isRefused
 *       ? "Refused"
 *       : isArmed
 *         ? "Confirm recover"
 *         : "Recover";
 *   return (
 *     <button
 *       type="button"
 *       title={refusalText ?? undefined}
 *       // `true` asks for a confirm step: the first press arms, the second sends.
 *       onClick={() => press(true)}
 *     >
 *       {word}
 *     </button>
 *   );
 * }
 * ```
 *
 * @category CommandButton
 */
export function useCommandButton<Result = CommandReplyLike, Args = unknown>({
  handle,
  args,
  commandLabel,
  onConfirmed,
  toggle,
}: UseCommandButtonOptions<Result, Args>): CommandButtonState<Args> {
  const [phase, setPhase] = useState<CommandButtonPhase>("idle");
  const [refusal, setRefusal] = useState<CommandRefusalLike | null>(null);
  const [found, setFound] = useState<CommandFoundLike | null>(null);
  // A press on a blocked control shows its reason, cleared on the refusal window.
  const [reasonShown, setReasonShown] = useState(false);
  // Each dispatch restarts the flash; `awaiting` holds from the press until the control's own dispatch settles.
  const [flashing, setFlashing] = useState(false);
  const [flashSeq, setFlashSeq] = useState(0);
  const [awaiting, setAwaiting] = useState(false);
  // The send this control's own dispatch became, so another control's press on a shared handle is not read as this one's.
  const ownRequestRef = useRef<string | null>(null);

  const streamDown = handle.streamDown === true;
  const gate = standingGate(handle, args);
  // An undetermined gate is NOT a refusal and must not darken anything.
  const toggleBlocked = toggle?.unavailable ?? null;
  const gateBlocks = gate?.blocked === true || toggleBlocked !== null;

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

  useEffect(() => {
    if (!reasonShown) return;
    const id = setTimeout(() => setReasonShown(false), REFUSAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [reasonShown]);

  // The gate reopening takes the reason down with it.
  useEffect(() => {
    if (!gateBlocks && reasonShown) setReasonShown(false);
  }, [gateBlocks, reasonShown]);

  // The press stays visible as SENT for at least the flash, however soon the mod answers.
  useEffect(() => {
    if (flashSeq === 0) return;
    const id = setTimeout(() => setFlashing(false), SENT_FLASH_MS);
    return () => clearTimeout(id);
  }, [flashSeq]);

  const dispatch = useCallback(
    (
      sendArgs: Args | undefined = args,
      label: string | undefined = commandLabel,
    ) => {
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
      handle.send(sendArgs, label ? { label } : undefined).then(
        (result: Result) => {
          settle("idle", null);
          onConfirmed?.(result);
        },
        (err: unknown) => {
          const rejection = classifyCommandRejection(err);
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
          settle("refused", {
            errorCode: rejection.errorCode,
            reason: rejection.reason,
            command: rejection.command,
            args: rejection.args,
            label: rejection.label ?? commandLabel,
            breach: rejection.breach,
            // The game's own words, which `commandRefusalSentence` prefers over its general clause.
            detail: rejection.detail,
          });
        },
      );
    },
    [handle, args, commandLabel, onConfirmed],
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
    ? toggleConfirmationOf(sent, status, toggleRows)
    : null;
  const shown = toggle
    ? shownToggleState(toggle.state, confirmation)
    : undefined;
  // While the latest press is outstanding the shown reading is still the old state, so the next press inverts the state that press asked for.
  const askedRef = useRef<boolean | undefined>(undefined);
  const outstanding = pressOutstanding(status, handle.inFlight);
  const toggleBase =
    outstanding && askedRef.current !== undefined ? askedRef.current : shown;

  const press = useCallback(
    (armable: boolean) => {
      if (streamDown) return;
      // The game already said it will refuse this, so the press shows why instead of spending a round trip.
      if (gateBlocks) {
        setReasonShown(true);
        return;
      }
      // A state toggle sends the opposite of the state it shows, however many presses are outstanding and whatever became of an earlier one.
      if (toggle) {
        const sendArgs = toggle.args(toggleBase);
        if (sendArgs === undefined) return;
        askedRef.current = askedToggleValue(sendArgs);
        dispatch(sendArgs);
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
          setPhase("armed");
          return;
        }
      }
      dispatch();
    },
    [phase, sent, streamDown, gateBlocks, dispatch, args, toggle, toggleBase],
  );

  // One handle serves many rows, and a row keyed by position can be handed another item while armed; the confirming press must not send to it.
  const armedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (phase === "armed" && argsKey(args) !== armedForRef.current) {
      setPhase("idle");
    }
  }, [phase, args]);

  // A real outcome outranks a standing gate, and a command already travelling is not stopped by a gate that shut behind it.
  const effectivePhase: CommandButtonPhase =
    phase === "refused" || phase === "lost" || phase === "found"
      ? phase
      : sent
        ? "sent"
        : gateBlocks
          ? "blocked"
          : phase;

  return {
    phase: effectivePhase,
    isSent: effectivePhase === "sent",
    isArmed: effectivePhase === "armed",
    isRefused: effectivePhase === "refused",
    isLost: effectivePhase === "lost",
    isFound: effectivePhase === "found",
    isBlocked: effectivePhase === "blocked",
    isOffline: streamDown && effectivePhase !== "sent",
    isShowingReason: effectivePhase === "blocked" && reasonShown,
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
    sendAs: (sendArgs, label) => {
      if (streamDown) return;
      askedRef.current = askedToggleValue(sendArgs);
      dispatch(sendArgs, label);
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

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type" | "children" | "aria-pressed" | "title"
>;

/**
 * Props for {@link CommandButton}: the command handle, the arguments to send
 * and the confirm wording. Any other native button attribute is passed through.
 * Useful for naming the command a button sends, the arguments it carries and
 * how the operator confirms it. Used by {@link CommandButton}.
 *
 * @category CommandButton
 */
export interface CommandButtonProps<Result = CommandReplyLike, Args = unknown>
  extends NativeButtonProps {
  /**
   * The command this control dispatches. Its reply type is what
   * {@link CommandButtonProps.onConfirmed} receives, inferred.
   */
  handle: CommandButtonHandle<Result, Args>;
  /**
   * Args for the dispatch, passed straight to `handle.send` and checked
   * against what that command takes. `NoInfer`, so a wrong args object cannot
   * widen `Args` to its own shape.
   */
  args?: NoInfer<Args>;
  /**
   * The dispatch's operator-facing description, which a refusal is named
   * after ("Hire Valentina Kerman refused: ...").
   */
  commandLabel?: string;
  /**
   * What the control says on hover and keyboard focus while it is at rest or
   * armed, in the kit's tip. An outcome's own sentence replaces it while one
   * stands. It is not the accessible name: give `aria-label` for that.
   */
  title?: string;
  /** The resting label. */
  label: ReactNode;
  /**
   * The armed label. Supplying it makes this an arm-then-confirm control: the
   * first click puts it in the armed phase, the second dispatches, and an armed
   * control left alone returns to rest after {@link ARM_TIMEOUT_MS}. Omit it for
   * a control that dispatches on one click.
   *
   * Arm anything irreversible, and anything that spends career funds.
   */
  confirmLabel?: ReactNode;
  /** The refused label. Defaults to "Refused". */
  refusedLabel?: ReactNode;
  /**
   * The label for a dispatch that got no reply. Defaults to "No reply": not
   * "failed" and not "refused", neither of which is known.
   */
  lostLabel?: ReactNode;
  /**
   * The label for a command this control lost that has since replied.
   * Defaults to "Found", with the whole sentence on the accessible name and
   * title. Not "Confirmed": the operator was told to give up on it.
   */
  foundLabel?: ReactNode;
  /**
   * The blocked phase's accessible name, for a control whose gate reason is
   * already spelled out beside it. Omit it and the accessible name is the
   * composed gate sentence.
   */
  blockedAriaLabel?: string;
  /**
   * The armed phase's accessible name, for a control whose resting
   * `aria-label` says more than its visible word ("Hire Desdin Kerman for
   * 30,000 funds"). Omit it and the visible confirm wording is the accessible
   * name, never the resting label, since the next press means something
   * different.
   */
  confirmAriaLabel?: string;
  /** The sent phase's accessible name, for a control whose resting name says more than its visible word. Defaults to the command's label followed by "sent, not yet received". */
  sentAriaLabel?: string;
  /**
   * Whether this control's command is currently in effect, for a control that
   * represents state as well as acting on it: a SAS toggle, an action group, an
   * activated strategy. Sets `aria-pressed` and the pressed fill, the same
   * state {@link Button} and {@link ToggleButton} call `pressed`. Leave it
   * undefined for a control that only acts.
   */
  pressed?: boolean;
  /**
   * How much the control asks to be pressed at rest. `ghost` (default) is the
   * quiet outline that fills only while pressed, armed or refused; `primary`
   * is filled in `tone` at rest, for the one verb of a group that commits.
   */
  variant?: "ghost" | "primary";
  /**
   * The tone of the fill while `pressed`, and of the resting fill for a
   * `primary` control. Defaults to `neutral`.
   */
  tone?: CommandButtonTone;
  /**
   * Shown in place of the word when the word does not fit the control's width,
   * measured against the control itself and following resizes, for a control in
   * a narrow cell. The word stays the accessible name in both states. Needs a
   * plain-text label and, when set, `confirmLabel`.
   */
  icon?: ReactNode;
  /** Shown in place of the confirm word when it does not fit. Defaults to {@link CommandButtonProps.icon}. */
  confirmIcon?: ReactNode;
  /**
   * Called with the control's press while a click on it would do something
   * (not while it is in flight) and with `null` when it would not, for a
   * caller that lets an input (a key, a gamepad button or a serial device
   * bound to this control) press it from elsewhere. The press takes no
   * arguments and does what a click does: with a `confirmLabel` the first
   * press arms and the second dispatches, and a control with none dispatches
   * at once.
   */
  onPressReady?: (press: (() => void) | null) => void;
  /**
   * Makes the control a state toggle: it shows the state the vessel reports,
   * a press sends the command that sets the opposite, and while that press is
   * unanswered it shows "SENT", then the state again, marked held while the
   * command waits at a relay and marked modelled while it is predicted to have
   * arrived. A second press is always sent. The control draws as a pressed or
   * unpressed button in the word `toggle.word` gives; `label`, `confirmLabel`
   * and the arm step do not apply.
   */
  toggle?: CommandToggle<Args>;
  /**
   * The state of a {@link useCommandButton} the caller already runs, so a press
   * that comes from elsewhere (a bound key, a serial input) and a click on this
   * control are one press of one control, whether or not it is on screen. The
   * control draws from it instead of its own.
   */
  controller?: CommandButtonState<Args>;
  /** Defaults to `md`. */
  size?: CommandButtonSize;
  /** Tone for the armed phase. Defaults to `go`: confirm reads as commit. */
  confirmTone?: CommandButtonTone;
  /**
   * Called once a dispatch is confirmed, for a caller with local state to
   * settle.
   *
   * Receives what the dispatch resolved with, typed off the handle. A confirmed
   * command did not necessarily run again: the plugin may answer a repeat of
   * the same dispatch with the reply it gave the first time. The value is the
   * reply envelope; the command's own value is on `payload`.
   */
  onConfirmed?: (result: Result) => void;
}

/**
 * A button that dispatches a command and shows what became of it: at rest,
 * armed (with a `confirmLabel`), sent, refused, lost (no reply came in
 * time), found (a lost command has since replied), or blocked. Useful for
 * letting the operator send a command and see which control sent it and how it
 * ended. Used by the upgrade button of the space centre status widget and the
 * rows of the administration building. A control is blocked while the mod says in
 * advance that the command would be refused, such as a purchase the save cannot
 * afford, and the button then says why. The panel's delay rail shows that a
 * command is in flight; this shows which control sent it.
 *
 * After a press the control reads "SENT" for at least {@link SENT_FLASH_MS},
 * and for as long after as the mod has not answered the press, then it is live
 * again: a second press is always sent. Where the command is on its way to the
 * vessel and back is the panel's delay rail's to show. The sent state is per
 * rendered control, not per handle, so one handle serving a list gives each
 * row its own. Outcomes are announced through a polite live region.
 *
 * @example
 * ```tsx
 * const transmitCmd = useCommand("science.experiment.transmit");
 *
 * <CommandButton
 *   size="sm"
 *   handle={transmitCmd}
 *   args={{ partId }}
 *   commandLabel="Transmit experiment"
 *   label="Transmit"
 *   confirmLabel="Confirm transmit"
 * />
 * ```
 *
 * @category CommandButton
 * @categoryDescription CommandButton
 * A control that sends a command and shows what became of it: armed, in flight,
 * refused, lost, found again or blocked, with the outcome announced. Every control that
 * dispatches a command handle is one of these.
 */
export function CommandButton<Result = CommandReplyLike, Args = unknown>({
  handle,
  args,
  commandLabel,
  label,
  confirmLabel,
  refusedLabel = "Refused",
  lostLabel = "No reply",
  foundLabel = "Found",
  confirmAriaLabel,
  sentAriaLabel,
  blockedAriaLabel,
  pressed,
  variant = "ghost",
  tone = "neutral",
  icon,
  confirmIcon,
  onPressReady,
  size = "md",
  confirmTone = "go",
  onConfirmed,
  toggle,
  controller,
  disabled,
  title,
  "aria-label": ariaLabel,
  ...rest
}: Readonly<CommandButtonProps<Result, Args>>) {
  const own = useCommandButton({
    handle,
    args,
    commandLabel,
    onConfirmed,
    toggle,
  });
  const {
    phase,
    isSent,
    isArmed,
    isRefused,
    isLost,
    isFound,
    isBlocked,
    isOffline,
    isShowingReason,
    refusalText,
    foundText,
    lossText,
    toggleView,
    hasUnconfirmed,
    hasFailure,
    press,
  } = controller ?? own;

  const hasConfirmStep = confirmLabel !== undefined;
  const sentSentence = commandLabel
    ? `${commandLabel} sent, not yet received`
    : "Sent, not yet received";
  useEffect(() => {
    if (!onPressReady || disabled) return;
    onPressReady(() => press(hasConfirmStep));
    return () => onPressReady(null);
  }, [onPressReady, disabled, press, hasConfirmStep]);

  const resolveBody = (): ReactNode => {
    if (isSent) return SENT_WORD;
    if (isRefused) return refusedLabel;
    if (isLost) return lostLabel;
    if (isFound) return foundLabel;
    // The reason IN the control. It runs long with the numbers at the end, so it must wrap, never truncate.
    if (isShowingReason) return refusalText;
    if (isArmed) return confirmLabel;
    return label;
  };
  const resolved = resolveBody();
  const fitWord = icon !== undefined && typeof resolved === "string";
  const body = fitWord ? (
    <FitLabel label={resolved} icon={isArmed ? (confirmIcon ?? icon) : icon} />
  ) : (
    resolved
  );
  /*
   * A control keeps the width of its widest word (resting, confirm or SENT) in
   * every state, so pressing it never reflows the row it sits in. Only plain-text
   * labels can be measured this way; a node label sizes itself as before.
   */
  const reserve =
    icon === undefined &&
    typeof label === "string" &&
    (confirmLabel === undefined || typeof confirmLabel === "string") &&
    !isRefused &&
    !isLost &&
    !isFound &&
    !isShowingReason;

  // A mounted rail announces every outcome of the commands it holds, so this control's own region stays quiet beside one only when its handle is one of them.
  const railed = useRailAnnounces() && handle.railed === true;
  const outcome = railed
    ? null
    : isRefused
      ? refusalText
      : isLost
        ? lossText
        : isFound
          ? foundText
          : null;

  const filled = pressed === true || isArmed || isRefused;
  const drawnTone = commandTone({
    restTone: variant === "primary" ? tone : "neutral",
    filled,
    isRefused,
    isFound,
    isArmed,
    confirmTone,
    tone,
  });

  if (toggleView) {
    const { marking, sentence } = toggleView;
    // A held or modelled command's mark carries its own sentence, so the tip beside it stays free.
    const markCarriesIt =
      toggleView.confirmation === "held" ||
      toggleView.confirmation === "modelled";
    const toggleTip = isOffline
      ? STREAM_DOWN_TIP
      : ((markCarriesIt ? null : sentence) ?? title);
    return (
      <>
        <Tooltip text={toggleTip}>
          <ToggleButton
            type="button"
            size={size}
            pressed={toggleView.on}
            disabled={disabled || toggleView.unavailable !== null}
            disabledReason={toggleView.unavailable ?? undefined}
            marked={marking}
            aria-label={ariaLabel}
            data-command-phase={phase}
            data-stream={isOffline ? "down" : undefined}
            data-unconfirmed={hasUnconfirmed ? "true" : undefined}
            data-failed={hasFailure ? "true" : undefined}
            onClick={() => press(false)}
            {...rest}
          >
            <ReservedText
              shown={toggleView.word}
              reserve={toggleView.reserve}
            />
          </ToggleButton>
        </Tooltip>
        {/* A held or modelled mark is spoken with the label, so only a press the mod has not answered is announced. */}
        <LiveRegion visuallyHidden>
          {markCarriesIt ? "" : (sentence ?? "")}
        </LiveRegion>
      </>
    );
  }

  const sendStatus = handle.sendStatus;
  const restTip =
    sendStatus === undefined
      ? title
      : [title, describeSendStatus(sendStatus)].filter(Boolean).join("\n");
  const tipText = isOffline
    ? [title, STREAM_DOWN_TIP].filter(Boolean).join("\n")
    : restTip;

  return (
    <>
      <Tooltip
        text={foundText ?? refusalText ?? (isSent ? sentSentence : tipText)}
      >
        <CommandButton__Body
          type="button"
          $tone={drawnTone}
          $variant={variant}
          $fit={fitWord}
          $size={size}
          $pressed={filled}
          $armed={isArmed}
          $blocked={isBlocked}
          aria-pressed={pressed}
          // aria-disabled, not disabled, so the control keeps focus while the outcome lands on it.
          aria-disabled={isBlocked || isOffline || undefined}
          disabled={disabled}
          data-unconfirmed={hasUnconfirmed ? "true" : undefined}
          data-failed={hasFailure ? "true" : undefined}
          data-command-phase={phase}
          data-stream={isOffline ? "down" : undefined}
          data-predicted={
            isBlocked ? undefined : predictedOutcomeOf(sendStatus)
          }
          // A diagnostic hook only: an undetermined gate renders as an ordinary control.
          data-gate={
            isBlocked
              ? "blocked"
              : standingGate(handle, args)?.undetermined
                ? "undetermined"
                : undefined
          }
          /*
           * The accessible name tracks the phase: an outcome's full sentence while
           * it stands, and for armed and sent the visible wording rather than
           * the resting label, which describes a state the control has left.
           */
          aria-label={
            (isRefused
              ? (refusalText ?? undefined)
              : isLost
                ? (lossText ?? undefined)
                : isFound
                  ? (foundText ?? ariaLabel)
                  : isBlocked
                    ? (blockedAriaLabel ?? refusalText ?? ariaLabel)
                    : isSent
                      ? (sentAriaLabel ?? sentSentence)
                      : isArmed
                        ? confirmAriaLabel
                        : ariaLabel) ?? (fitWord ? resolved : undefined)
          }
          onClick={() => press(confirmLabel !== undefined)}
          data-rest-label={reserve ? label : undefined}
          data-armed-label={
            reserve
              ? typeof confirmLabel === "string" &&
                confirmLabel.length > SENT_WORD.length
                ? confirmLabel
                : SENT_WORD
              : undefined
          }
          {...rest}
        >
          {reserve ? <CommandButton__Face>{body}</CommandButton__Face> : body}
        </CommandButton__Body>
      </Tooltip>
      {/* Mounted with the control, so an outcome lands in a region assistive tech is already watching. */}
      <LiveRegion visuallyHidden>{outcome}</LiveRegion>
    </>
  );
}

/** The tone a command draws in: plain at rest, then the tone of the phase it is filled for. */
function commandTone(p: {
  restTone: CommandButtonTone;
  filled: boolean;
  isRefused: boolean;
  isFound: boolean;
  isArmed: boolean;
  confirmTone: CommandButtonTone;
  tone: CommandButtonTone;
}): CommandButtonTone {
  if (!p.filled) return p.restTone;
  if (p.isRefused) return "warn";
  // `found` reverses a warning, so it does not wear the warning's colour.
  if (p.isFound) return "neutral";
  if (p.isArmed) return p.confirmTone;
  return p.tone;
}

const armedPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
`;

const CommandButton__Face = styled.span`
  grid-area: 1 / 1;
  /* First in the cell's order, so the button's baseline is the face's and not an invisible sizer's. */
  order: -1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-glyph);
`;

/* A command at rest is the quiet ghost; in effect, armed or refused it takes the one pressed fill. */
const CommandButton__Body = styled(Button__Body)<{
  $armed: boolean;
  $blocked: boolean;
  $fit: boolean;
}>`
  letter-spacing: 0.04em;

  /* Shrinks below its word so the word can be measured and give way to the icon. */
  ${({ $fit }) => ($fit ? "min-width: 0;" : "")}

  ${({ $armed }) =>
    $armed &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: ${armedPulse} 1s var(--ease-emphasis) infinite;
      }
    `}

  &:disabled {
    opacity: 0.5;
  }

  /* Dimmed toward the muted text token rather than faded, so the refusal reason stays readable; the warn border says the game refused. */
  ${({ $blocked }) =>
    $blocked &&
    css`
      background: transparent;
      border-style: dashed;
      border-color: var(--color-warn-mark);
      color: var(--color-text-muted);
      cursor: help;

      @media (hover: hover) {
        &:hover:not(:disabled) {
          border-color: var(--color-warn-mark);
          color: var(--color-warn-text);
        }
      }
    `}

  /* Both labels sit invisibly in the one grid cell with the face, so the box is as wide as the wider of them. */
  &[data-rest-label] {
    display: inline-grid;
    justify-items: center;
  }
  &[data-rest-label]::before,
  &[data-rest-label]::after {
    grid-area: 1 / 1;
    visibility: hidden;
    height: 0;
  }
  &[data-rest-label]::before {
    content: attr(data-rest-label);
  }
  &[data-rest-label]::after {
    content: attr(data-armed-label);
  }
`;
