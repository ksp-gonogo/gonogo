import { useEffect, useReducer, useSyncExternalStore } from "react";
import {
  stageCountdownNow,
  stageCountdownStore,
} from "./spine/stage-countdown-store";

/**
 * How a countdown finished: the poll said go and the countdown ran out, or somebody aborted it.
 *
 * @category Mission control
 */
export type GoNoGoCountdownEnd = "go" | "aborted";

/**
 * The countdown of a GO/NO-GO poll.
 *
 * @category Mission control
 */
export interface GoNoGoCountdown {
  /** True while the countdown is running. */
  running: boolean;
  /** Seconds left until T-0, 0 once it has ended. */
  remainingSeconds: number;
  /** The whole length of the countdown, in seconds. */
  lengthSeconds: number;
  /** How it finished, or null while it is running. */
  ended: GoNoGoCountdownEnd | null;
}

/**
 * The countdown to the liftoff of the active craft from the launch pad.
 *
 * @category Mission control
 */
export interface LiftoffCountdown {
  /** Seconds left until T-0, 0 from T-0 on. */
  remainingSeconds: number;
  /** The whole length of the countdown, in seconds. */
  lengthSeconds: number;
  /** True once the craft has lifted off, that is once the mission clock has started. */
  liftedOff: boolean;
}

const TICK_MS = 100;

function useStageCountdownRecord() {
  const record = useSyncExternalStore(
    stageCountdownStore.subscribe,
    stageCountdownStore.get,
  );
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const running = record !== null && record.ended === null;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [running]);
  return record;
}

function remainingOf(t0: number, ended: GoNoGoCountdownEnd | null): number {
  return ended === null ? Math.max(0, t0 - stageCountdownNow()) : 0;
}

/**
 * The countdown of the GO/NO-GO poll the command centre is running: whether it is
 * running, how many seconds are left, how long it is, and how it ended ("go" or
 * aborted). Useful for showing the operator how close the next stage is, or for
 * preparing a view or a readout for the moment the countdown runs out. Used by
 * {@link useLiftoffCountdown}.
 *
 * `null` until a countdown has started since the poll was last reset, and when no
 * poll is running on this screen. Remaining seconds are measured on this screen's
 * own clock, so they agree with the main screen's to within a frame.
 *
 * @category Mission control
 */
export function useGoNoGoCountdown(): GoNoGoCountdown | null {
  // gonogo:reads none
  const record = useStageCountdownRecord();
  if (record === null) return null;
  return {
    running: record.ended === null,
    remainingSeconds: remainingOf(record.t0, record.ended),
    lengthSeconds: record.lengthSeconds,
    ended: record.ended,
  };
}

/**
 * The countdown to the liftoff of the active craft from the launch pad: how many
 * seconds are left, how long the countdown is, and whether the craft has lifted
 * off yet. Useful for preparing a view or a readout for the moment of liftoff
 * without checking the poll, the craft's phase and the stage action separately.
 * Used alongside {@link useGoNoGoCountdown}, which reports every countdown.
 *
 * Non-null only while a countdown is running that will stage the active craft
 * from the pad (the active craft is on the launch pad and the poll fires Stage at
 * T-0), and from T-0 until the poll is reset or the craft is reverted to the pad.
 * An abort or NO-GO makes it `null` again, as does a countdown that fires any
 * other action group or nothing, and a craft that is already flying.
 *
 * @category Mission control
 */
export function useLiftoffCountdown(): LiftoffCountdown | null {
  // gonogo:reads none
  const record = useStageCountdownRecord();
  if (record === null || !record.liftsOff || record.ended === "aborted") {
    return null;
  }
  return {
    remainingSeconds: remainingOf(record.t0, record.ended),
    lengthSeconds: record.lengthSeconds,
    liftedOff: record.liftedOff,
  };
}
