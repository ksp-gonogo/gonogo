/**
 * Clips built to a stated LOUDNESS CURVE, for driving the rail's voice ribbon.
 *
 * `makeClip` shapes a whole utterance with one raised cosine, which is the
 * right thing for the roundtrip tests it was written for and the wrong thing
 * for a picture of a waveform: measured through `chunkAmplitude` its middle
 * clamps flat at full scale (a sine of amplitude `A` has RMS `A/√2`, and full
 * scale is 0.25 RMS, so any chunk past a byte of ~90 reads 1.0 whatever it
 * actually was). A render fed that shows a flat-topped band for most of its
 * length, which is precisely the thing `clips.ts` warns a naive fixture hides.
 *
 * So a clip here is built BACKWARDS from the reading it should produce: the
 * caller names an amplitude per chunk in the 0..1 the ribbon draws, and the
 * byte that yields it is found by bisecting the real measurement. The clip is
 * still a `RadioClip` in every other respect (integer hertz, byte-quantised
 * amplitude, deterministic), so `clipMic` plays it and the transmitter measures
 * it exactly as it measures a recorded one. Nothing here fakes an amplitude:
 * the number the rail draws has been through `chunkAmplitude` over real PCM.
 */
import { chunkAmplitude } from "../../src/commcast/radio/amplitude";
import {
  CLIP_CHUNK_SECONDS,
  type ClipChunk,
  clipSamples,
  type RadioClip,
} from "../../src/commcast/radio/clips";

/**
 * The byte whose chunk measures closest to `target`, found by bisection over
 * the real measurement rather than by inverting its arithmetic here. A copy of
 * the RMS scaling would agree with itself forever and stop agreeing with
 * `amplitude.ts` the day full scale moves.
 */
function byteForAmplitude(
  target: number,
  frequencyHz: number,
  index: number,
): number {
  if (target <= 0) return 0;
  let lo = 0;
  let hi = 255;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const measured = chunkAmplitude(
      clipSamples({ amplitudeByte: mid, frequencyHz, index }),
    );
    if (measured < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A clip whose measured chunk amplitudes follow `curve(i)`, one call per chunk,
 * each answer read as the 0..1 the ribbon will draw.
 *
 * The frequency walks the same nine-step cycle `makeClip` uses, for the same
 * reason: it keeps the phase moving so a clip is one continuous utterance
 * rather than a stack of identical chunks.
 */
export function makeCurveClip(
  name: string,
  chunkCount: number,
  curve: (index: number, count: number) => number,
  baseHz = 180,
): RadioClip {
  const chunks: ClipChunk[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const frequencyHz = baseHz + 40 * ((i * 7) % 9);
    const target = Math.min(1, Math.max(0, curve(i, chunkCount)));
    chunks.push({
      frequencyHz,
      amplitudeByte: byteForAmplitude(target, frequencyHz, i),
    });
  }
  return { name, chunks, seconds: chunkCount * CLIP_CHUNK_SECONDS };
}

/**
 * Somebody saying a sentence: syllables inside phrases, with a breath between
 * them and a swell across the whole thing.
 *
 * Three timescales on purpose, because the ribbon has to be legible at all
 * three. The syllable (9 chunks, 180 ms) is what gives the trace its texture,
 * the breath is the gap a reader uses to see where words end, and the phrase
 * swell is what survives when the trace is squeezed into a fraction of the
 * rail. A curve with only one of those reads as a flat band the moment the
 * separation compresses it.
 */
export const SPEECH_CURVE = (i: number, count: number): number => {
  const syllable = 0.5 - 0.5 * Math.cos((2 * Math.PI * ((i % 9) + 0.5)) / 9);
  const breath = Math.floor(i / 9) % 4 === 3 ? 0.1 : 1;
  const phrase = 0.55 + 0.45 * Math.sin((Math.PI * i) / count);
  return syllable * breath * phrase;
};

/** An open key with nobody talking: every chunk measures zero, honestly. */
export const SILENCE_CURVE = (): number => 0;
