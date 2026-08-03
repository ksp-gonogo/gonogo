/**
 * Lead-compensated automatic commands: an automatic command that should take
 * EFFECT at game-UT `targetUt` must be DISPATCHED at `targetUt - oneWayDelay`,
 * so it arrives at the craft on time under signal delay. This reuses the delay
 * machinery (`DelayAuthority` via the shared `ViewClock`), the game-UT clock
 * (`useUtNow`), and the command Courier (`useCommand`): no new physics.
 */

import { useEffect, useRef, useState } from "react";
import type { CommsDelayLike } from "./command-delay";
import { useUtNow } from "./context";
import { useCommand } from "./use-command";
import { useLatestValue } from "./use-stream";

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
  const commsDelay = useLatestValue<CommsDelayLike>("comms.delay");
  const { send } = useCommand(command);
  // `comms.delay.oneWaySeconds` (the SignalDelay capability, same source
  // `DelayAuthority` reads) is the ACTIVE-VESSEL one-way delay today. Per-vessel
  // delay is being designed; an auto-command for a NON-active vessel will
  // eventually want THAT vessel's delay. Active-vessel delay is correct for v1
  // (do not parameterise for per-vessel yet). null/absent/invalid → 0 (LAN /
  // no-path: dispatch at the event itself, no lead needed).
  const raw = commsDelay?.oneWaySeconds;
  const delaySeconds =
    typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;

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
  };
}
