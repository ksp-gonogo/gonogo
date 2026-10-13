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

/**
 * A capture-clock sample: the last universal time the camera mod reported for
 * the video, the warp rate at that sample, and the wall-clock instant (ms,
 * `performance.now()` basis) it was observed. Useful for knowing when a delayed
 * video frame was captured. Taken by {@link interpolateCaptureUt}.
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
 * clock sample. Useful for stamping each delayed video frame with the time it
 * was captured. Used by the delayed video playout in this package.
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

/**
 * Returns a function that gives the UT to stamp a video frame with, from the
 * capture clock's latest sample and the wall-clock time in milliseconds. While
 * the sample has no UT it gives the last UT it worked out, and
 * `Number.POSITIVE_INFINITY` before the first, so a frame that cannot be dated
 * is held and is never shown ahead of the delayed telemetry. Useful for stamping
 * the frames of one delayed video. Used by the delayed video playout in this
 * package, one per camera.
 *
 * @category Delayed video
 */
export function captureUtStamper(): (
  sample: CaptureClockSample,
  nowMs: number,
) => number {
  let last = Number.POSITIVE_INFINITY;
  return (sample, nowMs) => {
    const ut = interpolateCaptureUt(sample, nowMs);
    if (ut !== null) last = ut;
    return last;
  };
}
