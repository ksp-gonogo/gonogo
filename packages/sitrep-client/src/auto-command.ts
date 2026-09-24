/**
 * Lead-compensated automatic commands: an automatic command that should take
 * EFFECT at game-UT `targetUt` must be DISPATCHED at `targetUt - oneWayDelay`,
 * so it arrives at the craft on time under signal delay. This reuses the delay
 * machinery (`DelayAuthority` via the shared `ViewClock`), the game-UT clock
 * (`useUtNow`), and the command Courier (`useCommand`): no new physics.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useUtNow, useViewClockOptional } from "./context";
import { type UseCommandResult, useCommand } from "./use-command";

/** The fire/skip/wait verdict for a lead-compensated dispatch on a given tick. */
export type AutoDispatchDecision = "wait" | "fire" | "skip-past";

/**
 * Pure decision for one game-UT tick. Dispatch when the ground-station UT
 * (`utNow`, the undelayed `ViewClock.utNowEstimate()`) reaches the lead point
 * `targetUt - delaySeconds`, so the command arrives at `targetUt` after one
 * one-way delay. If armed after the lead point but before the event, fire
 * immediately (the event is still ahead); if the event itself is already past,
 * skip (dispatching now would only arrive later still).
 */
export function decideAutoDispatch(
  utNow: number,
  targetUt: number,
  delaySeconds: number,
): AutoDispatchDecision {
  if (utNow > targetUt) return "skip-past";
  if (utNow >= targetUt - delaySeconds) return "fire";
  return "wait";
}

export interface AutoCommandOptions {
  /** Command id, dispatched through the Courier via `useCommand`. */
  command: string;
  /** Command args (plain, per `useCommand.send`). */
  args?: unknown;
  /** Game-UT the command should take EFFECT on the craft. */
  targetUt: number;
  /** Arm the auto-command. Default true; false holds it disarmed. */
  enabled?: boolean;
  /** Called once if the event was already past when armed (no dispatch made). */
  onSkip?: () => void;
}

export interface AutoCommandStatus {
  /** The command was dispatched (fired) once. */
  fired: boolean;
  /** The event was already past when armed; nothing was dispatched. */
  skipped: boolean;
  /** The game-UT this will dispatch at: `targetUt - current one-way delay`. */
  dispatchUt: number;
  /**
   * The underlying command handle. The consumer MUST render
   * `<CommandDelay handle={status.command} />` so the auto-dispatched command's
   * signal-delay UX is shown, this hook dispatches on a schedule rather than a
   * click, but the same must-consume invariant applies (it does not render its
   * own delay UX, so it can't self-consume like `useControlStream`).
   */
  command: UseCommandResult;
}

/**
 * Arm a lead-compensated automatic command: dispatch `command` through the
 * Courier the first game-UT tick that `utNow >= targetUt - oneWayDelay`, so it
 * arrives at the craft at `targetUt`. Watches `useUtNow` (the undelayed
 * ground-station UT) and recomputes the one-way delay each tick (it drifts as
 * the craft moves). Fires EXACTLY ONCE; re-arms when the command/target/enabled
 * identity changes. If armed after the event has already passed, it skips
 * (surfaced via `onSkip` + `skipped`) rather than dispatching a doomed-late
 * command.
 */
export function useAutoCommand({
  command,
  args,
  targetUt,
  enabled = true,
  onSkip,
}: AutoCommandOptions): AutoCommandStatus {
  const utNow = useUtNow();
  const delaySeconds = useLeadSeconds();
  const cmd = useCommand(command);
  const { send } = cmd;

  // Ref guard for the single dispatch (StrictMode-safe); `phase` mirrors it for
  // the reactive return.
  const settled = useRef(false);
  const [phase, setPhase] = useState<"armed" | "fired" | "skipped">("armed");

  // Re-arm on a fresh target/command (or an enabled flip). The deps are re-arm
  // TRIGGERS (a changed identity resets the one-shot), not values read in the
  // body, which is exactly what the exhaustive-deps rule can't see here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional re-arm triggers, not body inputs
  useEffect(() => {
    settled.current = false;
    setPhase("armed");
  }, [command, targetUt, enabled]);

  useEffect(() => {
    if (!enabled || settled.current || utNow === undefined) return;
    const decision = decideAutoDispatch(utNow, targetUt, delaySeconds);
    if (decision === "wait") return;
    settled.current = true;
    if (decision === "fire") {
      setPhase("fired");
      void send(args).catch(() => {});
    } else {
      setPhase("skipped");
      onSkip?.();
    }
  }, [enabled, utNow, targetUt, delaySeconds, send, args, onSkip]);

  return {
    fired: phase === "fired",
    skipped: phase === "skipped",
    dispatchUt: targetUt - delaySeconds,
    command: cmd,
  };
}

/**
 * The one-way delay a command dispatched from this session travels under: the
 * view clock's own delay. The mod times a command from the session's vantage
 * by the same ledger row it times that vantage's telemetry by, and
 * `DelayAuthority` restates that row for the clock: the issuing centre's own
 * delay where it has one, the whole-network `comms.delay` where it has none,
 * zero aboard the craft itself, and the last measured delay held through a
 * reading with no path. So the lead, the clock and the header cannot disagree.
 */
function useLeadSeconds(): number {
  const clock = useViewClockOptional();
  const seconds = useSyncExternalStore(
    useCallback(
      (onChange: () => void) => clock?.onFrame(onChange) ?? (() => {}),
      [clock],
    ),
    useCallback(() => clock?.delaySeconds() ?? 0, [clock]),
  );
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
