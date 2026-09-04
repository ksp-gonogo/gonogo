import { classifyCommandRejection } from "@ksp-gonogo/sitrep-sdk";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styled, { css, keyframes } from "styled-components";
import type { CommandDelayHandle } from "../CommandDelay/CommandDelay";
import { commandLossSentence } from "../CommandDelay/CommandLossList";
import {
  type CommandRefusalLike,
  commandGateSentence,
  commandRefusalSentence,
} from "../CommandDelay/commandRefusalSentence";
import { useCommandFailures } from "../CommandDelay/useCommandFailures";
import { Spinner } from "../Spinner";

/**
 * How long an armed control stays armed before it quietly disarms.
 *
 * The ONE definition. It was spelled out independently in eight widgets, which
 * is one behaviour written eight times and therefore eight things that drift
 * apart; `styleguide-delay-ux.test.ts` fails on a ninth.
 */
export const ARM_TIMEOUT_MS = 4000;

/**
 * How long a refusal stays on the control before it returns to rest. Longer
 * than the arm window because the operator is READING this one, and not forever
 * because the situation the game refused on can change, and a stale "refused"
 * would then be a lie about the present.
 */
export const REFUSAL_TIMEOUT_MS = 8000;

/**
 * The outer backstop on a pending dispatch. `send()`'s promise is guaranteed to
 * settle as of `b09377948`; before that a dropped command's promise never
 * settled at all, which is why the five widgets that wanted a pending state
 * each built telemetry reconciliation instead. This is a belt for a handle from
 * some other source that makes no such guarantee, never the primary clear.
 */
export const PENDING_BACKSTOP_MS = 30_000;

/**
 * What the mod says about this command before it is pressed, as much of it as
 * this control needs.
 *
 * Declared structurally, exactly as {@link CommandButtonHandle} and
 * `CommandDelayHandle` are: ui-kit stays the vanilla design system, and
 * `useCommand`'s `gate` satisfies this shape.
 */
export interface CommandGateLike extends CommandRefusalLike {
  /** The game EVALUATED this and said no. */
  blocked: boolean;
  /**
   * The mod could not evaluate this command's gates at all, so it knows nothing
   * about them. Deliberately NOT a reason to darken the control: an absent
   * authority is not the game's judgement, and in a sandbox save
   * `ScenarioUpgradeableFacilities.Instance` is null by design, so treating this
   * as a refusal would permanently dark a working control with an
   * authoritative-looking sentence. Renders as ordinary, and reports itself
   * through `data-gate` for a diagnostic surface.
   */
  undetermined?: boolean;
}

/**
 * The command handle this control dispatches on: the delay-rail handle plus the
 * one thing a rail never needed, a way to actually send.
 *
 * Declared structurally here rather than imported from
 * `@ksp-gonogo/sitrep-client`, exactly as `CommandDelayHandle` is: ui-kit stays
 * the vanilla design system, and `useCommand`'s real return value satisfies this
 * shape at every call site.
 */
export interface CommandButtonHandle<TResult = unknown>
  extends CommandDelayHandle {
  /**
   * Dispatch. The returned promise resolves when the command is confirmed and
   * rejects when it is refused, lost, or the machinery failed, which is what
   * lets this control clear its own pending state with no per-command telemetry
   * predicate.
   *
   * `TResult` is what it RESOLVES with, and it is the only reason this
   * interface has a type parameter: it is what carries the reply's real type to
   * {@link CommandButtonProps.onConfirmed}. A handle from `useCommand("...")`
   * supplies it out of the generated command map with nothing written at the
   * call site; a hand-built handle that says nothing gets `unknown`, exactly as
   * every handle did before.
   *
   * A method rather than a property holding a function, so a handle whose args
   * are typed from the generated command map is still a handle: as a property,
   * `strictFunctionTypes` checks the parameter contravariantly and every
   * `useCommand("vessel.control.setSas")` stops being assignable here.
   */
  send(
    args?: unknown,
    opts?: { label?: string; topic?: string },
  ): Promise<TResult>;
  /**
   * The standing gate verdict, when the mod publishes one for this command.
   * Absent means nothing is known in advance, which is where every control was
   * before the gate channel existed, so a handle without it behaves as before.
   */
  gate?: CommandGateLike;
}

