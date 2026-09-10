/**
 * The RIBBON mark's geometry: a continuous entry's amplitude history as an open
 * waveform trace, in its own 16-unit-tall box.
 *
 * The CONTINUITY axis picks this mark (see `railTags.ts`), and `ControlDelayStream`
 * places it in the outgoing zone. Kept a pure module so the drawing can be
 * asserted directly: the geometry is the whole of what the mark decides, and it
 * was settled against 14 rendered scenes rather than against a description.
 */

/**
 * The mark's own coordinate box: 100 wide by 16 tall, the caller scaling it into
 * whatever band it has. `boundaryX` is passed in rather than assumed, so one
 * light-time can sit wherever the host graph puts it.
 */
export const WAVE_VB_H = 16;
export const WAVE_MID_Y = WAVE_VB_H / 2;
/**
 * Half the waveform's full-scale height, in box units: how far a full-scale
 * sample reaches either side of the centre line. Short by design, the collapsed
 * rail is a band, not a meter.
 */
export const WAVE_HALF_H = 5.5;
/**
 * The NOMINAL distance between the trace's turning points, in box units, i.e.
 * HALF a period. The drawn extent is divided into whole segments no wider than
 * this, so the real pitch is this or a little under, except where
 * `waveformSteps` finds fewer samples behind the trace than the pitch would
 * spend turning points on.
 *
 * Fixed in the DRAWING rather than taken from the capture rate, which is the
 * whole of what makes this read as a wave. 128 chunks of 20 ms history over a
 * short light-time would otherwise put several turning points in each pixel and
 * come back out as a solid hatch, and one chunk over a long one would put none
 * in the whole band. Two units against the 100-unit box is ~25 cycles across the
 * widget however wide it is drawn.
 */
const WAVE_STEP = 2;

const clamp01 = (v: number): number =>
  !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;

/**
 * How far along the rail the drawn trace reaches: one light-time out at most,
 * and only as far as there is history to draw when there is less than that.
 *
 * The oldest sample held sits at its own age, because that is where that audio
 * is, so this is a MEASUREMENT of how much of the gap the caller can still
 * account for and not a length the drawing picks. Samples older than the span
 * have already arrived, so they are dropped rather than piled up against the
 * boundary; a non-positive span is no gap at all and has nothing crossing it.
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
 * How many turning points the trace is entitled to: the fixed drawing pitch,
 * unless there is less evidence than that behind it.
 *
 * Two separate limits, and the tighter one wins:
 *
 * - `WAVE_STEP`, the pitch, which is what keeps the mark reading as a wave at
 *   any capture density (see its own note)
 * - the samples there are to draw, `min(amplitudes.length, spanSamples)`: what
 *   was kept, and of that only what the gap still holds. Below ~10 ms of
 *   light-time the gap holds a FRACTION of one 20 ms sample, and the rail used
 *   to draw a confident 50-point sawtooth off it: full width, perfectly
 *   legible, identical for every transmission at low orbit, and saying nothing.
 *   A trace may be coarse; it may not invent turning points it has no samples
 *   for
 *
 * The resolution limit is floored at two segments, because one cannot cross the
 * centre line and a mark that does not cross it reads as a ramp rather than as
 * a wave. The pitch limit is not: an extent of a fraction of a unit has room
 * for one segment and drawing two of them would not make it a wave.
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
 * Turn a newest-last amplitude ring into an open waveform TRACE: a line that
 * crosses the centre of the band, reaching a sample's amplitude as a peak first
 * one side and then the other.
 *
 * It used to be the closed outline of a filled envelope, top out and bottom
 * back, and the operator read exactly what that draws: a pen that thickens where
 * the voice is loud, with nothing about it that says wave. An envelope has no
 * period, and period is what a waveform is recognised by. So the amplitude here
 * is the height of a turning point rather than the width of a stroke, and the
 * turning points come at a fixed pitch (`WAVE_STEP`), which is what keeps the
 * period visible at any density of capture.
 *
 * Silence is therefore a flat line down the middle rather than nothing at all,
 * which is the honest reading: the key is open and nobody is speaking.
 *
 * **`x` IS AGE, and nothing may be traded against that.** A sample `a` chunks
 * old is drawn at `a / span` of the way across, because that is where that
 * audio physically is: the widget's whole job is saying where things are in the
 * gap. So a caller holding less history than the gap is wide draws a trace that
 * stops short of the boundary, and that is the true picture, the rest of the
 * rail being audio equally in flight that the caller has discarded. Spreading
 * what was kept over the whole rail was considered and REJECTED: it would place
 * recent audio where older audio actually is, which is not a smoothing
 * trade-off but a false claim about position. The fix for a short trace is a
 * longer ring at the caller.
 *
 * What it will not do in the other direction either is spend ink on detail it
 * never received: see `waveformSteps`.
 */
export function waveformPath(
  amplitudes: readonly number[],
  spanSamples: number,
  boundaryX: number,
): string {
  if (amplitudes.length === 0) return "";
  const extentX = waveformExtentX(amplitudes, spanSamples, boundaryX);
  /*
   * One sample held, or no gap to cross, is a trace of no length: a single
   * vertex at this end. Kept rather than made empty, because an empty path is
   * how the mark decides there is no crossing at all, and a key that has just
   * opened IS a crossing.
   */
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
