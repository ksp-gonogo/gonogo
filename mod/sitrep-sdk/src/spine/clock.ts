/**
 * The clock `TelemetryClient` schedules its loss inference on, in UT seconds
 * (KSP's universal time).
 *
 * The `Clock` injected into `TelemetryClient` must share the time domain of
 * the transport's `predictConfirmEta()`. If the two disagree, such as a
 * wall-clock `now()` paired with a process-relative `etaConfirm`, loss is
 * inferred at once or never. Nothing checks this at runtime.
 */
export interface Clock {
  /*
   * Structural clock seam for `TelemetryClient`'s client-side loss inference.
   * The client never computes network delay itself, it only
   * schedules a callback at a UT a `Transport` predicted via
   * `predictConfirmEta()`: but it still needs a `Clock` to do the scheduling.
   *
   * Deliberately not imported from `@ksp-gonogo/sitrep-server`: sitrep-client
   * must never take a dependency (runtime or type-only) on the mod's delay
   * engine. This interface's shape mirrors sitrep-server's own `Clock`
   * exactly, so its `ManualClock` structurally satisfies this interface in
   * tests without either package importing the other.
   */
  /** Current UT, in seconds. */
  now(): number;
  /**
   * Fire `fn` once UT reaches `atUt`. Returns a cancel handle that removes
   * the pending callback if called before it fires; calling it after (or
   * more than once) is a no-op.
   */
  schedule(atUt: number, fn: () => void): () => void;
}

/**
 * Default `Clock`. `TelemetryClient` falls back to this when no `Clock` is
 * injected: i.e. every real, non-test transport. Backed by
 * `performance.now() / 1000`: process-relative seconds, not wall-clock epoch
 * time: this must match sitrep-server's `RealClock`, since that's the same
 * UT domain the courier/transport layer predicts `etaConfirm` in. Tests that
 * need deterministic timing inject their own `Clock` instead (or a
 * structurally compatible one, like sitrep-server's `ManualClock`).
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