/**
 * Where the control is in the one command lifecycle.
 *
 * - `idle`: at rest
 * - `armed`: the operator has asked, and is being asked to mean it. Only
 *   reachable when the caller supplied a `confirmLabel`
 * - `pending`: dispatched, nothing back yet. The window signal delay makes real,
 *   and the phase a command button without one cannot express
 * - `refused`: the game evaluated it and said no. A retry changes nothing until
 *   the situation does, so this is a reason rather than a try-again
 * - `lost`: nothing came back. Deliberately NOT folded into `idle`: settling a
 *   dropped command at rest made it byte-identical to a confirmed one, so a
 *   command the engine threw away for a downed link looked exactly like one
 *   that ran. It is also not `refused`, because the game decided nothing and
 *   the command may well have executed; the wording says only what was heard
 * - `blocked`: the game will refuse this, and said so before anyone pressed.
 *   The control is dark and NOT `disabled`, for two reasons. A `disabled`
 *   button is skipped by some screen readers, so a dimmed dead control tells a
 *   screen-reader user that nothing is there at all, which is the same ruling
 *   this repo already made about read-only settings rows. And a gate verdict is
 *   advice, not permission: it is sampled, so it can be a beat stale, and the
 *   dispatch re-evaluates anyway. So it carries `aria-disabled` instead, stays
 *   focusable, and answers a press by SAYING WHY rather than by doing nothing
 */
export type CommandButtonPhase =
  | "idle"
  | "armed"
  | "pending"
  | "refused"
  | "lost"
  | "blocked";

export type CommandButtonTone = "neutral" | "go" | "nogo" | "warn";
export type CommandButtonSize = "sm" | "md";

export interface UseCommandButtonOptions<TResult = unknown> {
  handle: CommandButtonHandle<TResult>;
  args?: unknown;
  commandLabel?: string;
  /** Receives the dispatch's resolved result. See {@link CommandButtonProps.onConfirmed}. */
  onConfirmed?: (result: TResult) => void;
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
  /**
   * The game will refuse this if it is pressed, and said so in advance.
   * `refusalText` carries the reason here too, so a caller renders one string
   * whichever side of the press it is on.
   */
  isBlocked: boolean;
  /**
   * The operator pressed a blocked control and is being told why. The FACT is
   * always on the control (it is dark, and `aria-disabled`); this is the reason
   * made visible on demand, for the sighted keyboard user that a `title` never
   * reaches.
   */
  isShowingReason: boolean;
  /**
   * The composed sentence, or `null` when there is nothing to say: a refusal
   * once one has happened, else the standing gate reason.
   */
  refusalText: string | null;
  /** This handle has a dead (overdue/lost) dispatch, for the `data-failed` tint. */
  hasFailure: boolean;
  /**
   * The control was pressed. Advances the machine: arm, then dispatch; a press
   * while pending is ignored; a press while refused or lost clears that
   * outcome; a press while BLOCKED dispatches nothing and shows the reason
   * instead.
   *
   * `armable` says whether there is a confirm step, which is the caller's
   * decision (it owns the confirm copy), not something this hook can infer.
   */
  press: (armable: boolean) => void;
}

/**
 * The command lifecycle with no rendering attached, for a control whose CHROME
 * genuinely differs: `SpaceCenterStatus`'s facility cells measure their label
 * and collapse it to an icon, `LaunchDirector` colours by verb. Those are real
 * rendering requirements and forcing one look on them would be a worse answer
 * than the duplication it removed.
 *
 * What must never be duplicated is the BEHAVIOUR, which is all of this. A caller
 * here writes no `useState`, no arm timeout, and no reconciliation.
 * `CommandButton` below is this hook plus the default rendering, and is what a
 * caller with no such requirement should use.
 */
