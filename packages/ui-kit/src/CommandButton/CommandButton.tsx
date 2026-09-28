import { classifyCommandRejection } from "@ksp-gonogo/sitrep-sdk";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import type { CommandDelayHandle } from "../CommandDelay/CommandDelay";
import { commandFailures } from "../CommandDelay/commandFailures";
import {
  type CommandFoundLike,
  commandFoundSentence,
} from "../CommandDelay/commandFoundSentence";
import { commandLossSentence } from "../CommandDelay/commandLossSentence";
import {
  type CommandRefusalLike,
  commandGateSentence,
  commandRefusalSentence,
} from "../CommandDelay/commandRefusalSentence";
import { focusRing } from "../focusRing";
import { LiveRegion } from "../LiveRegion";
import { Spinner } from "../Spinner";

/** How long an armed control stays armed before it quietly disarms. The ONE definition. */
export const ARM_TIMEOUT_MS = 4000;

/**
 * How long a refusal stays on the control before it returns to rest: long
 * enough to read, not forever, because the situation the game refused on can
 * change.
 */
export const REFUSAL_TIMEOUT_MS = 8000;

/**
 * The outer backstop on a pending dispatch. `send()`'s promise is guaranteed
 * to settle; this is a belt for a handle from some other source that makes
 * no such guarantee, never the primary clear.
 */
export const PENDING_BACKSTOP_MS = 30_000;

/** What the mod says about this command before it is pressed, declared structurally; `useCommand`'s `gate` satisfies it. */
export interface CommandGateLike extends CommandRefusalLike {
  /** The game EVALUATED this and said no. */
  blocked: boolean;
  /**
   * The mod could not evaluate this command's gates at all. NOT a reason to
   * darken the control (a sandbox save has no facility authority by design):
   * it renders as ordinary and reports itself through `data-gate`.
   */
  undetermined?: boolean;
}

/**
 * What a command reply is known to be BEFORE you know which command produced
 * it: the result envelope, carrying the command's own value on `payload`. The
 * default {@link CommandButtonHandle} reply, so a reader cannot treat the
 * envelope as the payload; `payload` stays `unknown` until narrowed.
 */
export interface CommandReplyLike {
  /** Whether the command ran. False pairs with the refusal the handle surfaces. */
  success: boolean;
  /** The command's own value, when it has one. `unknown` until the reader knows which command this is. */
  payload?: unknown;
}

/**
 * The command handle this control dispatches on: the delay-rail handle plus a
 * way to send. Declared structurally; `useCommand`'s return value satisfies it.
 */
export interface CommandButtonHandle<Result = CommandReplyLike, Args = unknown>
  extends CommandDelayHandle {
  /**
   * Dispatch. The promise resolves when the command is confirmed and rejects
   * when it is refused, lost, or the machinery failed, so the control clears its
   * own pending state with no per-command telemetry predicate.
   *
   * `Result` carries the reply's real type to
   * {@link CommandButtonProps.onConfirmed}; a handle from `useCommand("...")`
   * supplies it from the generated command map.
   *
   * A method rather than a function-valued property, so `strictFunctionTypes`
   * does not check typed args contravariantly and reject every typed handle.
   */
  send(args?: Args, opts?: { label?: string; topic?: string }): Promise<Result>;
  /**
   * The standing gate verdict, when the mod publishes one for this command.
   * Absent means nothing is known in advance.
   */
  gate?: CommandGateLike;
}

/**
 * Where the control is in the one command lifecycle.
 *
 * - `idle`: at rest
 * - `armed`: the operator has asked, and is being asked to mean it. Only
 *   reachable when the caller supplied a `confirmLabel`
 * - `pending`: dispatched, nothing back yet (the signal-delay window)
 * - `refused`: the game evaluated it and said no. A retry changes nothing until
 *   the situation does
 * - `lost`: nothing came back. Not `idle`, which would look like a confirmed
 *   command, and not `refused`, because the game decided nothing and the
 *   command may have executed
 * - `found`: this control lost a command, and that command has since answered.
 *   Not a confirmation: the operator may already have re-sent it
 * - `blocked`: the game will refuse this, and said so before anyone pressed.
 *   The control is dark but NOT `disabled`: it carries `aria-disabled`, stays
 *   focusable, and answers a press by saying why. A gate verdict is advice,
 *   sampled and possibly a beat stale, and the dispatch re-evaluates anyway
 */
