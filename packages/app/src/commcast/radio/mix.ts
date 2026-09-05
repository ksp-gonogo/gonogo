/**
 * What several people talking at once sounds like at one listener.
 *
 * The radio is ONE BAND. Every transmission this vantage has a path to is
 * decoded on its own and summed into a single output, so two people who key
 * together are both audible, each at their own natural rate, each released one
 * light-time after they spoke.
 *
 * **The sum has to happen DOWNSTREAM of per-source delay**, and that is the
 * constraint, not the location. What is impossible is mixing ONCE and fanning
 * the result out: the transmissions in it have different light-times to
 * different listeners, so no single mixed stream is correct for two of them.
 *
 * The host could still do it correctly, per listener, since it knows every
 * vantage. The reason it does not is cost and shape rather than truth: it would
 * have to decode every stream to PCM, which it otherwise never does (it
 * forwards opaque Opus frames), and it would produce a mix per listener per
 * speaker where the listener does one mix of however many speakers it can
 * hear. Same arithmetic, worse place.
 *
 * **There is no per-source gain and there must never be one.** Turning one
 * speaker down and another up would be a fiction about a shared band: an
 * operator cannot lean on the volume of one voice arriving on the same
 * frequency as another. The only volume control is the per-thread mute in
 * `monitor.ts`, which is a decision about which loops to monitor rather than a
 * mixer.
 *
 * So the sum is plain, and the one thing done to it is stopping it from
 * clipping.
 */

/**
 * Where the limiter starts working. Below this the sum is passed through
 * UNTOUCHED, which is what keeps a single talker bit-exact: one voice on a
 * quiet band is the overwhelmingly common case and it must not be reshaped by
 * machinery that exists for the rare one.
 *
 * 0.8 rather than 1.0 because a knee at full scale would leave nothing to
 * compress into: everything above it would have to be squeezed into zero
 * headroom, which is hard clipping under another name.
 */
export const MIX_KNEE = 0.8;

/**
 * One summed sample, kept inside the output's range.
 *
 * A plain sum of two full-scale voices reaches 2.0 and hard-clips, which sounds
 * like buzzing rather than like two people. Scaling by 1/N instead would duck
 * whoever the operator was already listening to the instant somebody else keyed
 * up, which is worse: a voice that gets quieter because a second one started is
 * exactly the per-source gain this design refuses.
 *
 * So the sum is soft-limited, the way a receiver's own limiter behaves. Below
 * {@link MIX_KNEE} the input is the output. Above it the excess is compressed
 * onto the headroom that is left, asymptotically approaching 1 and never
 * reaching it, so two loud talkers overlap and distort in the overlap rather
 * than either one disappearing or the whole band breaking up.
 *
 * The curve is continuous in value AND in slope at the knee (its derivative
 * there is exactly 1), so a voice crossing the threshold does not audibly step.
 *
 * **Written as a self-contained function on purpose.** It is the same arithmetic
 * on the audio thread, where {@link buildPlayoutWorklet} embeds this function's
 * own source into the worklet module, so there is no second copy to drift. That
 * is also why the knee is a literal here rather than a reference to the
 * exported constant: a free identifier would not survive being stringified out
 * of this module.
 */
export function mixSample(sum: number): number {
  const knee = 0.8;
  const headroom = 1 - knee;
  const magnitude = sum < 0 ? -sum : sum;
  if (magnitude <= knee) return sum;
  const over = magnitude - knee;
  const shaped = knee + (headroom * over) / (over + headroom);
  return sum < 0 ? -shaped : shaped;
}
