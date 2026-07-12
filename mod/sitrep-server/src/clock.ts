/**
 * Clock is the injectable virtual-time seam for the Sitrep delay engine.
 * All delay-sensitive logic (Archive, Courier delivery scheduling, etc.)
 * reads time exclusively through a Clock so it can run deterministically
 * under KSP time-warp and in tests, without ever touching wall-clock time
 * directly.
 *
 * Time is measured in UT seconds (KSP's universal time).
 */
export interface Clock {
  /** Current UT, in seconds. */
  now(): number;
  /**
   * Fire `fn` once UT reaches `atUt`. Returns a cancel handle that removes
   * the pending callback if called before it fires; calling it after the
   * callback has already fired is a no-op.
   */
  schedule(atUt: number, fn: () => void): () => void;
}

interface PendingCallback {
  atUt: number;
  fn: () => void;
  cancelled: boolean;
}

/**
 * Pure virtual clock. Time only moves when `advanceTo` is called, and it
 * never reads Date.now()/performance.now() — that's the whole point: tests
 * (and the real engine under time-warp) drive it explicitly.
 */
export class ManualClock implements Clock {
  private currentUt: number;
  private pending: PendingCallback[] = [];

  constructor(startUt = 0) {
    this.currentUt = startUt;
  }

  now(): number {
    return this.currentUt;
  }

  schedule(atUt: number, fn: () => void): () => void {
    const callback: PendingCallback = { atUt, fn, cancelled: false };
    this.pending.push(callback);
    return () => {
      callback.cancelled = true;
    };
  }

  /**
   * Advance current UT to `ut`, firing all non-cancelled pending callbacks
   * with `atUt <= ut`, in ascending atUt order (ties broken by insertion
   * order). Advancing to a UT strictly before the current UT is a no-op
   * (time never rewinds, nothing fires) — advancing to the *same* UT is
   * allowed and still processes any callbacks due at that UT.
   *
   * This drains rather than snapshotting the due batch up front: a firing
   * callback may itself `schedule(...)` a new callback at `atUt <= ut`
   * (e.g. a zero-delay re-entrant delivery). The loop re-scans pending
   * callbacks after every fire so that newly-scheduled, already-due
   * callbacks are picked up and fired within the same `advanceTo` call,
   * instead of getting stranded until a later advance. A callback that
   * perpetually reschedules itself at `atUt <= ut` will loop forever here —
   * that's an author-side bug (equivalent to recursive `setTimeout(0)`),
   * not something this clock should paper over.
   */
  advanceTo(ut: number): void {
    if (ut < this.currentUt) {
      return;
    }

    this.currentUt = ut;

    for (;;) {
      let dueIndex = -1;
      for (let i = 0; i < this.pending.length; i++) {
        const callback = this.pending[i];
        if (callback.cancelled || callback.atUt > ut) {
          continue;
        }
        if (dueIndex === -1 || callback.atUt < this.pending[dueIndex].atUt) {
          dueIndex = i;
        }
      }

      if (dueIndex === -1) {
        break;
      }

      const [callback] = this.pending.splice(dueIndex, 1);
      if (!callback.cancelled) {
        callback.fn();
      }
    }
  }
}

/**
 * Wall-clock-backed Clock. Kept minimal — the delay-engine model and its
 * tests run entirely on ManualClock; this exists so production code has a
 * real implementation to construct.
 */
export class RealClock implements Clock {
  private readonly timeFn: () => number;

  constructor(timeFn: () => number = () => performance.now() / 1000) {
    this.timeFn = timeFn;
  }

  now(): number {
    return this.timeFn();
  }

  schedule(atUt: number, fn: () => void): () => void {
    const delayMs = Math.max(0, (atUt - this.now()) * 1000);
    const timeoutId = setTimeout(fn, delayMs);
    return () => {
      clearTimeout(timeoutId);
    };
  }
}