export type CommandButtonPhase =
  | "idle"
  | "armed"
  | "pending"
  | "refused"
  | "lost"
  | "found"
  | "blocked";

export type CommandButtonTone = "neutral" | "go" | "nogo" | "warn";
export type CommandButtonSize = "sm" | "md";

export interface UseCommandButtonOptions<
  Result = CommandReplyLike,
  Args = unknown,
> {
  handle: CommandButtonHandle<Result, Args>;
  /** See {@link CommandButtonProps.args}, including why this is `NoInfer`. */
  args?: NoInfer<Args>;
  commandLabel?: string;
  /** Receives the dispatch's resolved result. See {@link CommandButtonProps.onConfirmed}. */
  onConfirmed?: (result: Result) => void;
}

export interface CommandButtonState {
  phase: CommandButtonPhase;
  /** Dispatched, nothing back. */
  isPending: boolean;
  /** Asking the operator to mean it. */
  isArmed: boolean;
  /** The game said no, and `refusalText` says what it said. */
  isRefused: boolean;
  /** Nothing came back. Not a verdict, and not the same as at rest. */
  isLost: boolean;
  /** A command this control lost has since answered. `foundText` says what it said. */
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
  /** This handle has a dead (overdue/lost) dispatch, for the `data-failed` tint. */
  hasFailure: boolean;
  /**
   * The control was pressed. Advances the machine: arm, then dispatch; a press
   * while pending is ignored; a press while refused, lost or found clears that
   * outcome; a press while BLOCKED dispatches nothing and shows the reason
   * instead. `armable` says whether there is a confirm step, which only the
   * caller knows.
   */
  press: (armable: boolean) => void;
}

/**
 * The command lifecycle with no rendering attached, for a control whose chrome
 * genuinely differs. The behaviour is never duplicated: a caller writes no
 * `useState`, no arm timeout and no reconciliation. `CommandButton` is this
 * hook plus the default rendering.
 */