export function useCommandButton<TResult = unknown>({
  handle,
  args,
  commandLabel,
  onConfirmed,
}: UseCommandButtonOptions<TResult>): CommandButtonState {
  const [phase, setPhase] = useState<CommandButtonPhase>("idle");
  const [refusal, setRefusal] = useState<CommandRefusalLike | null>(null);
  // A press on a blocked control shows its reason. Local, and cleared on the
  // same window a refusal gets, because it is the same act of reading.
  const [reasonShown, setReasonShown] = useState(false);

  const gate = handle.gate;
  // `blocked` only. An undetermined gate is NOT a refusal: see
  // CommandGateLike.undetermined for why it must not darken anything.
  const gateBlocks = gate?.blocked === true;

  // A dispatch that settles after this control unmounted must not set state, and
  // a SECOND dispatch has to invalidate the first one's answer rather than let a
  // late reply overwrite a fresh pending.
  const mountedRef = useRef(true);
  const dispatchSeqRef = useRef(0);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Auto-disarm, so a forgotten arm does not sit live indefinitely.
  useEffect(() => {
    if (phase !== "armed") return;
    const id = setTimeout(() => setPhase("idle"), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // Let a refusal, or a silence, be read, then return to rest. Both get the
  // same window for the same reason: the operator is READING it, and the
  // situation behind it can change. See REFUSAL_TIMEOUT_MS.
  useEffect(() => {
    if (phase !== "refused" && phase !== "lost") return;
    const id = setTimeout(() => {
      setPhase("idle");
      setRefusal(null);
    }, REFUSAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [phase]);

  // Same window as a refusal: the operator is reading it, and the condition the
  // game named can change, so the reason must not sit there claiming a present
  // that has moved on.
  useEffect(() => {
    if (!reasonShown) return;
    const id = setTimeout(() => setReasonShown(false), REFUSAL_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [reasonShown]);

  // The gate reopening takes the reason down with it: a control that lit up
  // again while still explaining why it was dark would be describing the past.
  useEffect(() => {
    if (!gateBlocks) setReasonShown(false);
  }, [gateBlocks]);

  // Backstop only. See PENDING_BACKSTOP_MS.
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
      (result: TResult) => {
        settle("idle", null);
        onConfirmed?.(result);
      },
      (err: unknown) => {
        const rejection = classifyCommandRejection(err);
        if (rejection.kind === "lost") {
          // Nothing came back, which is neither the game saying no nor a
          // success. It used to settle at `idle` with a null reason, which is
          // the confirmed path exactly, so a dropped command was
          // indistinguishable from one that ran. It says what it heard instead:
          // nothing.
          settle("lost", null);
          return;
        }
        if (rejection.kind !== "refused") {
          // `failed` is the machinery, and the machinery is what the panel rail
          // and the link indicators already speak for. It surfaces through the
          // shared `data-failed` tint, off the handle's own in-flight set.
          settle("idle", null);
          return;
        }
        settle("refused", {
          errorCode: rejection.errorCode,
          command: rejection.command,
          args: rejection.args,
          label: rejection.label ?? commandLabel,
          breach: rejection.breach,
          // The game's own words for this refusal, and the clause
          // `commandRefusalSentence` prefers over anything ui-kit writes.
          // Copying the rejection field by field dropped it, so a refusal that
          // said exactly why came out as the general clause for its coarse code
          // ("the game would not say why" for ModeUnavailable). The blocked path
          // spreads the whole gate and so never lost it, which is why the only
          // `detail` coverage in this component's tests was over there.
          detail: rejection.detail,
        });
      },
    );
  }, [handle, args, commandLabel, onConfirmed]);

  // This handle's own dead dispatches, for the shared `data-failed` tint. The
  // panel-top queue stays the primary failure surface; this only says WHICH
  // control issued the command that died.
  const { hasFailure } = useCommandFailures(handle);

  const press = useCallback(
    (armable: boolean) => {
      if (phase === "pending") return;
      // The game has already said it will refuse this. Dispatching anyway would
      // spend a signal-delay round trip to be told what the control already
      // knows, so the press SAYS WHY instead. Not a dead press: it is the only
      // route to the reason that a sighted keyboard user has, since `title`
      // wants a pointer and `aria-label` wants a screen reader.
      if (gateBlocks) {
        setReasonShown(true);
        return;
      }
      // A refused control is not inert: the operator may well be pressing it
      // again because the situation changed. The press clears the refusal and
      // starts the handshake over rather than dispatching straight back into
      // the same no. A silent one clears the same way, and there the retry is
      // the whole point: nobody knows whether the first attempt landed.
      if (phase === "refused" || phase === "lost") {
        setRefusal(null);
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

  // A REAL refusal outranks a standing gate: it is the more specific answer, and
  // it is about a command the operator actually sent. Pending outranks both,
  // because a command already travelling has not been stopped by a gate that
  // shut behind it.
  const effectivePhase: CommandButtonPhase =
    phase === "pending" || phase === "refused" || phase === "lost"
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
    isBlocked: effectivePhase === "blocked",
    isShowingReason: effectivePhase === "blocked" && reasonShown,
    refusalText: refusal
      ? commandRefusalSentence(refusal)
      : effectivePhase === "blocked" && gate
        ? // The caller's own words for this dispatch, layered on exactly as the
          // refusal path layers them: the mod publishes the gate per COMMAND
          // and has never seen "Hire Valentina Kerman", which is the half that
          // says which row went dark.
          commandGateSentence({
            ...gate,
            label: gate.label ?? commandLabel,
            args: gate.args ?? args,
          })
        : null,
    hasFailure,
    press,
  };
}

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "type" | "children" | "aria-pressed" | "aria-busy"
>;

export interface CommandButtonProps<TResult = unknown>
  extends NativeButtonProps {
  /**
   * The command this control dispatches. Its reply type is what
   * {@link CommandButtonProps.onConfirmed} receives, inferred, so a caller
   * declares nothing to get it.
   */
  handle: CommandButtonHandle<TResult>;
  /** Args for the dispatch, passed straight to `handle.send`. */
  args?: unknown;
  /**
   * The dispatch's operator-facing description. Worth passing: it is what a
   * refusal is NAMED after, so the operator reads "Hire Valentina Kerman
   * refused: ..." rather than a sentence about `career.crew.hire`.
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
   * The label for a dispatch nothing answered. Defaults to "No reply", which is
   * the whole of what is known: not "failed", which claims the machinery broke,
   * and not "refused", which claims the game said no.
   */
  lostLabel?: ReactNode;
  /**
   * The blocked phase's accessible name, for a control whose gate reason is
   * already spelled out beside it (a row that renders the same sentence itself).
   *
   * Omit it and the accessible name becomes the composed gate sentence, which is
   * the deliberate default: a screen-reader user landing on a dark button with
   * its resting name learns that it exists and nothing about why it will not
   * work, and "why" is the whole of what this phase has to give.
   */
  blockedAriaLabel?: string;
  /**
   * The armed phase's accessible name, for a control whose resting
   * `aria-label` says more than its visible word ("Hire Desdin Kerman for
   * 30,000 funds").
   *
   * Omit it and the armed phase carries NO `aria-label`, so the visible confirm
   * wording becomes the accessible name. That is the deliberate default rather
   * than falling back to the resting label: a control that still announces
   * "Hire" after arming has told a screen-reader user nothing happened, and the
   * whole point of the arm is that the next press means something different.
   */
  confirmAriaLabel?: string;
  /** The in-flight phase's accessible name. Same rule as `confirmAriaLabel`. */
  pendingAriaLabel?: string;
  /**
   * Whether this control's command is CURRENTLY IN EFFECT, for a control that
   * represents state as well as acting on it: a SAS toggle, an action group, an
   * activated strategy. Sets `aria-pressed` and the active fill.
   *
   * Leave it undefined for a control that only acts. That is the whole of the
   * difference between a "toggle button" and a "command button", so it is a
   * property of one control rather than a second component.
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
   * Receives whatever the dispatch RESOLVED with, TYPED off the handle. Worth
   * reading, because a confirmed command is not always a command that did
   * something: a mod that de-duplicates on request id answers a repeat with the
   * receipt it stored the first time, and the receipt is the only place a repeat
   * is distinguishable from a fresh write. A caller that ignores the argument
   * behaves exactly as it did.
   *
   * The type is the point. This was `(result: unknown) => void`, and `unknown`
   * accepts every reader, including one that reads the command ENVELOPE as if it
   * were the payload the envelope wraps. Seven controls across one Uplink did
   * exactly that, reading a receipt's fields off the `CommandResult` that
   * carries it: every one came back `undefined`, so every write reported success
   * and the "nothing was written" banner those fields exist to raise could not
   * fire at all. The reply type reaching here is what makes that reach a compile
   * error instead of a silent `undefined`.
   */
  onConfirmed?: (result: TResult) => void;
}

/**
 * The one command control. Arm, confirm, in-flight and refused are a single
 * state machine, and it lives here rather than once per widget.
 *
 * Every command has a real in-flight window under signal delay, so every command
 * button can express one; a button that cannot is claiming the command already
 * landed. The panel delay rail says SOMETHING is in flight, which in a list of
 * twenty applicants does not say which row the operator committed. This says it
 * at the control.
 *
 * Pending clears on `send()`'s own promise, not on a telemetry predicate. That
 * is the load-bearing choice: a predicate has to be written per command
 * ("`tarName` matches", "`hasData` went false", "the node flipped"), which is
 * why the widgets that had a pending state each hand-rolled a different one and
 * the rest had none. The promise is command-agnostic, and settles even for a
 * command with no observable telemetry consequence at all.
 *
 * Pending is per RENDERED CONTROL, not per handle. One `useCommand` handle
 * serving a list of rows gives each row its own pending state here, which is
 * what the widgets tracking a `pendingId` by hand were reaching for.
 *
 * The caller still calls `usePanelDelay(handle)` itself, and this component
 * deliberately does not: `usePanelDelay` registers the handle under an identity
 * of its own, so a per-row control calling it would enter one command into the
 * rail once per row. Leaving it to the caller also leaves `useCommand`'s
 * must-consume assertion doing its job, so a widget that renders a
 * `CommandButton` and forgets the rail still throws on the first dispatch.
 */
export function CommandButton<TResult = unknown>({
  handle,
  args,
  commandLabel,
  label,
  confirmLabel,
  pendingLabel = "Working...",
  refusedLabel = "Refused",
  lostLabel = "No reply",
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
}: Readonly<CommandButtonProps<TResult>>) {
  const {
    phase,
    isPending,
    isArmed,
    isRefused,
    isLost,
    isBlocked,
    isShowingReason,
    refusalText,
    hasFailure,
    press,
  } = useCommandButton({ handle, args, commandLabel, onConfirmed });

  let body: ReactNode = label;
  if (isPending) {
    body = (
      <>
        <Spinner size={size === "sm" ? 10 : 12} /> {pendingLabel}
      </>
    );
  } else if (isRefused) {
    body = refusedLabel;
  } else if (isLost) {
    body = lostLabel;
  } else if (isShowingReason) {
    // The reason IN the control, not only in its title and its accessible name.
    // A gate sentence runs to about a hundred characters and the numbers are at
    // the end, so whatever lays this out has to wrap rather than truncate: see
    // commandRefusalSentence's own note.
    body = refusalText;
  } else if (isArmed) {
    body = confirmLabel;
  }

  return (
    <CommandButton__Body
      type="button"
      $tone={isRefused || isLost ? "warn" : isArmed ? confirmTone : tone}
      $size={size}
      $filled={active === true || isArmed || isRefused}
      $armed={isArmed}
      $blocked={isBlocked}
      aria-pressed={active}
      // Only while it IS busy: a permanent `aria-busy="false"` on every command
      // button in the tree is noise a screen reader has to step over.
      aria-busy={isPending || undefined}
      // aria-disabled, NOT disabled. A `disabled` button is dropped from some
      // screen readers' walk entirely, so an operator using one would find no
      // control at all where a sighted operator sees a dark one with a reason on
      // it: the same reasoning that stopped a read-only settings row being a
      // disabled input. It also keeps the control focusable, which is what lets
      // a press surface the reason.
      aria-disabled={isBlocked || undefined}
      disabled={disabled || isPending}
      data-failed={hasFailure ? "true" : undefined}
      data-command-phase={phase}
      // Reports itself without changing how it renders: the operator sees an
      // ordinary control, and a diagnostic surface can still find every command
      // the mod could not judge. `undetermined` never wins over `blocked`,
      // because a verdict is one or the other.
      data-gate={
        isBlocked
          ? "blocked"
          : handle.gate?.undetermined
            ? "undetermined"
            : undefined
      }
      // The accessible name TRACKS THE PHASE. A refusal sentence names the
      // command and the numbers behind the no, so it is the name while it
      // stands: a screen-reader user landing on a button reading "Refused"
      // learns nothing from the word. Armed and pending fall back to undefined
      // rather than to the resting label, so the visible phase wording speaks
      // instead of a name that describes a state the control has left.
      aria-label={
        isRefused
          ? (refusalText ?? undefined)
          : isLost
            ? // The visible words are two and the fact needs a sentence: a
              // screen-reader user landing on "No reply" learns that something
              // is up and nothing about what is unknown. The handle carries no
              // command id, so `commandLabel` is what names this one, the same
              // half a refusal is named after.
              commandLossSentence({ args, label: commandLabel })
            : isBlocked
              ? // Same rule as a refusal: the sentence names the command and the
                // numbers behind the no, and the resting name says none of that.
                (blockedAriaLabel ?? refusalText ?? ariaLabel)
              : isPending
                ? pendingAriaLabel
                : isArmed
                  ? confirmAriaLabel
                  : ariaLabel
      }
      title={refusalText ?? title}
      onClick={() => press(confirmLabel !== undefined)}
      {...rest}
    >
      {body}
    </CommandButton__Body>
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
    font-size: var(--font-size-2xs, 10px);
    padding: var(--space-2, 2px) var(--space-8, 8px);
  `,
  md: css`
    font-size: var(--font-size-sm);
    padding: var(--space-6, 6px) var(--space-12, 12px);
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
  gap: var(--space-4, 4px);
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0.04em;
  border-radius: var(--radius-sm, 3px);
  cursor: pointer;
  transition: background var(--duration-fast, 100ms),
    border-color var(--duration-fast, 100ms),
    color var(--duration-fast, 100ms);

  background: transparent;
  border: 1px solid var(--color-border-subtle);
  color: var(--color-text-muted);

  ${({ $size }) => SIZE_STYLES[$size]}

  /* Filled when the control is showing a state (active), asking for a commit
     (armed), or reporting a refusal. At rest it stays the quiet outline: a row
     of eight filled buttons is a row with no emphasis left to spend. */
  ${({ $filled, $tone }) => ($filled ? TONE_FILLED[$tone] : "")}

  ${({ $armed }) =>
    $armed &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: ${armedPulse} 1s var(--ease-emphasis, ease-in-out) infinite;
      }
    `}

  @media (hover: hover) {
    &:hover:not(:disabled) {
      border-color: var(--color-text-faint);
      color: var(--color-text-primary);
    }
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus);
    outline-offset: 2px;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Dark, and readable while dark. The gate has said no, so the control must
     not read as available, but it is still the thing carrying the reason: at
     0.5 opacity the sentence it shows on a press would fail contrast, so this
     dims toward the muted text token instead of fading the whole control out.
     The warn border is what separates "the game says no" from "there is nothing
     here", which a plain grey-out cannot say. */
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
          color: var(--color-status-warning-fg);
        }
      }
    `}

  /* The command is IN FLIGHT, not unavailable: it reads at full strength with a
     spinner rather than as the greyed-out "you cannot do this" that a plain
     :disabled would say. */
  &[aria-busy="true"]:disabled {
    opacity: 1;
    cursor: progress;
  }

  /* The shared \`data-failed\` convention (see ToggleButton): a control whose
     command went overdue or lost echoes it on itself, so the operator sees WHICH
     control's command died without leaving the panel rail. */
  &[data-failed="true"] {
    border-color: var(--color-status-warning-bg);
    color: var(--color-status-warning-fg);
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
        ? "var(--space-6) var(--space-10)"
        : "var(--space-8) var(--space-16)"};
  }
`;
