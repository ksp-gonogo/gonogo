/**
 * How loud one 20 ms capture chunk was, on the way past the encoder.
 *
 * The rail wants a waveform of the operator's own voice crossing the gap, and
 * the PCM for it is already in hand: the capture worklet posts a `Float32Array`
 * per chunk and the handler passes it straight to `encoder.encode`. So this is
 * a loop over a buffer that already exists. No second `getUserMedia`, no second
 * device config, no `AnalyserNode`, no early decode, and nothing added to the
 * contract.
 *
 * **RMS, not peak.** A peak is one sample and jitters violently at 50 Hz; RMS
 * over the chunk is what a waveform display is drawing anyway. It is scaled so
 * ordinary speech occupies most of the band rather than a sliver at the bottom
 * (RMS of speech sits well under its peak), and clamped, so the caller gets a
 * plain 0..1 with no range to rediscover.
 *
 * **What it is NOT: a VU meter of the room.** Capture runs with
 * `autoGainControl: true`, so this is POST-AGC. It shows what is actually being
 * transmitted, which is the honest quantity for a rail about what is in flight,
 * and it is not the loudness of the operator's voice.
 */

/**
 * Full scale for the RMS reading. Speech at a comfortable level lands around
 * 0.1-0.2 RMS post-AGC, so dividing by this puts normal talking in the upper
 * half of the ribbon and leaves headroom above it rather than clipping there.
 */
const FULL_SCALE_RMS = 0.25;

/** RMS of one capture chunk, scaled and clamped to 0..1. `0` for an empty or unreadable buffer. */
export function chunkAmplitude(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    // A non-finite sample is a broken buffer, not silence in the middle of it,
    // so it contributes nothing rather than poisoning the whole chunk to NaN.
    if (Number.isFinite(s)) sum += s * s;
  }
  const rms = Math.sqrt(sum / samples.length);
  const scaled = rms / FULL_SCALE_RMS;
  return scaled < 0 ? 0 : scaled > 1 ? 1 : scaled;
}