export function useCommandButton<Result = CommandReplyLike, Args = unknown>({
  handle,
  args,
  commandLabel,
  onConfirmed,
}: UseCommandButtonOptions<Result, Args>): CommandButtonState {
  const [phase, setPhase] = useState<CommandButtonPhase>("idle");
  const [refusal, setRefusal] = useState<CommandRefusalLike | null>(null);
  const [found, setFound] = useState<CommandFoundLike | null>(null);
  // A press on a blocked control shows its reason, cleared on the refusal window.
  const [reasonShown, setReasonShown] = useState(false);

  const gate = handle.gate;
  // An undetermined gate is NOT a refusal and must not darken anything.
  const gateBlocks = gate?.blocked === true;

  // A late reply must not set state after unmount or overwrite a newer dispatch's pending.
  const mountedRef = useRef(true);
  const dispatchSeqRef = useRef(0);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  /*
   * A command THIS control lost, turning up answered. One handle often serves
   * many rows, so the phase is gated on `awaitingFoundRef` (set when this
   * control's own dispatch settled lost). Watched off the handle, because the
   * dispatch promise already rejected as lost and never settles again.
   */
  const founds = handle.founds;
  const awaitingFoundRef = useRef(false);
  const foundsSeenRef = useRef(founds?.length ?? 0);
  useEffect(() => {
    const count = founds?.length ?? 0;
    const grew = count > foundsSeenRef.current;
    foundsSeenRef.current = count;
    const latest = founds?.[count - 1];
    if (!grew || !latest || !awaitingFoundRef.current) return;
    awaitingFoundRef.current = false;
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
    if (!gateBlocks) setReasonShown(false);
  }, [gateBlocks]);

  useEffect(() => {
    if (phase !== "pending") return;
    const id = setTimeout(() => setPhase("idle"), PENDING_BACKSTOP_MS);
    return () => clearTimeout(id);
  }, [phase]);

  const dispatch = useCallback(() => {
    const seq = dispatchSeqRef.current + 1;
    dispatchSeqRef.current = seq;
    setPhase("pending");
    setRefusal(null);
    const settle = (
      next: CommandButtonPhase,
      reason: CommandRefusalLike | null,
    ) => {
      if (!mountedRef.current || dispatchSeqRef.current !== seq) return;
      setRefusal(reason);
      setPhase(next);
    };
    handle.send(args, commandLabel ? { label: commandLabel } : undefined).then(
      (result: Result) => {
        settle("idle", null);
        onConfirmed?.(result);
      },
      (err: unknown) => {
        const rejection = classifyCommandRejection(err);
        if (rejection.kind === "lost") {
          // From here on, a found landing on the handle is this control's.
          awaitingFoundRef.current = true;
          settle("lost", null);
          return;
        }
        if (rejection.kind !== "refused") {
          // A machinery failure is the rail's to report; here it is only the `data-failed` tint.
          settle("idle", null);
          return;
        }
        settle("refused", {
          errorCode: rejection.errorCode,
          command: rejection.command,
          args: rejection.args,
          label: rejection.label ?? commandLabel,
          breach: rejection.breach,
          // The game's own words, which `commandRefusalSentence` prefers over its general clause.
          detail: rejection.detail,
        });
      },
    );
  }, [handle, args, commandLabel, onConfirmed]);

  // The rail is the primary failure surface; this tint only says WHICH control issued the command that died.
  const { hasFailure } = commandFailures(handle);

  const press = useCallback(
    (armable: boolean) => {
      if (phase === "pending") return;
      // The game already said it will refuse this, so the press shows why instead of spending a round trip.
      if (gateBlocks) {
        setReasonShown(true);
        return;
      }
      // A press on an outcome clears it and starts the handshake over, rather than dispatching straight back.
      if (phase === "refused" || phase === "lost" || phase === "found") {
        setRefusal(null);
        setFound(null);
        setPhase("idle");
        return;
      }
      if (armable && phase !== "armed") {
        setPhase("armed");
        return;
      }
      dispatch();
    },
    [phase, gateBlocks, dispatch],
  );

  // A real outcome outranks a standing gate, and a command already travelling is not stopped by a gate that shut behind it.
  const effectivePhase: CommandButtonPhase =
    phase === "pending" ||
    phase === "refused" ||
    phase === "lost" ||
    phase === "found"
      ? phase
      : gateBlocks
        ? "blocked"
        : phase;

  return {
    phase: effectivePhase,
    isPending: effectivePhase === "pending",
    isArmed: effectivePhase === "armed",
    isRefused: effectivePhase === "refused",
    isLost: effectivePhase === "lost",
    isFound: effectivePhase === "found",
    isBlocked: effectivePhase === "blocked",
    isShowingReason: effectivePhase === "blocked" && reasonShown,
    refusalText: refusal
      ? commandRefusalSentence(refusal)
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
    hasFailure,
    press,
  };
}

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type" | "children" | "aria-pressed" | "aria-busy"
>;

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
  /** The resting label. */
  label: ReactNode;
  /**
   * The armed label. Supplying it makes this an arm-then-confirm control: the
   * first click arms, the second dispatches, and an arm left alone expires after
   * {@link ARM_TIMEOUT_MS}. Omit it for a control that dispatches on one click.
   *
   * Arm anything irreversible, and anything that spends career funds.
   */
  confirmLabel?: ReactNode;
  /** The in-flight label. Defaults to "Working...". */
  pendingLabel?: ReactNode;
  /** The refused label. Defaults to "Refused". */
  refusedLabel?: ReactNode;
  /**
   * The label for a dispatch nothing answered. Defaults to "No reply": not
   * "failed" and not "refused", neither of which is known.
   */
  lostLabel?: ReactNode;
  /**
   * The label for a command this control lost that has since answered.
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
  /** The in-flight phase's accessible name. Same rule as `confirmAriaLabel`. */
  pendingAriaLabel?: string;
  /**
   * Whether this control's command is CURRENTLY IN EFFECT, for a control that
   * represents state as well as acting on it: a SAS toggle, an action group, an
   * activated strategy. Sets `aria-pressed` and the active fill. Leave it
   * undefined for a control that only acts.
   */
  active?: boolean;
  tone?: CommandButtonTone;
  size?: CommandButtonSize;
  /** Tone for the armed phase. Defaults to `go`: confirm reads as commit. */
  confirmTone?: CommandButtonTone;
  /**
   * Called once a dispatch is confirmed, for a caller with local state to
   * settle. The pending state itself needs nothing from you.
   *
   * Receives what the dispatch resolved with, typed off the handle. A confirmed
   * command did not necessarily do something: a mod that de-duplicates on
   * request id answers a repeat with the receipt it stored the first time. The
   * value is the reply envelope; the command's own value is on `payload`.
   */
  onConfirmed?: (result: Result) => void;
}

