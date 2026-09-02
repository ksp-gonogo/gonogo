import type { CommsDelay } from "../__generated__/contract";

/**
 * The `comms.delay` channel topic: the CORE `SignalDelay` capability's
 * output (`mod/Gonogo.KSP/CommsCoreUplink.cs:DelayTopic`,
 * `mod/Sitrep.Host/ChannelEngine.cs:CommsDelayTopic`). It is a `TrueNow`
 * channel: the server never delays the value that DEFINES the delay, so the
 * SDK reads it un-gated and can trust it as the current one-way light-time.
 */
export const COMMS_DELAY_TOPIC = "comms.delay";

/** The minimal client surface `DelayAuthority` needs, just topic subscription. */
export interface DelaySubscribable {
  subscribe(topic: string, cb: (payload: unknown) => void): () => void;
}

/**
 * Extract the one-way delay (seconds) a `comms.delay` payload REPORTS, or
 * `null` when it reports no measurable one, which the caller holds through
 * rather than reading as zero.
 *
 * The discriminator is the VALUE, never `source`
 * (`mod/Sitrep.Contract/Comms.cs:CommsDelay`). `CommsDelaySource.None` covers
 * two opposite states that share it: a 0 is "the delay feature is off and the
 * vessel is connected", a null is "there is no path home to measure". Reading
 * the source first collapsed the second onto the first, so a craft nothing
 * could reach was clocked as if it were on the LAN. `command-delay.ts`'s
 * `currentMode` reads the same payload the same value-first way; the two now
 * agree.
 *
 * A wrapped, finite, non-negative reading is the only thing that MOVES the
 * delay. Absence, malformation, NaN and a negative alike return `null`: not
 * one of them is evidence that the craft got closer, and zero is the single
 * direction this must never fail in, because a zero pins the whole clock to
 * the predicted present and releases every delayed channel at once.
 */
function readOneWaySeconds(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const delay = payload as Partial<CommsDelay>;
  // `.magnitude`: the field arrives wrapped from the decode. Reading the
  // object itself as a number silently fails the finiteness check below.
  const seconds = delay.oneWaySeconds?.magnitude;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return seconds;
}

/**
 * The client-side delay authority. Holds
 * the latest `comms.delay.oneWaySeconds` off the wire and exposes it as a
 * `delaySeconds()` accessor wired into the ONE `ViewClock`
 * (`ViewClockOptions.delaySeconds`).
 *
 * **This is legibility, NOT enforcement.** The mod's reveal gate
 * (`ChannelEngine`) has already withheld each channel's samples
 * until `UT <= now - delay`, so the raw timeline the client receives is
 * already delayed: for the SDK, a curl script, or a station relay alike.
 * This value does not re-gate anything; it only sizes the SDK's
 * PREDICT-FORWARD horizon: how far `utNowEstimate()` leads `confirmedEdgeUt()`
 * so a delayed vessel can be dead-reckoned to the predicted present and the
 * certainty-horizon snap is drawn in the right place. Because
 * media (kerbcast `DelayedPlayoutBuffer`) reads the same clock, aligning this
 * one value aligns telemetry and video for free.
 *
 * `comms.delay` is itself a `TrueNow` channel (it defines the delay, so it is
 * never gated by it): the authority can trust the value it reads as current.
 */
export class DelayAuthority {
  private oneWaySeconds = 0;

  /**
   * Feed one `comms.delay` payload. A frame that reports a measurable one-way
   * time sets it; one that reports none (no path home, or a malformed frame)
   * HOLDS the last known delay.
   *
   * Holding is what makes a blackout behave like a blackout. Losing the path
   * does not move the craft closer, and `comms.delay`/`comms.link` are
   * freeze-exempt, so they keep arriving at true-now and keep
   * `ViewClock.maxSampleUt` advancing through the outage: the sample clamp
   * does not hold the horizon back, only the delay term does. Reset it to 0
   * and `confirmedEdgeUt()` snaps a whole light-time forward at the moment the
   * craft becomes unreachable, dumping the media playout buffer and reporting
   * the disconnect at T+0 instead of the T+delay `CommsLink` promises.
   *
   * The three alternatives all lose something this keeps. Freezing the clock
   * (a non-finite delay) drives `confirmedEdgeUt()` to `-Infinity`, which is
   * the post-rewind "resynchronizing" state: every widget drops its last-known
   * reading, where the blackout design wants exactly those held and labelled
   * `LastBeforeBlackout`. Refusing to advance view time stalls the release of
   * samples already in flight, which are real and still arriving. A large
   * constant is a fabricated measurement, and would misplace the certainty
   * horizon by however much it missed by.
   *
   * A LAN session is unaffected: nothing to hold before the first reading, so
   * the delay stays 0 and `confirmedEdgeUt()` sits on `utNowEstimate()`
   * byte-for-byte, and a real zero (delay switched off, vessel connected)
   * still sets 0 like any other reading.
   */
  observe(payload: unknown): void {
    const reported = readOneWaySeconds(payload);
    if (reported === null) return;
    this.oneWaySeconds = reported;
  }

  /**
   * The current one-way delay in seconds. Pass `authority.delaySeconds` (bound
   * below) straight into `ViewClockOptions.delaySeconds`. Bound as an arrow
   * field so the identity is stable across renders and `this` is preserved
   * when handed off as a bare function reference.
   */
  delaySeconds = (): number => this.oneWaySeconds;

  /**
   * Subscribe to `comms.delay` on `client`, keeping `delaySeconds()` current.
   * `TelemetryClient.subscribe` replays its sticky last value immediately, so
   * a late-attaching authority still learns the current delay on the next
   * delivery: no full-cycle wait. Returns the unsubscribe function.
   */
  attach(client: DelaySubscribable): () => void {
    return client.subscribe(COMMS_DELAY_TOPIC, (payload) =>
      this.observe(payload),
    );
  }
}
