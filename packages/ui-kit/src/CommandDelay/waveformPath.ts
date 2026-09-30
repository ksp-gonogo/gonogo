/**
 * The RIBBON mark's geometry: a continuous entry's amplitude history as an open
 * waveform trace, in its own 16-unit-tall box. A pure module, so the drawing can
 * be asserted directly.
 */

/** The mark's own coordinate box: 100 wide by 16 tall, scaled by the caller into whatever band it has. */
export const WAVE_VB_H = 16;
/**
 * The centre line of the ribbon mark's box, in box units.
 *
 * @category CommandDelay
 */
export const WAVE_MID_Y = WAVE_VB_H / 2;
/**
 * How far a full-scale sample reaches either side of the centre line, in box units. Short: the rail is a band, not a meter.
 *
 * @category CommandDelay
 */
export const WAVE_HALF_H = 5.5;
/**
 * The NOMINAL distance between turning points (half a period), in box units.
 * Fixed in the DRAWING rather than taken from the capture rate, so the trace
 * reads as a wave at any capture density rather than a solid hatch or a flat
 * line.
 */
const WAVE_STEP = 2;

const clamp01 = (v: number): number =>
  !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;

/**
 * How far along the rail the drawn trace reaches: one light-time out at most,
 * and only as far as there is history. A MEASUREMENT, not a drawing choice:
 * samples older than the span have arrived and are dropped.
 */
export function waveformExtentX(
  amplitudes: readonly number[],
  spanSamples: number,
  boundaryX: number,
): number {
  if (!(spanSamples > 0)) return 0;
  return (
    (Math.min(amplitudes.length - 1, spanSamples) / spanSamples) * boundaryX
  );
}

/**
 * How many turning points the trace is entitled to: the tighter of the drawing
 * pitch (`WAVE_STEP`) and the samples the gap holds. A trace may be coarse; it
 * may not invent turning points it has no samples for. The resolution limit is
 * floored at two segments, since one cannot cross the centre line.
 */
function waveformSteps(
  amplitudes: readonly number[],
  spanSamples: number,
  extentX: number,
): number {
  const resolvable = Math.min(amplitudes.length, spanSamples);
  return Math.min(
    Math.max(1, Math.ceil(extentX / WAVE_STEP)),
    Math.max(2, Math.round(resolvable)),
  );
}

/**
 * Turn a newest-last amplitude ring into an open waveform TRACE crossing the
 * band's centre, each turning point's height a sample's amplitude, at a fixed
 * pitch so the period stays visible. Silence is a flat line down the middle:
 * the key is open and nobody is speaking.
 *
 * **`x` IS AGE.** A sample is drawn where that audio physically is in the gap,
 * so a short history draws a trace that stops short of the boundary. The fix
 * for a short trace is a longer ring at the caller, never spreading what was
 * kept.
 *
 * @category CommandDelay
 */
export function waveformPath(
  amplitudes: readonly number[],
  spanSamples: number,
  boundaryX: number,
): string {
  if (amplitudes.length === 0) return "";
  const extentX = waveformExtentX(amplitudes, spanSamples, boundaryX);
  // A trace of no length is a single vertex, not empty: a key that has just opened IS a crossing.
  if (!(extentX > 0)) return `M0.00,${WAVE_MID_Y.toFixed(2)}`;
  const steps = waveformSteps(amplitudes, spanSamples, extentX);
  const points: string[] = [];
  for (let k = 0; k <= steps; k++) {
    const x = Math.min((k / steps) * extentX, extentX);
    // Newest at this end: age 0 is `now`, and x walks back through the ring.
    const age = Math.min(
      Math.round((x / boundaryX) * spanSamples),
      amplitudes.length - 1,
    );
    const a = clamp01(amplitudes[amplitudes.length - 1 - age]);
    const dy = (k % 2 === 0 ? -1 : 1) * a * WAVE_HALF_H;
    points.push(`${x.toFixed(2)},${(WAVE_MID_Y + dy).toFixed(2)}`);
  }
  return `M${points.join(" L")}`;
}
