/*
 * `ViewClock`'s certainty-horizon math, extracted as pure functions so a SECOND
 * context: the kerbcast per-frame video-delay worker
 * (`@ksp-gonogo/gonogo-kerbcast-uplink`'s `worker/` glue): can mirror it
 * EXACTLY, never forking the formula. `ViewClock` calls these same functions
 * (`view-clock.ts`'s `utNowEstimate`/`confirmedEdgeUt`), so there is exactly
 * one implementation of "the estimate only schedules; samples confirm": see
 * that class's doc for the invariant.
 *
 * Pure and side-effect free: no `performance.now()`, no class state. Callers
 * supply `nowWall` (wall-clock seconds, whatever basis their context uses)
 * and a `ClockFormulaInputs` snapshot of the fit + sample clamp.
 */

/**
 * Everything {@link computeUtNowEstimate} and {@link computeConfirmedEdgeUt}
 * need to work out the view clock, as plain numbers, so the clock can be
 * reproduced somewhere it cannot be shared, such as a web worker.
 *
 * Wall-clock times are in seconds on whatever basis the caller uses, as long
 * as `anchorWall` and the `nowWall` passed in share it.
 *
 * @category Delay and vantage
 */
export interface ClockFormulaInputs {
  /** The wall-clock time of the last sample the clock was fitted to. `undefined` before the first. */
  anchorWall?: number;
  /** The UT of that sample. `undefined` whenever `anchorWall` is. */
  anchorUt?: number;
  /** The latest UT of any sample received. `Number.NEGATIVE_INFINITY` before the first. */
  maxSampleUt: number;
  /** The one-way signal delay, in seconds. */
  delaySeconds: number;
  /** Game seconds per wall-clock second: 1 at normal speed, higher under time warp. */
  warpRate: number;
  /** How far past `maxSampleUt`, in seconds, the confirmed edge may reach. */
  slackSeconds: number;
}

/**
 * {@link ClockFormulaInputs} with the timeline generation it was taken in, so
 * a receiver can discard a snapshot taken before a save was loaded.
 *
 * @category Delay and vantage
 */
export interface ClockFormulaSnapshot extends ClockFormulaInputs {
  /** The timeline generation. */
  epoch: number;
}

/**
 * Returns the estimated UT at the craft now: the anchor UT carried forward at
 * `warpRate` for the wall-clock time since the anchor. Before any anchor it
 * returns `maxSampleUt`, or 0 before any sample.
 *
 * @category Delay and vantage
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
 * Returns the latest UT that may be shown: the estimate from
 * {@link computeUtNowEstimate} minus the signal delay, but never more than
 * `slackSeconds` past the latest sample received. Returns
 * `Number.NEGATIVE_INFINITY` before any sample.
 *
 * @category Delay and vantage
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
