/**
 * The worker-side mirror of `ViewClock` (design doc, "Clock seam" — locked
 * decision 3, "self-clocked worker"). Rather than latching a single
 * `confirmedEdgeUt()` value pushed per tick, the worker holds the clock's
 * raw formula INPUTS (`ClockFormulaSnapshot`, posted at ~60Hz from the main
 * thread) and evaluates `computeConfirmedEdgeUt`/`computeUtNowEstimate`
 * locally against its own `nowWall()` — the exact same pure functions
 * `ViewClock` itself calls (`@ksp-gonogo/sitrep-client`'s
 * `view-clock-formula.ts`), so there is one implementation, never a fork.
 *
 * This preserves the "estimate only schedules; samples confirm" invariant
 * verbatim: the sample clamp inside the formula still comes from
 * `maxSampleUt`, a value ONLY `ViewClock.observeSample` (main-thread,
 * telemetry-driven) ever advances — the worker cannot manufacture
 * confirmation, it can only evaluate the same clamped formula sooner or
 * more smoothly than a single latched value would allow (see the design
 * doc's "why this still beats a plain latch" paragraph).
 *
 * Satisfies the `DelayClockLike` structural interface
 * (`../delayed-playout-buffer.ts`) so `runFrameDelayPipeline` runs completely
 * unchanged inside the worker (F1 — "a new backend is a new source/sink
 * pair, not a new engine").
 *
 * No worker-global APIs referenced here (`self`, `postMessage`, etc.) — only
 * generic timer functions — so this unit-tests directly in a normal vitest
 * environment with fake timers, no real Worker context needed.
 */

import {
  type ClockFormulaSnapshot,
  computeConfirmedEdgeUt,
} from "../../view-clock-formula";
import type { DelayClockLike } from "../delayed-playout-buffer";

const COLD_SNAPSHOT: ClockFormulaSnapshot = {
  epoch: 0,
  anchorWall: undefined,
  anchorUt: undefined,
  maxSampleUt: Number.NEGATIVE_INFINITY,
  delaySeconds: 0,
  warpRate: 1,
  slackSeconds: 0,
};

export interface WorkerDelayClockOptions {
  /** Wall-clock seconds, on the MAIN thread's basis — see `time-base.ts`. */
  nowWall(): number;
  /** Poll interval (ms) driving `onFrame` subscribers — mirrors
   *  `ViewClock.onFrame`'s own `setTimeout(tick, 16)` SSR/non-rAF fallback
   *  (a worker has no `requestAnimationFrame`). Defaults to 16 (~60Hz). */
  pollIntervalMs?: number;
  /** Injectable timer functions — tests use fake timers via these instead
   *  of the real `setInterval`/`clearInterval`. */
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export interface WorkerDelayClock extends DelayClockLike {
  /** Apply a freshly-received snapshot from the main thread. Discards a
   *  stale-epoch snapshot (`next.epoch < current.epoch`) — mirrors
   *  `ViewClock.observeSample`'s own stale-epoch straggler guard exactly,
   *  so a snapshot posted just before a rewind can never land after (and
   *  undo) the post-rewind snapshot that follows it. */
  applySnapshot(next: ClockFormulaSnapshot): void;
  /** The most recently applied snapshot — for diagnostics/tests. */
  currentSnapshot(): ClockFormulaSnapshot;
}

/**
 * Builds the worker-side clock. Starts with a "cold" snapshot (no anchor,
 * no sample ever observed) — `confirmedEdgeUt()` reads `-Infinity`,
 * matching `ViewClock`'s own pre-first-sample state, until the first real
 * snapshot arrives.
 */
export function createWorkerDelayClock(
  opts: WorkerDelayClockOptions,
): WorkerDelayClock {
  let current: ClockFormulaSnapshot = COLD_SNAPSHOT;
  const listeners = new Set<(viewUt: number) => void>();
  const pollIntervalMs = opts.pollIntervalMs ?? 16;
  const startInterval = opts.setIntervalFn ?? setInterval;
  const stopInterval = opts.clearIntervalFn ?? clearInterval;
  let timer: ReturnType<typeof setInterval> | null = null;

  function confirmedEdgeUt(): number {
    return computeConfirmedEdgeUt(current, opts.nowWall());
  }

  function ensurePolling(): void {
    if (timer !== null || listeners.size === 0) return;
    timer = startInterval(() => {
      const edge = confirmedEdgeUt();
      for (const cb of listeners) cb(edge);
    }, pollIntervalMs);
  }

  function maybeStopPolling(): void {
    if (timer !== null && listeners.size === 0) {
      stopInterval(timer);
      timer = null;
    }
  }

  return {
    confirmedEdgeUt,
    onFrame(cb) {
      listeners.add(cb);
      ensurePolling();
      return () => {
        listeners.delete(cb);
        maybeStopPolling();
      };
    },
    applySnapshot(next) {
      if (next.epoch < current.epoch) return; // stale-epoch straggler
      current = next;
    },
    currentSnapshot() {
      return current;
    },
  };
}