/**
 * The one command control: arm, confirm, in-flight and refused as a single
 * state machine. The panel delay rail says something is in flight; this says
 * which control committed it.
 *
 * Pending clears on `send()`'s own promise, not on a telemetry predicate, so it
 * is command-agnostic and settles even for a command with no observable
 * telemetry consequence. Pending is per RENDERED CONTROL, not per handle, so
 * one handle serving a list gives each row its own pending state.
 *
 * The caller calls `usePanelDelay(handle)` itself: a per-row control calling it
 * would enter one command into the rail once per row.
 */
export function CommandButton<Result = CommandReplyLike, Args = unknown>({
  handle,
  args,
  commandLabel,
  label,
  confirmLabel,
  pendingLabel = "Working...",
  refusedLabel = "Refused",
  lostLabel = "No reply",
  foundLabel = "Found",
  confirmAriaLabel,
  pendingAriaLabel,
  blockedAriaLabel,
  active,
  tone = "neutral",
  size = "md",
  confirmTone = "go",
  onConfirmed,
  disabled,
  title,
  "aria-label": ariaLabel,
  ...rest
}: Readonly<CommandButtonProps<Result, Args>>) {
  const {
    phase,
    isPending,
    isArmed,
    isRefused,
    isLost,
    isFound,
    isBlocked,
    isShowingReason,
    refusalText,
    foundText,
    lossText,
    hasFailure,
    press,
  } = useCommandButton({ handle, args, commandLabel, onConfirmed });

  const resolveBody = (): ReactNode => {
    if (isPending)
      return (
        <>
          <Spinner size={size === "sm" ? 10 : 12} /> {pendingLabel}
        </>
      );
    if (isRefused) return refusedLabel;
    if (isLost) return lostLabel;
    if (isFound) return foundLabel;
    // The reason IN the control. It runs long with the numbers at the end, so it must wrap, never truncate.
    if (isShowingReason) return refusalText;
    if (isArmed) return confirmLabel;
    return label;
  };
  const body = resolveBody();

  const outcome = isRefused
    ? refusalText
    : isLost
      ? lossText
      : isFound
        ? foundText
        : null;

  return (
    <>
      <CommandButton__Body
        type="button"
        // `found` reverses a warning, so it does not wear the warning's colour.
        $tone={
          isRefused
            ? "warn"
            : isFound
              ? "neutral"
              : isArmed
                ? confirmTone
                : tone
        }
        $size={size}
        $filled={active === true || isArmed || isRefused}
        $armed={isArmed}
        $blocked={isBlocked}
        aria-pressed={active}
        aria-busy={isPending || undefined}
        // aria-disabled, not disabled, so the control keeps focus while the outcome lands on it.
        aria-disabled={isBlocked || isPending || undefined}
        disabled={disabled}
        data-failed={hasFailure ? "true" : undefined}
        data-command-phase={phase}
        // A diagnostic hook only: an undetermined gate renders as an ordinary control.
        data-gate={
          isBlocked
            ? "blocked"
            : handle.gate?.undetermined
              ? "undetermined"
              : undefined
        }
        /*
         * The accessible name tracks the phase: an outcome's full sentence while
         * it stands, and for armed and pending the visible wording rather than
         * the resting label, which describes a state the control has left.
         */
        aria-label={
          isRefused
            ? (refusalText ?? undefined)
            : isLost
              ? (lossText ?? undefined)
              : isFound
                ? (foundText ?? ariaLabel)
                : isBlocked
                  ? (blockedAriaLabel ?? refusalText ?? ariaLabel)
                  : isPending
                    ? pendingAriaLabel
                    : isArmed
                      ? confirmAriaLabel
                      : ariaLabel
        }
        title={foundText ?? refusalText ?? title}
        onClick={() => press(confirmLabel !== undefined)}
        {...rest}
      >
        {body}
      </CommandButton__Body>
      {/* Mounted with the control, so an outcome lands in a region assistive tech is already watching. */}
      <LiveRegion visuallyHidden>{outcome}</LiveRegion>
    </>
  );
}

const armedPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
`;

const TONE_FILLED = {
  neutral: css`
    background: var(--color-surface-raised);
    border-color: var(--color-border-subtle);
    color: var(--color-text-primary);
  `,
  go: css`
    background: var(--color-status-go-bg);
    border-color: var(--color-status-go-bg);
    color: var(--color-status-go-fg);
  `,
  nogo: css`
    background: var(--color-status-nogo-bg);
    border-color: var(--color-status-nogo-bg);
    color: var(--color-status-nogo-on-bg);
  `,
  warn: css`
    background: var(--color-status-warning-bg);
    border-color: var(--color-status-warning-bg);
    color: var(--color-status-warning-fg);
  `,
} as const;

const SIZE_STYLES = {
  sm: css`
    font-size: var(--font-size-caption);
    padding: var(--inset-control-small);
  `,
  md: css`
    font-size: var(--font-size-compact);
    padding: var(--inset-control);
  `,
} as const;

const CommandButton__Body = styled.button<{
  $tone: CommandButtonTone;
  $size: CommandButtonSize;
  $filled: boolean;
  $armed: boolean;
  $blocked: boolean;
}>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--gap-glyph);
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0.04em;
  border-radius: var(--radius-regular);
  cursor: pointer;
  transition: background var(--duration-fast),
    border-color var(--duration-fast),
    color var(--duration-fast);

  background: transparent;
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);

  ${({ $size }) => SIZE_STYLES[$size]}

  /* Filled only when active, armed or refused; at rest it stays the quiet outline. */
  ${({ $filled, $tone }) => ($filled ? TONE_FILLED[$tone] : "")}

  ${({ $armed }) =>
    $armed &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: ${armedPulse} 1s var(--ease-emphasis) infinite;
      }
    `}

  @media (hover: hover) {
    &:hover:not(:disabled) {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }

  ${focusRing}

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Dimmed toward the muted text token rather than faded, so the refusal reason stays readable; the warn border says the game refused. */
  ${({ $blocked }) =>
    $blocked &&
    css`
      border-style: dashed;
      border-color: var(--color-status-warning-bg);
      color: var(--color-text-muted);
      cursor: help;

      @media (hover: hover) {
        &:hover:not(:disabled) {
          border-color: var(--color-status-warning-bg);
          color: var(--color-status-warning-fg-muted);
        }
      }
    `}

  /* In flight, not unavailable: full strength with a spinner. */
  &[aria-busy="true"] {
    opacity: 1;
    cursor: progress;
  }

  &[data-failed="true"] {
    border-color: var(--color-status-warning-bg);
    color: var(--color-status-warning-fg-muted);
    background: color-mix(
      in srgb,
      var(--color-status-warning-bg) 18%,
      var(--color-surface-raised)
    );
  }

  @media (pointer: coarse) {
    min-height: 44px;
    padding: ${({ $size }) =>
      $size === "sm"
        ? "var(--inset-control-small-touch)"
        : "var(--inset-control-touch)"};
  }
`;
