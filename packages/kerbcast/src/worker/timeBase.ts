/**
 * Reconciling the main thread's and the worker's wall-clock bases (design
 * doc, "Clock seam", `timeOrigin` paragraph). `ViewClock.now()` is
 * `performance.now() / 1000` — seconds since THIS context's
 * `performance.timeOrigin`. A dedicated Worker has its OWN `timeOrigin`
 * (its own JS global, its own `performance` object), so a worker-local
 * `performance.now()` is not directly comparable to a wall-time value the
 * main thread computed and posted over (e.g. `ClockFormulaSnapshot.anchorWall`).
 *
 * Fix: at worker init, the main thread posts its own `performance.timeOrigin`
 * (ms, epoch-relative) once. The worker computes the ms offset between the
 * two origins and holds it; every subsequent `nowWall()` read is corrected
 * by that offset, landing on the MAIN thread's time base — so a forwarded
 * `anchorWall` (computed via the main thread's `performance.now()/1000`)
 * compares correctly against the worker's own `nowWall()`.
 *
 * Worked example (also see `timeBase.test.ts`): main thread's origin is at
 * absolute epoch 1000ms; the worker spins up 500ms later, at absolute epoch
 * 1500ms. 500ms of real time after THAT, absolute epoch is 2000ms. The
 * worker's own `performance.now()` reads 500 (2000 - 1500). The main
 * thread's `performance.now()/1000` would read `(2000 - 1000) / 1000 = 1.0`
 * at that same instant. Recovering that from the worker's `perfNowMs()`
 * needs `(perfNowMs() + (localTimeOrigin - mainTimeOrigin)) / 1000` — the
 * offset is `localTimeOrigin - mainTimeOrigin` (the amount to ADD to a
 * local ms reading to land on the main thread's basis), not the other way
 * around: `(500 + (1500 - 1000)) / 1000 = 1.0` ✓.
 *
 * Pure functions, injectable `perfNowMs` — no worker/DOM API touched here,
 * so this unit-tests directly without a real Worker context.
 */

/** `localTimeOriginMs - mainTimeOriginMs` — the number of milliseconds to
 *  ADD to a local `performance.now()` reading to land it on the MAIN
 *  thread's wall-clock basis. See the module doc's worked example for why
 *  it's `local - main`, not `main - local`. */
export function computeTimeOriginOffsetMs(
  mainTimeOriginMs: number,
  localTimeOriginMs: number,
): number {
  return localTimeOriginMs - mainTimeOriginMs;
}

/**
 * Builds a `nowWall()` reader on the MAIN thread's basis: local
 * `performance.now()` (ms, this context's own clock) shifted by the
 * precomputed origin offset, then converted to seconds — matching
 * `ViewClock.now()`'s own `performance.now() / 1000` exactly, just
 * evaluated from inside the worker.
 */
export function createNowWall(
  offsetMs: number,
  perfNowMs: () => number,
): () => number {
  return () => (perfNowMs() + offsetMs) / 1000;
}
