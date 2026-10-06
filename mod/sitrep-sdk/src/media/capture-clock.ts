/**
 * Interpolating the live capture-UT from a low-rate sample,
 * shared between the main-thread hook
 * and the worker-hosted frame-delay backend (`worker/`, cross-browser
 * video-delay design, 2026-07-16). Extracted to its own module so
 * there is exactly one implementation, mirroring the same "extract once"
 * treatment given to the clock-edge formula
 * (`@ksp-gonogo/sitrep-client`'s `view-clock-formula.ts`): the worker needs
 * to stamp each frame it reads with `captureUt` at read time too ("same
 * treatment": see that design's Clock seam section).
 */

/** A capture-clock sample: the last mission-time UT the sidecar reported for
 *  the video, the warp rate at that sample, and the wall-clock instant (ms,
 *  `performance.now()` basis) we observed it.
 *
 * @category Delayed video
 */
export interface CaptureClockSample {
  /** KSP universal time (seconds) the video was captured at, or `null` when no clock is known. */
  ut: number | null;
  /** Time-warp multiplier at the sample, for forward interpolation. */
  warpRate: number;
  /** `performance.now()` ms when this sample was observed. */
  atMs: number;
}

/**
 * The UT a video frame is being captured at now, carried forward from the last
 * sample of the capture clock, which updates about once a second, by the
 * wall-clock time since multiplied by the warp rate. `null` when there is no
 * clock sample.
 *
 * @category Delayed video
 */
export function interpolateCaptureUt(
  sample: CaptureClockSample,
  nowMs: number,
): number | null {
  if (sample.ut == null) return null;
  const elapsedSec = Math.max(0, (nowMs - sample.atMs) / 1000);
  return sample.ut + elapsedSec * (sample.warpRate || 1);
}
