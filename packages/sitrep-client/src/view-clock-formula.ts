/**
 * `ViewClock`'s certainty-horizon math, extracted as pure functions so a
 * SECOND context — the kerbcast per-frame video-delay worker
 * (`@ksp-gonogo/kerbcast-feed`'s `worker/` glue) — can mirror it EXACTLY,
 * never forking the formula (cross-browser kerbcast video-delay design,
 * 2026-07-16, "Clock seam"). `ViewClock` itself is refactored to call these
 * same functions (`view-clock.ts`'s `utNowEstimate`/`confirmedEdgeUt`), so
 * there is exactly one implementation of "the estimate only schedules;
 * samples confirm" — see that class's doc for the invariant.
 *
 * Pure and side-effect free: no `performance.now()`, no class state. Callers
 * supply `nowWall` (wall-clock seconds, whatever basis their context uses)
 * and a `ClockFormulaInputs` snapshot of the fit + sample clamp.
 */

/** The formula's raw inputs — a serializable snapshot of everything
 *  `utNowEstimate`/`confirmedEdgeUt` need, independent of which context
 *  (main thread `ViewClock`, or a worker mirroring it) evaluates them. */
export interface ClockFormulaInputs {
  /** Wall-clock seconds (same basis as the `nowWall` passed to the
   *  functions below) at the last `observeSample` fit anchor.
   *  `undefined` before any sample has ever anchored the fit. */
  anchorWall?: number;
  /** UT at that same anchor. `undefined` in lockstep with `anchorWall`. */
  anchorUt?: number;
  /** Max `validAt` ever observed via `observeSample` this epoch.
   *  `Number.NEGATIVE_INFINITY` before the first sample. */
  maxSampleUt: number;
  /** One delay authority — see `ViewClock.delaySeconds()`. */
  delaySeconds: number;
  /** UT-per-wall-second slope — see `ViewClock`'s `warpRate` option. */
  warpRate: number;
  /** Slack added to the sample-clamp side of `confirmedEdgeUt`'s `min()`. */
  slackSeconds: number;
}

/** `ClockFormulaInputs` plus the epoch generation — the shape posted over
 *  the wire (kerbcast worker's `ClockSnapshot` message) so a stale-epoch
 *  snapshot can be discarded the same way `ViewClock.observeSample`
 *  discards a stale-epoch straggler. */
export interface ClockFormulaSnapshot extends ClockFormulaInputs {
  epoch: number;
}

/**
 * Estimated "vessel now": a piecewise-linear UT(wall) fit, coasting on the
 * last observed slope between observations. Mirrors
 * `ViewClock.utNowEstimate()` exactly — see that method's doc.
 */
export function computeUtNowEstimate(
  inputs: ClockFormulaInputs,
  nowWall: number,
): number {
  if (inputs.anchorWall === undefined || inputs.anchorUt === undefined) {
    return inputs.maxSampleUt === Number.NEGATIVE_INFINITY
      ? 0
      : inputs.maxSampleUt;
  }
  const elapsed = nowWall - inputs.anchorWall;
  return inputs.anchorUt + elapsed * inputs.warpRate;
}

/**
 * The certainty horizon: `min(utNowEstimate() - delaySeconds, maxSampleUt +
 * slackSeconds)`. Never ahead of the max sample UT actually observed.
 * Returns `-Infinity` before any sample has ever been observed. Mirrors
 * `ViewClock.confirmedEdgeUt()` exactly — see that method's doc.
 */
export function computeConfirmedEdgeUt(
  inputs: ClockFormulaInputs,
  nowWall: number,
): number {
  if (inputs.maxSampleUt === Number.NEGATIVE_INFINITY) {
    return Number.NEGATIVE_INFINITY;
  }
  const estimatedEdge =
    computeUtNowEstimate(inputs, nowWall) - inputs.delaySeconds;
  const sampleClamp = inputs.maxSampleUt + inputs.slackSeconds;
  return Math.min(estimatedEdge, sampleClamp);
}
