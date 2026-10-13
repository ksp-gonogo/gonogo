/**
 * The clock `TelemetryClient` schedules its loss inference on, in seconds from
 * an origin of the clock's own choosing. It need not be the game's UT: a
 * deadline the game gives in UT is placed on this clock by the UT of the frames
 * the client receives.
 *
 * The `Clock` injected into `TelemetryClient` must share the time domain of
 * the transport's `predictConfirmEta()`. If the two disagree, such as a
 * wall-clock `now()` paired with a process-relative `etaConfirm`, loss is
 * inferred at once or never. Nothing checks this at runtime. Useful for
 * deciding when to tell the operator that a sample has not arrived. Taken by the
 * Sitrep client and implemented by `RealTimeClock`.
 */
export interface Clock {
  /*
   * Structural clock seam for `TelemetryClient`'s client-side loss inference.
   * The client never computes network delay itself, it only
   * schedules a callback at a time a `Transport` predicted via
   * `predictConfirmEta()`: but it still needs a `Clock` to do the scheduling.
   *
   * Deliberately not imported from `@ksp-gonogo/sitrep-server`: sitrep-client
   * must never take a dependency (runtime or type-only) on the mod's delay
   * engine. This interface's shape mirrors sitrep-server's own `Clock`
   * exactly, so its `ManualClock` structurally satisfies this interface in
   * tests without either package importing the other.
   */
  /** The clock's current reading, in seconds. */
  now(): number;
  /**
   * Fire `fn` once the clock reads `atUt`. Returns a cancel handle that removes
   * the pending callback if called before it fires; calling it after (or
   * more than once) is a no-op.
   */
  schedule(atUt: number, fn: () => void): () => void;
}

/**
 * The `Clock` the Sitrep client uses when none is injected, which is every real
 * transport. It reads `performance.now() / 1000`: seconds since the page
 * started, not wall-clock time, so it matches the time domain the transport
 * predicts confirmation in. Useful for scheduling loss inference in the running
 * app. A test that needs deterministic timing injects its own `Clock`.
 */
export class RealTimeClock implements Clock {
  now(): number {
    return performance.now() / 1000;
  }

  schedule(atUt: number, fn: () => void): () => void {
    const delayMs = Math.max(0, (atUt - this.now()) * 1000);
    const timeoutId = setTimeout(fn, delayMs);
    return () => {
      clearTimeout(timeoutId);
    };
  }
}
