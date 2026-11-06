/**
 * The ribbon mark's geometry: a continuous entry's amplitude history as an open
 * waveform trace, in its own 16-unit-tall box. A pure module, so the drawing can
 * be asserted directly.
 */

/**
 * The height of the ribbon mark's own coordinate box (100 wide by 16 tall),
 * scaled by the caller into whatever band it has. Used by
 * {@link ControlDelayStream}.
 */
export const WAVE_VB_H = 16;
/**
 * The centre line of the ribbon mark's box, in box units. Useful for reading a
 * drawn waveform against its centre line.
 *
 * @intent Published so a caller can read the trace waveformPath draws back against its centre line.
 * @category CommandDelay
 */
export const WAVE_MID_Y = WAVE_VB_H / 2;
/**
 * How far a full-scale sample reaches either side of the centre line, in box
 * units. It is short because the rail is a thin band. Useful for reading a drawn
 * waveform back as an amplitude.
 *
 * @intent Published so a caller can read the trace waveformPath draws back as an amplitude.
 * @category CommandDelay
 */
export const WAVE_HALF_H = 5.5;
/**
 * The nominal distance between turning points (half a period), in box units.
 * Fixed in the drawing rather than taken from the capture rate, so the trace
 * reads as a wave at any capture density rather than a solid hatch or a flat
 * line.
 */
const WAVE_STEP = 2;

const clamp01 = (v: number): number =>
  !Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v;

/**
 * How far along the rail the drawn trace reaches: one signal delay out at most,
 * and only as far as there is history. A measurement, not a drawing choice:
 * samples older than the span have arrived and are dropped. Useful for showing
 * the operator only the audio still on its way to the vessel. Used by
 * {@link ControlDelayStream}.
 */
export function waveformExtentX(
  amplitudes: { readonly length: number },
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
 * Turn a newest-last amplitude ring into an open waveform trace crossing the
 * band's centre, each turning point's height a sample's amplitude, at a fixed
 * pitch so the period stays visible. Silence is a flat line down the middle:
 * the key is open and nobody is speaking. Useful for showing the operator a
 * voice transmission still on its way. Used by {@link ControlDelayStream}.
 *
 * Each sample is drawn at its age, where that audio is on its way to the
 * vessel, so a short history draws a trace that stops short of the boundary.
 * Keep a longer history to fill it.
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
  /*
   * Each turning point is the LOUDEST sample of the stretch of audio it stands
   * for, not the one sample at its centre. The trace has far fewer points than
   * the ring has samples, and reading one sample per point would let a syllable
   * fall between two of them and vanish from the picture.
   */
  const agesPerStep = (extentX / boundaryX) * (spanSamples / steps);
  const newest = amplitudes.length - 1;
  const points: string[] = [];
  for (let k = 0; k <= steps; k++) {
    const x = Math.min((k / steps) * extentX, extentX);
    const from = Math.max(0, Math.round((k - 0.5) * agesPerStep));
    const to = Math.min(newest, Math.round((k + 0.5) * agesPerStep));
    let a = 0;
    for (let age = from; age <= Math.max(from, to); age++) {
      a = Math.max(a, clamp01(amplitudes[newest - Math.min(age, newest)]));
    }
    const dy = (k % 2 === 0 ? -1 : 1) * a * WAVE_HALF_H;
    points.push(`${x.toFixed(2)},${(WAVE_MID_Y + dy).toFixed(2)}`);
  }
  return `M${points.join(" L")}`;
}

/**
 * One block of audio as the lowest and highest sample it held, each scaled to
 * -1..1 against the edge of the band. Useful for drawing the wave itself
 * instead of how loud it was. Taken by {@link waveformBand}.
 *
 * @category CommandDelay
 */
export interface WaveBlock {
  /** The lowest sample of the block, -1 to 0. */
  lo: number;
  /** The highest sample of the block, 0 to 1. */
  hi: number;
}

/** The horizontal width of one column of the filled wave, in box units: about two screen pixels on the rail. */
const WAVE_COLUMN = 0.25;

/**
 * Turn a newest-last ring of per-block lowest and highest samples into a filled
 * band, the way an audio editor draws a zoomed-out track: one column for each
 * slice of audio, from that slice's lowest sample to its highest. A pause is a
 * line along the centre; an attack and a decay are as steep as the voice made
 * them. Each column is placed where its audio is in the gap, by the same rule
 * as {@link waveformPath}. Useful for showing the operator the voice itself
 * crossing the gap. Used by {@link ControlDelayStream}.
 *
 * Returns the closed outline to fill, and `""` for a ring with fewer than two
 * blocks, which has no width to draw.
 *
 * @category CommandDelay
 */
export function waveformBand(
  blocks: readonly WaveBlock[],
  spanSamples: number,
  boundaryX: number,
): string {
  const extentX = waveformExtentX(blocks, spanSamples, boundaryX);
  if (!(extentX > 0)) return "";
  const newest = blocks.length - 1;
  const columns = Math.max(
    1,
    Math.min(
      Math.round(Math.min(blocks.length, spanSamples)),
      Math.ceil(extentX / WAVE_COLUMN),
    ),
  );
  const agesPerColumn = (extentX / boundaryX) * (spanSamples / columns);
  const top: string[] = [];
  const bottom: string[] = [];
  for (let c = 0; c < columns; c++) {
    const from = Math.max(0, Math.round(c * agesPerColumn));
    const to = Math.min(
      newest,
      Math.max(from, Math.round((c + 1) * agesPerColumn) - 1),
    );
    let lo = 0;
    let hi = 0;
    for (let age = from; age <= to; age++) {
      const block = blocks[newest - age];
      if (!block) continue;
      if (Number.isFinite(block.lo)) lo = Math.min(lo, Math.max(-1, block.lo));
      if (Number.isFinite(block.hi)) hi = Math.max(hi, Math.min(1, block.hi));
    }
    const x0 = (c / columns) * extentX;
    const x1 = ((c + 1) / columns) * extentX;
    const yTop = (WAVE_MID_Y - hi * WAVE_HALF_H).toFixed(2);
    const yBottom = (WAVE_MID_Y - lo * WAVE_HALF_H).toFixed(2);
    top.push(`${x0.toFixed(2)},${yTop}`, `${x1.toFixed(2)},${yTop}`);
    // The lower edge runs back the way the upper one came, so the outline is one simple loop.
    bottom.unshift(
      `${x1.toFixed(2)},${yBottom}`,
      `${x0.toFixed(2)},${yBottom}`,
    );
  }
  return `M${top.join(" L")} L${bottom.join(" L")} Z`;
}
